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
      const { name, phone } = req.body;
      const user = await User.findById(req.params.id);

      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      // Only allow users to update their own profile (or admin)
      if (req.user!._id.toString() !== req.params.id && req.user!.role !== "ADMIN") {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      if (name) user.name = name;
      if (phone) user.phone = phone;

      await user.save();
      res.json(user);
    } catch (error: any) {
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