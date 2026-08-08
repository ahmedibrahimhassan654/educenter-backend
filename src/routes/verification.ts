import { Router, Response } from "express";
import multer from "multer";
import { User } from "../models/User";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { cache } from "../services/cache";
import { config } from "../config/env";
import {
  createSignedUrls,
  DOCUMENTS_BUCKET,
  SIGNED_URL_TTL_SECONDS,
} from "../services/storageService";

const router = Router();

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024; // 5 MB, matches the storage bucket

const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};

// Files are held in memory briefly, then streamed to Supabase Storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_DOCUMENT_TYPES[file.mimetype]) {
      cb(null, true);
      return;
    }
    cb(new Error("UNSUPPORTED_FILE_TYPE"));
  },
});

// Teacher submits verification form
router.post(
  "/submit",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { experience, curriculum, bio, documents } = req.body;
      const userId = req.user!._id;

      // Validate required fields
      if (!experience || !curriculum || !Array.isArray(curriculum) || curriculum.length === 0) {
        res.status(400).json({ message: "Experience and at least one curriculum are required" });
        return;
      }

      const user = await User.findById(userId);
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      if (user.role !== "TEACHER") {
        res.status(403).json({ message: "Only teachers can submit verification" });
        return;
      }

      if (user.verificationStatus === "VERIFIED") {
        res.status(400).json({ message: "Teacher is already verified" });
        return;
      }

      // Update verification data
      user.verificationStatus = "SUBMITTED";
      user.verificationData = {
        experience,
        curriculum,
        bio: bio || "",
        documents: documents || [],
      };

      await user.save();

      res.json({
        success: true,
        message: "Verification submitted successfully",
        verificationStatus: user.verificationStatus,
      });
    } catch (error: any) {
      console.error("Error submitting verification:", error);
      res.status(500).json({ message: "Error submitting verification", error: error.message });
    }
  }
);

// Teacher gets their verification status
router.get(
  "/status",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = await User.findById(req.user!._id).select(
        "verificationStatus verificationData verificationNotes verifiedAt"
      );

      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      const response = {
        verificationStatus: user.verificationStatus,
        verificationData: user.verificationData,
        verificationNotes: user.verificationNotes,
        verifiedAt: user.verifiedAt,
      };
      cache.set(`verification:status:${req.user!._id}`, response, 60);
      res.json(response);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching verification status", error: error.message });
    }
  }
);

// Admin gets all pending verification requests
router.get(
  "/pending",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { status = "SUBMITTED", page = "1", limit = "20" } = req.query;

      const cacheKey = `verification:pending:${status}:${page}:${limit}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      const pageNum = parseInt(page as string) || 1;
      const limitNum = parseInt(limit as string) || 20;
      const skip = (pageNum - 1) * limitNum;

      const query: any = { role: "TEACHER" };
      
      // Filter by status
      if (status === "all") {
        query.verificationStatus = { $in: ["PENDING", "SUBMITTED", "VERIFIED", "REJECTED"] };
      } else {
        query.verificationStatus = status;
      }

      // Exclude verificationData.documents: they are base64 data URIs that can
      // be hundreds of KB each and would make this list response many MB.
      // The documents are loaded per teacher via GET /verification/:userId.
      const [users, total] = await Promise.all([
        User.find(query)
          .select(
            "name email phone avatarUrl verificationStatus verificationNotes verifiedAt createdAt " +
              "verificationData.experience verificationData.curriculum verificationData.bio"
          )
          .sort("-createdAt")
          .skip(skip)
          .limit(limitNum)
          .lean(),
        User.countDocuments(query),
      ]);

      // Count documents server-side with $size so the payloads never leave Mongo
      const counts = await User.aggregate([
        { $match: query },
        {
          $project: {
            documentsCount: {
              $size: { $ifNull: ["$verificationData.documents", []] },
            },
          },
        },
      ]);

      const countById = new Map(
        counts.map((u: any) => [String(u._id), u.documentsCount || 0])
      );

      for (const u of users as any[]) {
        u.documentsCount = countById.get(String(u._id)) || 0;
      }

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
      cache.set(cacheKey, response, 60);
      res.json(response);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching verification requests", error: error.message });
    }
  }
);

// Teacher updates their own descriptive details including curriculum.
router.put(
  "/my-details",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { experience, bio, curriculum } = req.body;

      if (experience === undefined && bio === undefined && curriculum === undefined) {
        res.status(400).json({ message: "لا توجد بيانات للتحديث" });
        return;
      }

      if (experience !== undefined && typeof experience !== "string") {
        res.status(400).json({ message: "صيغة الخبرة غير صالحة" });
        return;
      }

      if (bio !== undefined && typeof bio !== "string") {
        res.status(400).json({ message: "صيغة السيرة الذاتية غير صالحة" });
        return;
      }

      if (typeof experience === "string" && experience.length > 500) {
        res.status(400).json({ message: "الخبرة يجب ألا تتجاوز ٥٠٠ حرف" });
        return;
      }

      if (typeof bio === "string" && bio.length > 2000) {
        res.status(400).json({ message: "السيرة الذاتية يجب ألا تتجاوز ٢٠٠٠ حرف" });
        return;
      }

      if (curriculum !== undefined) {
        if (!Array.isArray(curriculum)) {
          res.status(400).json({ message: "صيغة المناهج غير صالحة" });
          return;
        }
        if (curriculum.length === 0) {
          res.status(400).json({ message: "يرجى تحديد مادة واحدة على الأقل" });
          return;
        }
        for (const entry of curriculum) {
          if (typeof entry !== "string" || !entry.includes(":")) {
            res.status(400).json({ message: "صيغة أحد المناهج غير صالحة" });
            return;
          }
        }
      }

      const user = await User.findById(req.user!._id).select(
        "-verificationData.documents"
      );

      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      const current = user.verificationData || {};

      user.set("verificationData.experience",
        experience !== undefined ? experience.trim() : current.experience || ""
      );
      user.set("verificationData.bio",
        bio !== undefined ? bio.trim() : current.bio || ""
      );

      if (curriculum !== undefined) {
        user.set("verificationData.curriculum", curriculum);
      }

      await user.save();

      cache.deleteByPattern("verification:pending:*");
      cache.delete(`verification:status:${req.user!._id}`);
      cache.delete(`user:${req.user!._id}`);
      res.json({
        success: true,
        message: "تم تحديث البيانات بنجاح",
        data: {
          experience: user.verificationData?.experience || "",
          bio: user.verificationData?.bio || "",
          curriculum: user.verificationData?.curriculum || [],
        },
      });
    } catch (error: any) {
      console.error("Error updating teacher details:", error);
      res.status(500).json({
        message: "Error updating details",
        error: error.message,
      });
    }
  }
);

// Teacher uploads a verification document.
// The upload goes through the API rather than straight from the browser so it
// can use the service key: the storage bucket has no RLS policy allowing
// end-user writes. Routing it here also means the server owns the storage path,
// so a teacher can never write into another teacher's folder.
router.post(
  "/upload-document",
  auth,
  requireRole("TEACHER"),
  (req: AuthRequest, res: Response) => {
    upload.single("file")(req as any, res as any, async (uploadError: any) => {
      if (uploadError) {
        if (uploadError.message === "UNSUPPORTED_FILE_TYPE") {
          res.status(400).json({
            message: "نوع الملف غير مدعوم. المسموح: PDF, PNG, JPG, WEBP",
          });
          return;
        }
        if (uploadError.code === "LIMIT_FILE_SIZE") {
          res.status(400).json({
            message: "حجم الملف يجب أن يكون أقل من ٥ ميجابايت",
          });
          return;
        }
        res.status(400).json({ message: "تعذر قراءة الملف" });
        return;
      }

      const file = (req as any).file;
      if (!file) {
        res.status(400).json({ message: "لم يتم إرسال أي ملف" });
        return;
      }

      try {
        const extension = ALLOWED_DOCUMENT_TYPES[file.mimetype];
        const docType = String((req.body as any)?.docType || "document").replace(
          /[^a-zA-Z0-9_-]/g,
          ""
        );
        const path = `verification/${req.user!._id}/${docType || "document"}-${Date.now()}.${extension}`;

        const response = await fetch(
          `${config.supabaseUrl}/storage/v1/object/documents/${path}`,
          {
            method: "POST",
            headers: {
              apikey: config.supabaseSecretKey,
              Authorization: `Bearer ${config.supabaseSecretKey}`,
              "Content-Type": file.mimetype,
              "cache-control": "3600",
            },
            body: new Uint8Array(file.buffer),
          }
        );

        if (!response.ok) {
          console.error(
            `Storage upload failed (${response.status}):`,
            await response.text()
          );
          res.status(502).json({ message: "تعذر رفع الملف. حاول مرة أخرى." });
          return;
        }

        // The bucket is private, so store the path rather than a URL.
        // Readable links are signed on demand when documents are fetched.
        res.json({
          success: true,
          data: {
            url: path,
            name: file.originalname,
            type: file.mimetype,
          },
        });
      } catch (error: any) {
        console.error("Error uploading document:", error);
        res.status(500).json({ message: "تعذر رفع الملف. حاول مرة أخرى." });
      }
    });
  }
);

// Teacher fetches their own verification documents.
// GET /auth/me strips documents to keep every authenticated request small, so
// this route exists to load them on demand. Reads req.user._id directly, so a
// teacher can only ever retrieve their own files.
router.get(
  "/my-documents",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = await User.findById(req.user!._id)
        .select("verificationData.documents")
        .lean();

      const stored = (user as any)?.verificationData?.documents || [];
      const signed = await createSignedUrls(stored);

      res.json({
        success: true,
        data: {
          documents: signed.map((item) => item.url).filter(Boolean),
          expiresIn: SIGNED_URL_TTL_SECONDS,
        },
      });
    } catch (error: any) {
      console.error("Error fetching own documents:", error);
      res.status(500).json({
        message: "Error fetching documents",
        error: error.message,
      });
    }
  }
);

// Admin fetches one teacher's verification documents.
// Kept separate from the list so the heavy base64 payloads are only
// transferred when an admin actually opens a submission.
router.get(
  "/:userId/documents",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = String(req.params.userId);

      if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
        res.status(400).json({ message: "Invalid user ID format" });
        return;
      }

      const user = await User.findById(userId)
        .select("name email verificationData.documents")
        .lean();

      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      const stored = (user as any).verificationData?.documents || [];
      const signed = await createSignedUrls(stored);

      res.json({
        success: true,
        data: {
          documents: signed.map((item) => item.url).filter(Boolean),
          expiresIn: SIGNED_URL_TTL_SECONDS,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        message: "Error fetching verification documents",
        error: error.message,
      });
    }
  }
);

// Admin approves teacher verification
router.put(
  "/:userId/approve",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;
      const { notes } = req.body;

      const user = await User.findById(userId);
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      if (user.role !== "TEACHER") {
        res.status(400).json({ message: "User is not a teacher" });
        return;
      }

      if (user.verificationStatus === "VERIFIED") {
        res.status(400).json({ message: "Teacher is already verified" });
        return;
      }

      user.verificationStatus = "VERIFIED";
      user.verificationNotes = notes || "";
      user.verifiedAt = new Date();

      await user.save();

      cache.deleteByPattern("verification:pending:*");
      cache.delete(`user:${userId}`);
      cache.delete(`verification:status:${userId}`);
      res.json({
        success: true,
        message: "Teacher verified successfully",
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          verificationStatus: user.verificationStatus,
          verifiedAt: user.verifiedAt,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error approving verification", error: error.message });
    }
  }
);

// Admin rejects teacher verification
router.put(
  "/:userId/reject",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;
      const { notes } = req.body;

      if (!notes || notes.trim() === "") {
        res.status(400).json({ message: "Rejection reason is required" });
        return;
      }

      const user = await User.findById(userId);
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      if (user.role !== "TEACHER") {
        res.status(400).json({ message: "User is not a teacher" });
        return;
      }

      user.verificationStatus = "REJECTED";
      user.verificationNotes = notes;

      await user.save();

      res.json({
        success: true,
        message: "Teacher verification rejected",
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          verificationStatus: user.verificationStatus,
          verificationNotes: user.verificationNotes,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error rejecting verification", error: error.message });
    }
  }
);

export default router;
