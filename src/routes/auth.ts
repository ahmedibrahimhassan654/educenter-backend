import { Router, Response } from "express";
import { User } from "../models/User";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  sendTeacherWelcomeEmail,
  sendStudentWelcomeEmail,
  sendParentWelcomeEmail,
} from "../services/emailService";

const router = Router();

// Register user profile after Supabase signup
router.post("/register", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { supabaseId, name, email, phone, role } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ supabaseId });
    if (existingUser) {
      res.status(409).json({ message: "User already exists" });
      return;
    }

    const user = await User.create({
      supabaseId,
      name,
      email,
      phone,
      role,
    });

    // Send welcome email based on role
    try {
      switch (role) {
        case "TEACHER":
          await sendTeacherWelcomeEmail(name, email);
          break;
        case "STUDENT":
          await sendStudentWelcomeEmail(name, email);
          break;
        case "PARENT":
          await sendParentWelcomeEmail(name, email);
          break;
      }
      console.log(`✅ Welcome email sent to ${email} (${role})`);
    } catch (emailError) {
      // Don't fail registration if email fails
      console.error("⚠️ Failed to send welcome email:", emailError);
    }

    res.status(201).json(user);
  } catch (error: any) {
    res.status(500).json({ message: "Error creating user", error: error.message });
  }
});

// Get current user profile
router.get("/me", auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json(req.user);
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching user", error: error.message });
  }
});

// Parent links student via linking code
router.post(
  "/link-student",
  auth,
  requireRole("PARENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { linkingCode } = req.body;
      const parent = req.user;

      // Find student by linking code
      const student = await User.findOne({
        linkingCode,
        role: "STUDENT",
      });

      if (!student) {
        res.status(404).json({ message: "Student not found with this linking code" });
        return;
      }

      // Check if student is already linked
      if (student.parentId) {
        res.status(409).json({ message: "Student is already linked to a parent" });
        return;
      }

      // Link student to parent
      student.parentId = parent!._id;
      await student.save();

      // Add student to parent's students array
      parent!.students.push(student._id);
      await parent!.save();

      res.json({ message: "Student linked successfully", student });
    } catch (error: any) {
      res.status(500).json({ message: "Error linking student", error: error.message });
    }
  }
);

export default router;