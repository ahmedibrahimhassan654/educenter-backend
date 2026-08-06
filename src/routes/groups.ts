import { Router, Response } from "express";
import { Group } from "../models/Group";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";

const router = Router();

// Get all groups (filtered by teacher or student)
router.get(
  "/",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      let groups;
      if (req.user!.role === "TEACHER") {
        groups = await Group.find({ teacherId: req.user!._id })
          .populate("students", "name email phone")
          .sort("-createdAt");
      } else if (req.user!.role === "STUDENT") {
        groups = await Group.find({ students: req.user!._id })
          .populate("teacherId", "name email")
          .sort("-createdAt");
      } else {
        groups = await Group.find()
          .populate("teacherId", "name email")
          .populate("students", "name email phone")
          .sort("-createdAt");
      }
      res.json(groups);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching groups", error: error.message });
    }
  }
);

// Create group (teacher only)
router.post(
  "/",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { title, subject, grade, googleMeetLink, scheduleDays } = req.body;

      const group = await Group.create({
        teacherId: req.user!._id,
        title,
        subject,
        grade,
        googleMeetLink,
        scheduleDays,
      });

      res.status(201).json(group);
    } catch (error: any) {
      res.status(500).json({ message: "Error creating group", error: error.message });
    }
  }
);

// Get group by ID
router.get(
  "/:id",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const group = await Group.findById(req.params.id)
        .populate("teacherId", "name email phone")
        .populate("students", "name email phone");

      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }
      res.json(group);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching group", error: error.message });
    }
  }
);

// Update group (teacher only - must be owner)
router.put(
  "/:id",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const group = await Group.findById(req.params.id);

      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      if (group.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden: You can only update your own groups" });
        return;
      }

      const { title, subject, grade, googleMeetLink, scheduleDays } = req.body;

      if (title) group.title = title;
      if (subject) group.subject = subject;
      if (grade) group.grade = grade;
      if (googleMeetLink !== undefined) group.googleMeetLink = googleMeetLink;
      if (scheduleDays) group.scheduleDays = scheduleDays;

      await group.save();
      res.json(group);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating group", error: error.message });
    }
  }
);

// Delete group (teacher only - must be owner)
router.delete(
  "/:id",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const group = await Group.findById(req.params.id);

      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      if (group.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden: You can only delete your own groups" });
        return;
      }

      await Group.findByIdAndDelete(req.params.id);
      res.json({ message: "Group deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting group", error: error.message });
    }
  }
);

// Add student to group
router.post(
  "/:id/students",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { studentId } = req.body;
      const group = await Group.findById(req.params.id);

      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      if (group.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      if (group.students.includes(studentId)) {
        res.status(409).json({ message: "Student already in group" });
        return;
      }

      group.students.push(studentId);
      await group.save();

      res.json(group);
    } catch (error: any) {
      res.status(500).json({ message: "Error adding student", error: error.message });
    }
  }
);

// Remove student from group
router.delete(
  "/:id/students/:studentId",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const group = await Group.findById(req.params.id);

      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      if (group.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      group.students = group.students.filter(
        (s) => s.toString() !== req.params.studentId
      );
      await group.save();

      res.json(group);
    } catch (error: any) {
      res.status(500).json({ message: "Error removing student", error: error.message });
    }
  }
);

export default router;