import { Router, Response } from "express";
import { User } from "../models/User";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  sendTeacherWelcomeEmail,
  sendStudentWelcomeEmail,
  sendParentWelcomeEmail,
  sendAccountDeletionEmail,
} from "../services/emailService";

const router = Router();

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

      // Execute query
      const [users, total] = await Promise.all([
        User.find(query)
          .select("-__v")
          .sort(sort as string)
          .skip(skip)
          .limit(limitNum)
          .lean(),
        User.countDocuments(query),
      ]);

      res.json({
        success: true,
        data: users,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      });
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

      res.json({
        success: true,
        data: {
          total,
          teachers,
          students,
          parents,
          admins,
        },
      });
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
      const user = await User.findById(req.params.id).select("-__v").lean();
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }
      res.json({ success: true, data: user });
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
      const { name, email, phone, role } = req.body;

      // Validate required fields
      if (!name || !email || !phone || !role) {
        res.status(400).json({ message: "Name, email, phone, and role are required" });
        return;
      }

      // Check if email already exists
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        res.status(409).json({ message: "Email already exists" });
        return;
      }

      // Create user (supabaseId will be set when user signs up via Supabase)
      const user = await User.create({
        supabaseId: `admin-created-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        email: email.toLowerCase(),
        phone,
        role: role.toUpperCase(),
      });

      // Send welcome email based on role
      try {
        const userEmail = email.toLowerCase();
        const userRole = role.toUpperCase();
        
        switch (userRole) {
          case "TEACHER":
            await sendTeacherWelcomeEmail(name, userEmail);
            break;
          case "STUDENT":
            await sendStudentWelcomeEmail(name, userEmail);
            break;
          case "PARENT":
            await sendParentWelcomeEmail(name, userEmail);
            break;
        }
        console.log(`✅ Welcome email sent to ${userEmail} (${userRole})`);
      } catch (emailError) {
        // Don't fail user creation if email fails
        console.error("⚠️ Failed to send welcome email:", emailError);
      }

      res.status(201).json({ success: true, data: user });
    } catch (error: any) {
      res.status(500).json({ message: "Error creating user", error: error.message });
    }
  }
);

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
      const uniqueStudentIds = [...new Set(studentIds)];
      const students = await User.find({ _id: { $in: uniqueStudentIds } }).select("-__v");
      res.json(students);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching students", error: error.message });
    }
  }
);

export default router;