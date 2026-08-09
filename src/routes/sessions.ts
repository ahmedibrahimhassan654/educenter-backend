import { Router, Response } from "express";
import { Session } from "../models/Session";
import { Group } from "../models/Group";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { cache } from "../services/cache";

const router = Router();

// Get all sessions (filtered by group or teacher)
router.get(
  "/",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { groupId, page = "1", limit = "20" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(50, Math.max(1, parseInt(limit as string) || 20));
      const skip = (pageNum - 1) * limitNum;

      // Build cache key
      const cacheKey = `sessions:${req.user!.role}:${req.user!._id}:${groupId || "all"}:${pageNum}`;
      const cached = await cache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      let sessions;

      if (req.user!.role === "TEACHER") {
        const query: any = { teacherId: req.user!._id };
        if (groupId) query.groupId = groupId;
        sessions = await Session.find(query)
          .populate("groupId", "title subject")
          .sort("-date")
          .skip(skip)
          .limit(limitNum);
      } else if (req.user!.role === "STUDENT") {
        const groups = await Group.find({ students: req.user!._id });
        const groupIds = groups.map((g) => g._id);
        const query: any = { groupId: { $in: groupIds } };
        if (groupId) query.groupId = groupId;
        sessions = await Session.find(query)
          .populate("groupId", "title subject")
          .sort("-date")
          .skip(skip)
          .limit(limitNum);
      } else {
        const query: any = {};
        if (groupId) query.groupId = groupId;
        sessions = await Session.find(query)
          .populate("groupId", "title subject")
          .populate("teacherId", "name")
          .sort("-date")
          .skip(skip)
          .limit(limitNum);
      }

      const response = { success: true, data: sessions };
      await cache.set(cacheKey, response, 30);
      res.json(response);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching sessions", error: error.message });
    }
  }
);

// Create session (teacher only)
router.post(
  "/",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { groupId, title, date } = req.body;

      // Verify teacher owns the group
      const group = await Group.findById(groupId);
      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      if (group.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden: You can only create sessions for your own groups" });
        return;
      }

      const session = await Session.create({
        groupId,
        teacherId: req.user!._id,
        title,
        date,
      });

      res.status(201).json(session);
    } catch (error: any) {
      res.status(500).json({ message: "Error creating session", error: error.message });
    }
  }
);

// Get session by ID
router.get(
  "/:id",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const session = await Session.findById(req.params.id)
        .populate("groupId", "title subject grade googleMeetLink")
        .populate("teacherId", "name email phone");

      if (!session) {
        res.status(404).json({ message: "Session not found" });
        return;
      }

      await cache.set(`session:${req.params.id}`, session, 60);
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching session", error: error.message });
    }
  }
);

// Update session (teacher only)
router.put(
  "/:id",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const session = await Session.findById(req.params.id);

      if (!session) {
        res.status(404).json({ message: "Session not found" });
        return;
      }

      if (session.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const { title, date, status } = req.body;

      if (title) session.title = title;
      if (date) session.date = date;
      if (status) session.status = status;

      await session.save();
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating session", error: error.message });
    }
  }
);

// Update video path after upload
router.post(
  "/:id/video",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { supabaseVideoPath } = req.body;
      const session = await Session.findById(req.params.id);

      if (!session) {
        res.status(404).json({ message: "Session not found" });
        return;
      }

      if (session.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      session.supabaseVideoPath = supabaseVideoPath;
      session.status = "COMPLETED";
      await session.save();

      res.json(session);
    } catch (error: any) {
      res.status(500).json({ message: "Error updating video", error: error.message });
    }
  }
);

// Delete session
router.delete(
  "/:id",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const session = await Session.findById(req.params.id);

      if (!session) {
        res.status(404).json({ message: "Session not found" });
        return;
      }

      if (session.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      await Session.findByIdAndDelete(req.params.id);
      res.json({ message: "Session deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting session", error: error.message });
    }
  }
);

export default router;