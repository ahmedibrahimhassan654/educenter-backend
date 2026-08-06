import { Router, Response } from "express";
import { User } from "../models/User";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";

const router = Router();

// Get all users (admin only)
router.get(
  "/",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const users = await User.find().select("-__v");
      res.json(users);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching users", error: error.message });
    }
  }
);

// Get user by ID
router.get(
  "/:id",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = await User.findById(req.params.id).select("-__v");
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }
      res.json(user);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching user", error: error.message });
    }
  }
);

// Update user profile
router.put(
  "/:id",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { name, phone, avatarUrl } = req.body;
      const userId = req.params.id;

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

      // Only allow users to update their own profile (or admin)
      const requestingUserId = req.user!._id.toString();
      const isOwnProfile = requestingUserId === userId;
      const isAdmin = req.user!.role === "ADMIN";

      if (!isOwnProfile && !isAdmin) {
        res.status(403).json({ message: "Forbidden: You can only update your own profile" });
        return;
      }

      if (name) user.name = name;
      if (phone !== undefined) user.phone = phone;
      if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;

      await user.save();

      // Return updated user without sensitive fields
      const updatedUser = await User.findById(userId).select("-__v");
      res.json(updatedUser);
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
      res.json({ message: "User deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting user", error: error.message });
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