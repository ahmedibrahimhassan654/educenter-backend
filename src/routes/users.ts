import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import { User } from "../models/User";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { config } from "../config/env";
import { createNotification } from "../services/notificationService";
import {
  sendAccountDeletionEmail,
  sendCredentialsEmail,
} from "../services/emailService";
import { cache } from "../services/cache";
import { uploadFile, deleteFile, getPublicUrl } from "../services/storageService";

const router = Router();

const BCRYPT_ROUNDS = 12;

// Multer config for avatar uploads (max 2MB, images only)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

// Get all users with filtering, search, and pagination (admin only)
router.get(
  "/",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const {
        search,
        role,
        subscription,
        page = "1",
        limit = "20",
        sort = "-createdAt",
      } = req.query;

      const query: any = {};

      // Search filter (name, email, phone)
      if (search) {
        const searchRegex = new RegExp(search as string, "i");
        query.$or = [
          { name: searchRegex },
          { email: searchRegex },
          { phone: searchRegex },
        ];
      }

      // Role filter
      if (role && role !== "ALL") {
        query.role = (role as string).toUpperCase();
      }

      // Subscription filter
      if (subscription === "active") {
        query.subscriptionStatus = true;
      } else if (subscription === "inactive") {
        query.subscriptionStatus = false;
      }

      // Pagination
      const pageNum = parseInt(page as string) || 1;
      const limitNum = parseInt(limit as string) || 20;
      const skip = (pageNum - 1) * limitNum;

      // Execute query - select only needed fields.
      // verificationData.documents holds base64 data URIs that can be hundreds
      // of KB each, so the list excludes them and they are fetched per user.
      const [users, total] = await Promise.all([
        User.find(query)
          .select(
            "_id name email phone role avatarUrl verificationStatus createdAt updatedAt " +
              "verificationData.experience verificationData.curriculum verificationData.bio"
          )
          .sort(sort as string)
          .skip(skip)
          .limit(limitNum)
          .lean(),
        User.countDocuments(query),
      ]);

      const response = {
        success: true,
        data: users,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      };
      await cache.set(`users:list:${page}:${limit}:${search}:${role}`, response, 30);
      res.json(response);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching users", error: error.message });
    }
  }
);

// Get user statistics (admin only)
router.get(
  "/stats",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const [total, teachers, students, parents, admins] =
        await Promise.all([
          User.countDocuments(),
          User.countDocuments({ role: "TEACHER" }),
          User.countDocuments({ role: "STUDENT" }),
          User.countDocuments({ role: "PARENT" }),
          User.countDocuments({ role: "ADMIN" }),
        ]);

      const response = {
        success: true,
        data: {
          total,
          teachers,
          students,
          parents,
          admins,
        },
      };
      await cache.set("users:stats", response, 60);
      res.json(response);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching stats", error: error.message });
    }
  }
);

// Get user by ID
router.get(
  "/:id",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = String(req.params.id);

      if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
        res.status(400).json({ message: "Invalid user ID format" });
        return;
      }

      const requester = req.user!;
      const isAdmin = requester.role === "ADMIN";
      const isSelf = requester._id.toString() === userId;
      // A parent may read the profiles of their own linked children
      const isOwnChild =
        requester.role === "PARENT" &&
        (requester.students || []).some((id) => id.toString() === userId);

      if (!isAdmin && !isSelf && !isOwnChild) {
        res.status(403).json({
          message: "Forbidden: You can only view your own profile",
        });
        return;
      }

      const user = await User.findById(userId).select("-__v").lean();
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }
      const response = { success: true, data: user };
      await cache.set(`user:${userId}`, response, 120);
      res.json(response);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching user", error: error.message });
    }
  }
);

// Create new user (admin only)
router.post(
  "/",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { name, email, phone, role, password } = req.body;

      // Validate required fields
      if (!name || !email || !phone || !role) {
        res.status(400).json({ message: "Name, email, phone, and role are required" });
        return;
      }

      // Check if email already exists in MongoDB
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        res.status(409).json({ message: "Email already exists" });
        return;
      }

      // Generate password if not provided
      const userPassword = password && password.length >= 6
        ? password
        : generatePassword();

      // Hash password
      const passwordHash = await bcrypt.hash(userPassword, BCRYPT_ROUNDS);

      // Create MongoDB user
      const user = await User.create({
        name,
        email: email.toLowerCase(),
        phone,
        passwordHash,
        role: role.toUpperCase(),
      });

      // Send credentials email
      const userEmail = email.toLowerCase();
      const userRole = role.toUpperCase();
      const loginUrl = `${config.frontendUrl}/login`;

      const emailSent = await sendCredentialsEmail(name, userEmail, userPassword, userRole, loginUrl);
      if (emailSent) {
        console.log(`✅ Credentials email sent to ${userEmail}`);
      } else {
        console.error(`❌ Credentials email FAILED to send to ${userEmail}`);
      }

      // Notify all admins about new user
      const admins = await User.find({ role: "ADMIN" });
      for (const admin of admins) {
        await createNotification({
          userId: admin._id,
          title: "مستخدم جديد",
          message: `تم تسجيل مستخدم جديد: ${name} (${userRole})`,
          type: "INFO",
          category: "USER",
          link: "/admin/users",
        });
      }

      res.status(201).json({
        success: true,
        data: user,
        generatedPassword: password ? undefined : userPassword,
      });
    } catch (error: any) {
      console.error("❌ Error creating user:", error);
      res.status(500).json({ message: "Error creating user", error: error.message });
    }
  }
);

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Update user (user can update own profile, admin can update any user)
router.put(
  "/:id",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { name, email, phone, role, avatarUrl } = req.body;
      const userId = req.params.id;
      const requestingUserId = req.user!._id.toString();
      const isAdmin = req.user!.role === "ADMIN";
      const isOwnProfile = requestingUserId === userId;

      // Only allow users to update their own profile (or admin to update any)
      if (!isOwnProfile && !isAdmin) {
        res.status(403).json({ message: "Forbidden: You can only update your own profile" });
        return;
      }

      // Validate ObjectId format
      if (!userId.match(/^[0-9a-fA-F]{24}$/)) {
        res.status(400).json({ message: "Invalid user ID format" });
        return;
      }

      const user = await User.findById(userId);
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      // Check if email is being changed and already exists
      if (email && email.toLowerCase() !== user.email) {
        // Only admin can change email
        if (!isAdmin) {
          res.status(403).json({ message: "Only admin can change email" });
          return;
        }
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
          res.status(409).json({ message: "Email already exists" });
          return;
        }
        user.email = email.toLowerCase();
      }

      // Update allowed fields
      if (name) user.name = name;
      if (phone !== undefined) user.phone = phone;
      if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;

      // Only admin can change role
      if (role && isAdmin) {
        user.role = role.toUpperCase();
      }

      await user.save();

      const updatedUser = await User.findById(userId).select("-__v").lean();
      res.json({ success: true, data: updatedUser });
    } catch (error: any) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Error updating user", error: error.message });
    }
  }
);

// Delete user (admin only)
router.delete(
  "/:id",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = await User.findByIdAndDelete(req.params.id);
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      // Send account deletion email
      try {
        await sendAccountDeletionEmail(user.name, user.email);
        console.log(`✅ Account deletion email sent to ${user.email}`);
      } catch (emailError) {
        // Don't fail deletion if email fails
        console.error("⚠️ Failed to send deletion email:", emailError);
      }

      res.json({ success: true, message: "User deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting user", error: error.message });
    }
  }
);

// Bulk delete users (admin only)
router.post(
  "/bulk-delete",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { ids } = req.body;

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ message: "User IDs array is required" });
        return;
      }

      const result = await User.deleteMany({ _id: { $in: ids } });
      res.json({
        success: true,
        message: `${result.deletedCount} users deleted successfully`,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting users", error: error.message });
    }
  }
);

// Get all students for a teacher
router.get(
  "/teacher/students",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { Group } = require("../models/Group");
      const groups = await Group.find({ teacherId: req.user!._id });
      const studentIds = groups.flatMap((g: any) => g.students);
      const uniqueStudentIds = [...new Set(studentIds.map((id: any) => id.toString()))];
      const students = await User.find({ _id: { $in: uniqueStudentIds } } as any).select("-__v");
      res.json(students);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching students", error: error.message });
    }
  }
);

// Upload avatar (authenticated user)
router.post(
  "/upload-avatar",
  auth,
  upload.single("avatar"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No file uploaded" });
        return;
      }

      const userId = req.user!._id.toString();
      const fileExt = req.file.originalname.split(".").pop() || "jpg";
      const fileName = `${userId}-${Date.now()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      // Upload to Supabase Storage
      const uploadResult = await uploadFile(filePath, req.file.buffer, req.file.mimetype);
      if (!uploadResult) {
        res.status(500).json({ message: "Failed to upload avatar" });
        return;
      }

      // Get public URL
      const publicUrl = getPublicUrl(filePath);

      // Update user profile with new avatar URL
      const user = await User.findByIdAndUpdate(
        userId,
        { avatarUrl: publicUrl },
        { new: true }
      ).select("-passwordHash -verificationData.documents");

      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      res.json({
        success: true,
        avatarUrl: publicUrl,
        user,
      });
    } catch (error: any) {
      console.error("Avatar upload error:", error);
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          res.status(400).json({ message: "File size must be less than 2MB" });
          return;
        }
      }
      if (error.message === "Only image files are allowed") {
        res.status(400).json({ message: "Only image files are allowed" });
        return;
      }
      res.status(500).json({ message: "Error uploading avatar", error: error.message });
    }
  }
);

export default router;