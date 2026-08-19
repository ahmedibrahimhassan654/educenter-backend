import { Router, Response } from "express";
import { Readable } from "stream";
import { Session } from "../models/Session";
import { Group } from "../models/Group";
import { Purchase } from "../models/Purchase";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { cache } from "../services/cache";
import { computeEntitlement } from "../services/entitlement";
import { getWalletBalance } from "../services/walletService";
import {
  createSignedUploadUrl,
  fetchStorageObject,
  toStorageSessionPath,
  SESSION_RECORDINGS_BUCKET,
} from "../services/storageService";

const router = Router();

// Absolute URL for the authenticated session-recording proxy, built from the
// host the API was reached on (so cookies for that host are sent with the
// media request). Recordings are private and streamed only through this route.
function sessionVideoProxyUrl(req: AuthRequest, sessionId: any): string {
  return `${req.protocol}://${req.get("host")}/api/sessions/${sessionId}/video`;
}

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
      if (Array.isArray(sessions)) {
        for (const session of sessions) {
          if (toStorageSessionPath(session.supabaseVideoPath || "")) {
            session.supabaseVideoPath = sessionVideoProxyUrl(req, session._id);
          }
        }
      }
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

      if (toStorageSessionPath(session.supabaseVideoPath || "")) {
        session.supabaseVideoPath = sessionVideoProxyUrl(req, session._id);
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

// Create a signed upload URL so a session recording can be uploaded directly
// to the private session-recordings bucket from the browser.
router.post(
  "/:id/video/upload-url",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { filename, mimeType } = req.body || {};
      const session = await Session.findById(req.params.id);

      if (!session) {
        res.status(404).json({ message: "Session not found" });
        return;
      }
      if (session.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
      if (!filename || !mimeType) {
        res.status(400).json({ message: "filename and mimeType are required" });
        return;
      }
      if (!String(mimeType).startsWith("video/")) {
        res.status(400).json({ message: "Only video files are allowed" });
        return;
      }

      const ext = (String(filename).split(".").pop() || "mp4")
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 8);
      const userId = req.user!._id.toString();
      const fullPath = `session-recordings/${userId}-${Date.now()}.${ext}`;

      const signed = await createSignedUploadUrl(
        SESSION_RECORDINGS_BUCKET,
        fullPath.replace("session-recordings/", "")
      );
      if (!signed) {
        res.status(500).json({ message: "Failed to create upload URL" });
        return;
      }

      res.json({
        success: true,
        bucket: SESSION_RECORDINGS_BUCKET,
        path: fullPath.replace("session-recordings/", ""),
        fullPath,
        token: signed.token,
        uploadUrl: signed.uploadUrl,
        mimeType,
      });
    } catch (error: any) {
      console.error("Session upload URL error:", error);
      res.status(500).json({ message: "Error creating upload URL", error: error.message });
    }
  }
);

// Stream a session recording through the API. Access is re-checked on every
// request: the owning teacher, an admin, or an entitled member of the session's
// group. Auth comes from the JWT cookie so <video> works without a header, and
// Range is forwarded so seeking works.
router.get(
  "/:id/video",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const session = await Session.findById(req.params.id).select(
        "groupId teacherId supabaseVideoPath"
      );
      if (!session) {
        res.status(404).json({ message: "Session not found" });
        return;
      }

      const isTeacher = session.teacherId.toString() === req.user!._id.toString();
      const isAdmin = req.user!.role === "ADMIN";
      let allowed = isTeacher || isAdmin;

      if (!allowed) {
        const group = await Group.findById(session.groupId).select("students");
        const isStudent = (group?.students || []).some(
          (s: any) => s.toString() === req.user!._id.toString()
        );
        if (isStudent) {
          const purchases = await Purchase.find({
            groupId: session.groupId,
            studentId: req.user!._id,
          }).lean();
          const walletBalance = await getWalletBalance(req.user!._id);
          allowed = computeEntitlement(purchases, walletBalance).hasAccess;
        }
      }

      if (!allowed) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const sessionPath = toStorageSessionPath(session.supabaseVideoPath || "");
      if (!sessionPath) {
        res.status(400).json({ message: "Session has no stored video" });
        return;
      }

      const upstream = await fetchStorageObject(
        SESSION_RECORDINGS_BUCKET,
        sessionPath.replace(`${SESSION_RECORDINGS_BUCKET}/`, ""),
        req.headers.range as string | undefined
      );

      if (!upstream.body) {
        res.status(upstream.status).end();
        return;
      }

      res.status(upstream.status);
      res.setHeader(
        "Content-Type",
        upstream.headers.get("Content-Type") || "video/mp4"
      );
      const contentLength = upstream.headers.get("Content-Length");
      const contentRange = upstream.headers.get("Content-Range");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      if (contentRange) res.setHeader("Content-Range", contentRange);
      res.setHeader("Accept-Ranges", upstream.headers.get("Accept-Ranges") || "bytes");
      res.setHeader("Cache-Control", "private, no-transform, max-age=60");
      res.setHeader("X-Content-Type-Options", "nosniff");

      const body: any = upstream.body;
      if (typeof body.getReader === "function") {
        Readable.fromWeb(body, { highWaterMark: 128 * 1024 }).pipe(res);
      } else {
        body.pipe(res);
      }
    } catch (error: any) {
      console.error("Session video proxy error:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Error streaming video" });
      } else {
        res.end();
      }
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