import { Router, Response } from "express";
import { Attendance } from "../models/Attendance";
import { Session } from "../models/Session";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { cache } from "../services/cache";

const router = Router();

// Get attendance for a session
router.get(
  "/:sessionId",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const cacheKey = `attendance:${req.params.sessionId}`;
      const cached = await cache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      const attendance = await Attendance.find({
        sessionId: req.params.sessionId,
      }).populate("studentId", "name email phone");

      await cache.set(cacheKey, attendance, 60);
      res.json(attendance);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching attendance", error: error.message });
    }
  }
);

// Mark attendance (bulk - teacher only)
router.post(
  "/:sessionId",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { attendanceRecords } = req.body;
      const sessionId = req.params.sessionId;

      // Verify session exists and teacher owns it
      const session = await Session.findById(sessionId);
      if (!session) {
        res.status(404).json({ message: "Session not found" });
        return;
      }

      if (session.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      // Bulk update attendance
      const results = [];
      for (const record of attendanceRecords) {
        const { studentId, status } = record;

        const attendance = await Attendance.findOneAndUpdate(
          { sessionId, studentId },
          { status },
          { upsert: true, new: true }
        );
        results.push(attendance);
      }

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ message: "Error marking attendance", error: error.message });
    }
  }
);

// Update single attendance record
router.put(
  "/:id",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { status } = req.body;
      const attendance = await Attendance.findById(req.params.id);

      if (!attendance) {
        res.status(404).json({ message: "Attendance record not found" });
        return;
      }

      // Verify teacher owns the session
      const session = await Session.findById(attendance.sessionId);
      if (!session || session.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      attendance.status = status;
      await attendance.save();

      res.json(attendance);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating attendance", error: error.message });
    }
  }
);

// Get attendance summary for a student
router.get(
  "/student/:studentId/summary",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { studentId } = req.params;

      const attendance = await Attendance.find({ studentId });

      const summary = {
        total: attendance.length,
        present: attendance.filter((a) => a.status === "PRESENT").length,
        absent: attendance.filter((a) => a.status === "ABSENT").length,
        late: attendance.filter((a) => a.status === "LATE").length,
      };

      await cache.set(`attendance:summary:${studentId}`, summary, 60);
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching attendance summary", error: error.message });
    }
  }
);

export default router;