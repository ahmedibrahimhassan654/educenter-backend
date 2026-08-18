import { Router, Request, Response, NextFunction } from "express";
import { Readable } from "stream";
import multer from "multer";
import { Group } from "../models/Group";
import { User } from "../models/User";
import { GroupInvitation } from "../models/GroupInvitation";
import { Purchase } from "../models/Purchase";
import { LessonAccess } from "../models/LessonAccess";
import { Session } from "../models/Session";
import { Attendance } from "../models/Attendance";
import { Settings } from "../models/Settings";
import { Lesson } from "../models/Lesson";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { createNotification } from "../services/notificationService";
import { cache } from "../services/cache";
import { computeEntitlement } from "../services/entitlement";
import {
  uploadFile,
  deleteFile,
  getPublicUrl,
  createSignedUploadUrl,
  toStoragePath,
  toStorageVideoPath,
  toStorageSessionPath,
  toStorageGroupVideoPath,
  isProxyVideoUrl,
  fetchStorageObject,
  DOCUMENTS_BUCKET,
  LESSON_VIDEOS_BUCKET,
} from "../services/storageService";
import {
  sendGroupInvitationEmail,
  sendCredentialsEmail,
  sendStudentGroupWelcomeEmail,
  sendParentGroupWelcomeEmail,
  sendInvitationAcceptedEmail,
  sendInvitationRejectedEmail,
} from "../services/emailService";
import { remuxVideoToFaststart } from "../services/videoProcessor";
import bcrypt from "bcryptjs";

const router = Router();

// Multer config for group description videos (max 100MB, video only)
const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  },
});

// Multer config for lesson attachments (videos, documents, images; max 200MB)
const lessonUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

// Normalize learningPoints into a clean list of non-empty strings
function normalizeLearningPoints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .slice(0, 20);
}

// A lesson's stored file value may be a bucket-relative path (uploaded file), a
// full storage URL from before the private-bucket scheme, or an external link.
// Normalize the storage shapes to a clean bucket-relative path so we never
// persist expiring signed URLs or public URLs for private buckets.
function normalizeStoredUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const videoPath = toStorageVideoPath(trimmed);
  if (videoPath) return videoPath;
  const docPath = toStoragePath(trimmed);
  if (docPath) return docPath;
  return trimmed;
}

// Normalize a list of lesson document/reference-link values into clean,
// non-empty arrays (max 20 items). Stored files are normalized to stable paths.
function normalizeLessonList(value: unknown, isFile: boolean): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = isFile ? normalizeStoredUrl(entry) : entry.trim();
    if (!normalized || !normalized.trim()) continue;
    if (out.includes(normalized)) continue;
    out.push(normalized);
    if (out.length >= 20) break;
  }
  return out;
}

// Absolute URL for the authenticated video proxy, built from the host the API
// was reached on (so cookies for that host are sent with the media request).
function lessonVideoProxyUrl(req: AuthRequest, groupId: any, lessonId: any): string {
  return `${req.protocol}://${req.get("host")}/api/groups/${groupId}/lessons/${lessonId}/video`;
}

// Absolute URL for the authenticated lesson document proxy (?index= selects
// which document in the folded documents[] array to stream).
function lessonDocumentProxyUrl(
  req: AuthRequest,
  groupId: any,
  lessonId: any,
  index: number
): string {
  return `${req.protocol}://${req.get("host")}/api/groups/${groupId}/lessons/${lessonId}/document?index=${index}`;
}

// Apply the authenticated-proxy transform to a lesson object so stored private
// files are only reachable via authed endpoints. Expects documents[] and
// referenceLinks[] to already be folded. External links pass through.
function transformLessonForDelivery(
  req: AuthRequest,
  groupId: any,
  lesson: any
): any {
  const baseProxy = lessonVideoProxyUrl(req, groupId, lesson._id);
  if (lesson.videoUrl && toStorageVideoPath(lesson.videoUrl)) {
    lesson.videoUrl = baseProxy;
  }
  if (
    lesson.recordedLiveVideoUrl &&
    toStorageVideoPath(lesson.recordedLiveVideoUrl)
  ) {
    lesson.recordedLiveVideoUrl = `${baseProxy}?field=recordedLiveVideoUrl`;
  }
  if (lesson.recordedVideoUrl && toStorageVideoPath(lesson.recordedVideoUrl)) {
    lesson.recordedVideoUrl = `${baseProxy}?field=recordedVideoUrl`;
  }
  if (Array.isArray(lesson.documents)) {
    for (let i = 0; i < lesson.documents.length; i++) {
      const doc = lesson.documents[i];
      if (!doc) continue;
      if (toStoragePath(doc)) {
        lesson.documents[i] = lessonDocumentProxyUrl(req, groupId, lesson._id, i);
      }
    }
  }
  if (lesson.documentUrl && toStoragePath(lesson.documentUrl)) {
    lesson.documentUrl = lessonDocumentProxyUrl(req, groupId, lesson._id, 0);
  }
  return lesson;
}

// Decrement one remaining credit from the student's oldest LECTURES purchase
// for the group. Returns false when there are no credits left to consume.
async function consumeLessonCredit(studentId: any, groupId: any): Promise<boolean> {
  const purchase = await Purchase.findOne({
    groupId,
    studentId,
    type: "LECTURES",
    remainingLectures: { $gt: 0 },
  }).sort({ createdAt: 1 });
  if (!purchase) return false;
  purchase.remainingLectures = Math.max(
    0,
    (purchase.remainingLectures || 0) - 1
  );
  await purchase.save();
  return true;
}

// True when a value is this platform's authenticated lesson document proxy URL.
function isDocumentProxyUrl(value: string): boolean {
  return (
    typeof value === "string" &&
    /\/api\/groups\/[^/]+\/lessons\/[^/]+\/document(?:\?|$)/.test(value)
  );
}

// True when a stored file value is an external URL that points outside this
// platform's storage (YouTube, Google Drive, ...). Private lesson videos and
// documents must live inside our own private buckets, so external links are
// rejected instead of persisted.
function isExternalStoredUrl(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  return (
    !toStorageVideoPath(trimmed) &&
    !toStoragePath(trimmed) &&
    !isProxyVideoUrl(trimmed) &&
    !isDocumentProxyUrl(trimmed)
  );
}

function timeToMinutes(timeStr: string): number {
  const trimmed = timeStr.trim();
  const [hours, minutes] = trimmed.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function checkScheduleConflicts(
  newSlots: string[],
  teacherId: string,
  excludeGroupId?: string
): string | null {
  const normalizedNew = newSlots.map((s) => s.trim());
  const seen = new Set<string>();
  for (const slot of normalizedNew) {
    if (seen.has(slot)) {
      return `تعارض في الموعد: "${slot}" مكرر داخل نفس المجموعة`;
    }
    seen.add(slot);
  }

  const query: any = { teacherId };
  if (excludeGroupId) {
    query._id = { $ne: excludeGroupId };
  }

  const conflictingGroup = Group.findOne(query, { scheduleDays: 1, title: 1 }).lean();
  if (conflictingGroup && (conflictingGroup as any).scheduleDays) {
    const existingSlots = (conflictingGroup as any).scheduleDays.map((s: string) => s.trim());

    for (const newSlot of normalizedNew) {
      const [newDay, newTime] = newSlot.split(" ");
      const newMinutes = timeToMinutes(newTime);

      for (const existingSlot of existingSlots) {
        const [existingDay, existingTime] = existingSlot.split(" ");
        if (newDay !== existingDay) continue;

        const existingMinutes = timeToMinutes(existingTime);
        const diff = Math.abs(newMinutes - existingMinutes);

        if (diff < 120) {
          const existingTimeFormatted = existingTime;
          return `يجب أن يكون الفارق بين الحصص في نفس اليوم ساعتين على الأقل. الموعد "${newTime}" قريب جداً من "${existingTimeFormatted}" في مجموعة "${(conflictingGroup as any).title}"`;
        }
      }
    }
  }

  return null;
}

// Public group detail by ID (no auth). Declared before "/:id" so ObjectId
// checks never swallow it. Excludes private data (students list, meet link).
router.get(
  "/public/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      if (!/^[0-9a-fA-F]{24}$/.test(id)) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      const group = await Group.findById(id)
        .populate("teacherId", "name avatarUrl verificationStatus verificationData verifiedAt")
        .lean();

      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      const teacher = group.teacherId as any;
      if (!teacher || teacher.verificationStatus !== "VERIFIED") {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      const publicGroup = {
        id: (group as any)._id,
        title: group.title,
        subject: group.subject,
        grade: group.grade,
        stage: group.stage,
        totalSessionPrice: group.totalSessionPrice,
        maxStudentsPerGroup: group.maxStudentsPerGroup,
        scheduleDays: group.scheduleDays || [],
        learningPoints: (group as any).learningPoints || [],
        descriptionVideo: (group as any).descriptionVideo || "",
        studentsCount: (group as any).students?.length || 0,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        teacher: {
          id: teacher._id,
          name: teacher.name,
          avatarUrl: teacher.avatarUrl,
          verificationStatus: teacher.verificationStatus,
          verifiedAt: teacher.verifiedAt,
          verificationData: {
            bio: teacher.verificationData?.bio || "",
            experience: teacher.verificationData?.experience || "",
            curriculum: teacher.verificationData?.curriculum || [],
          },
        },
      };

      await cache.set(`public:group:${id}`, publicGroup, 60);
      res.json(publicGroup);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching group", error: error.message });
    }
  }
);

// Public list of groups (no auth). Only groups from verified teachers appear.
// Supports stage/grade/subject/search filters + pagination + sorting.
router.get(
  "/public",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        stage,
        grade,
        subject,
        search,
        sort,
        page = "1",
        limit = "20",
      } = req.query;

      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(50, Math.max(1, parseInt(limit as string) || 20));
      const skip = (pageNum - 1) * limitNum;

      // Only groups from verified teachers
      const verifiedTeachers = await User.find({
        role: "TEACHER",
        verificationStatus: "VERIFIED",
      }).select("_id").lean();
      const teacherIds = verifiedTeachers.map((t) => (t as any)._id);

      const filter: any = { teacherId: { $in: teacherIds } };
      if (stage && stage !== "الكل" && stage !== "all") {
        filter.stage = new RegExp(
          (stage as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i"
        );
      }
      if (grade && grade !== "all") filter.grade = grade;
      if (subject && subject !== "all") filter.subject = subject;
      if (search) {
        const searchRegex = new RegExp((search as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [
          { title: searchRegex },
          { subject: searchRegex },
          { grade: searchRegex },
        ];
      }

      const sortOptions: any = {
        newest: { createdAt: -1 },
        cheapest: { totalSessionPrice: 1 },
        expensive: { totalSessionPrice: -1 },
      };
      const sortQuery = sortOptions[sort as string] || sortOptions.newest;

      let rawGroups: any[];
      if (sort === "full") {
        // studentsCount is a virtual, so sort by the real students array length
        const ids = await Group.aggregate([
          { $match: filter },
          { $addFields: { _count: { $size: { $ifNull: ["$students", []] } } } },
          { $sort: { _count: -1, createdAt: -1 } },
          { $skip: skip },
          { $limit: limitNum },
        ]).then((r) => r.map((g) => g._id));
        const populated = await Group.find({ _id: { $in: ids } })
          .populate("teacherId", "name avatarUrl verificationStatus verificationData verifiedAt")
          .lean();
        const byId = new Map(populated.map((g: any) => [g._id.toString(), g]));
        rawGroups = ids.map((id) => byId.get(id.toString())).filter(Boolean);
      } else {
        rawGroups = await Group.find(filter)
          .populate("teacherId", "name avatarUrl verificationStatus verificationData verifiedAt")
          .sort(sortQuery)
          .skip(skip)
          .limit(limitNum)
          .lean();
      }

      const total = await Group.countDocuments(filter);

      const data = rawGroups.map((g: any) => {
        const teacher = g.teacherId;
        return {
          id: g._id,
          title: g.title,
          subject: g.subject,
          grade: g.grade,
          stage: g.stage,
          totalSessionPrice: g.totalSessionPrice,
          maxStudentsPerGroup: g.maxStudentsPerGroup,
          scheduleDays: g.scheduleDays || [],
          learningPoints: g.learningPoints || [],
          descriptionVideo: g.descriptionVideo || "",
          studentsCount: g.students?.length || 0,
          createdAt: g.createdAt,
          teacher: teacher
            ? {
                id: teacher._id,
                name: teacher.name,
                avatarUrl: teacher.avatarUrl,
                verificationStatus: teacher.verificationStatus,
                verifiedAt: teacher.verifiedAt,
                verificationData: {
                  bio: teacher.verificationData?.bio || "",
                  experience: teacher.verificationData?.experience || "",
                  curriculum: teacher.verificationData?.curriculum || [],
                },
              }
            : null,
        };
      });

      await cache.set(`public:groups:list:${JSON.stringify(req.query)}`, { data, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } }, 60);
      res.json({ data, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching groups", error: error.message });
    }
  }
);

// Get all groups (filtered by teacher or student) with pagination
router.get(
  "/",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { explore, page = "1", limit = "20" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(50, Math.max(1, parseInt(limit as string) || 20));
      const skip = (pageNum - 1) * limitNum;

      let filter: any = {};
      
      if (explore !== "true") {
        if (req.user!.role === "TEACHER") {
          filter.teacherId = req.user!._id;
        } else if (req.user!.role === "STUDENT") {
          filter.students = req.user!._id;
        }
      }

      // Use Promise.all for parallel execution
      // Include students as ObjectIds only (not populated) for count
      const [groups, total] = await Promise.all([
        Group.find(filter)
          .populate("teacherId", "name email phone verificationStatus")
          .sort("-createdAt")
          .skip(skip)
          .limit(limitNum)
          .lean(),
        Group.countDocuments(filter),
      ]);

      // Add studentsCount from the ObjectIds array
      const groupsWithCount = groups.map((g: any) => ({
        ...g,
        studentsCount: g.students?.length || 0,
        students: undefined, // Don't send student ObjectIds to client
      }));

      res.json({
        data: groupsWithCount,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching groups", error: error.message });
    }
  }
);

// Admin: Get all groups with teacher info
router.get(
  "/admin/all",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const {
        page = "1",
        limit = "20",
      } = req.query;

      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
      const skip = (pageNum - 1) * limitNum;

      const [groups, total] = await Promise.all([
        Group.find()
          .populate("teacherId", "name email phone verificationStatus")
          .sort("-createdAt")
          .skip(skip)
          .limit(limitNum)
          .lean(),
        Group.countDocuments(),
      ]);

      const groupsWithCount = groups.map((g: any) => ({
        ...g,
        studentsCount: g.students?.length || 0,
        students: undefined,
      }));

      await cache.set(`admin:groups:all:${pageNum}:${limitNum}`, groupsWithCount, 30);
      res.json({
        success: true,
        data: groupsWithCount,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching groups", error: error.message });
    }
  }
);

// Get teacher's group stats (for dashboard)
router.get(
  "/stats",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const stats = await Group.aggregate([
        { $match: { teacherId: req.user!._id } },
        {
          $group: {
            _id: null,
            totalGroups: { $sum: 1 },
            totalStudents: { $sum: { $size: { $ifNull: ["$students", []] } } },
            totalEarnings: {
              $sum: {
                $multiply: [
                  { $ifNull: ["$totalSessionPrice", 0] },
                  { $size: { $ifNull: ["$students", []] } },
                ],
              },
            },
          },
        },
      ]);

      const result = stats[0] || { totalGroups: 0, totalStudents: 0, totalEarnings: 0 };
      res.json({
        success: true,
        data: {
          totalGroups: result.totalGroups,
          totalStudents: result.totalStudents,
          totalEarnings: result.totalEarnings,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching stats", error: error.message });
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
      const { title, subject, grade, stage, googleMeetLink, scheduleDays, learningPoints, descriptionVideo } = req.body;

      if (!scheduleDays || !Array.isArray(scheduleDays) || scheduleDays.length === 0) {
        res.status(400).json({ message: "يرجى إضافة موعد حصة واحد على الأقل" });
        return;
      }

      const conflict = checkScheduleConflicts(scheduleDays, req.user!._id.toString());
      if (conflict) {
        res.status(400).json({ message: conflict });
        return;
      }

      // Fetch current settings defaults
      const settings = await Settings.findOne().sort("-createdAt").lean();
      const pricePerLecture = settings?.defaultPricePerLecture ?? 50;
      const platformFeePct = settings?.platformFeePercentage ?? 15;
      const maxStudents = settings?.maxStudentsPerGroup ?? 20;
      const platformFee = Math.round((pricePerLecture * platformFeePct) / 100);
      const teacherShare = pricePerLecture - platformFee;

      const group = await Group.create({
        teacherId: req.user!._id,
        title,
        subject,
        grade,
        stage,
        googleMeetLink,
        learningPoints: normalizeLearningPoints(learningPoints),
        descriptionVideo: typeof descriptionVideo === "string" ? descriptionVideo.trim() : "",
        scheduleDays,
        totalSessionPrice: pricePerLecture,
        priceTeacherShare: teacherShare,
        platformFee: platformFee,
        maxStudentsPerGroup: maxStudents,
      });

      // Notify all admins about new group
      const admins = await User.find({ role: "ADMIN" });
      const teacher = await User.findById(req.user!._id);
      for (const admin of admins) {
        await createNotification({
          userId: admin._id,
          title: "مجموعة جديدة",
          message: `تم إنشاء مجموعة جديدة: ${title} بواسطة ${teacher?.name || "معلم"}`,
          type: "INFO",
          category: "GROUP",
          link: "/admin/groups",
        });
      }

      await cache.deleteByPattern("groups:list:*");
      await cache.deleteByPattern("groups:stats:*");
      await cache.deleteByPattern("admin:groups:*");
      res.status(201).json(group);
    } catch (error: any) {
      res.status(500).json({ message: "Error creating group", error: error.message });
    }
  }
);

// Upload a group description video (teacher only). Stores in Supabase and
// returns the public URL to save on the group via create/update.
router.post(
  "/upload-video",
  auth,
  requireRole("TEACHER"),
  videoUpload.single("video"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No video file uploaded" });
        return;
      }

      const userId = req.user!._id.toString();
      const fileExt = req.file.originalname.split(".").pop() || "mp4";
      const fileName = `${userId}-${Date.now()}.${fileExt}`;
      const filePath = `group-videos/${fileName}`;

      const uploadResult = await uploadFile(filePath, req.file.buffer, req.file.mimetype);
      if (!uploadResult) {
        res.status(500).json({ message: "Failed to upload video" });
        return;
      }

      res.json({ success: true, videoUrl: getPublicUrl(filePath) });
    } catch (error: any) {
      console.error("Video upload error:", error);
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          res.status(400).json({ message: "حجم الفيديو يجب أن يكون أقل من 100 ميجابايت" });
          return;
        }
      }
      if (error.message === "Only video files are allowed") {
        res.status(400).json({ message: "يرجى رفع ملف فيديو صالح" });
        return;
      }
      res.status(500).json({ message: "Error uploading video", error: error.message });
    }
  }
);

// Admin: summary of a teacher's groups and their student counts.
// Declared before "/:id" so "teacher" is not matched as an id.
router.get(
  "/teacher/:teacherId/summary",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const teacherId = String(req.params.teacherId);

      if (!/^[0-9a-fA-F]{24}$/.test(teacherId)) {
        res.status(400).json({ message: "Invalid teacher ID format" });
        return;
      }

      const groups = await Group.find({ teacherId })
        .select(
          "title subject grade stage scheduleDays totalSessionPrice priceTeacherShare maxStudentsPerGroup students createdAt"
        )
        .sort("-createdAt")
        .lean();

      const summary = groups.map((group: any) => ({
        _id: group._id,
        title: group.title,
        subject: group.subject,
        grade: group.grade,
        stage: group.stage,
        scheduleDays: group.scheduleDays || [],
        totalSessionPrice: group.totalSessionPrice,
        priceTeacherShare: group.priceTeacherShare,
        maxStudentsPerGroup: group.maxStudentsPerGroup || 20,
        studentsCount: group.students?.length || 0,
        createdAt: group.createdAt,
      }));

      const totalStudents = summary.reduce(
        (sum, group) => sum + group.studentsCount,
        0
      );

      res.json({
        success: true,
        data: {
          groups: summary,
          stats: {
            totalGroups: summary.length,
            totalStudents,
            averageStudentsPerGroup: summary.length
              ? Math.round((totalStudents / summary.length) * 10) / 10
              : 0,
          },
        },
      });
    } catch (error: any) {
      res.status(500).json({
        message: "Error fetching teacher groups",
        error: error.message,
      });
    }
  }
);

// Get group by ID
router.get(
  "/:id",
  auth,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    // Skip non-ObjectId params (e.g. /invitations) so they match their own routes
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
      return next();
    }
    try {
      const group = await Group.findById(req.params.id)
        .populate("teacherId", "name email phone verificationData verificationStatus")
        .populate("students", "name email phone avatarUrl stage grade");

      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      if (req.user!.role === "STUDENT") {
        const purchases = await Purchase.find({
          groupId: group._id,
          studentId: req.user!._id,
        }).lean();
        const entitlement = computeEntitlement(purchases);
        const groupObj = group.toObject() as any;
        const studentId = req.user!._id.toString();
        groupObj.isMember = (groupObj.students || []).some(
          (s: any) => (s?._id || s)?.toString() === studentId
        );
        const joinRequest = await GroupInvitation.findOne({
          groupId: group._id,
          studentId: req.user!._id,
          status: "PENDING",
          initiator: "STUDENT",
        }).lean();
        groupObj.joinRequest = joinRequest
          ? {
              id: (joinRequest as any)._id,
              status: joinRequest.status,
              initiator: joinRequest.initiator,
            }
          : null;
        if (!entitlement.hasAccess) {
          delete groupObj.googleMeetLink;
        }
        groupObj.entitlement = entitlement;
        await cache.set(`group:${req.params.id}`, groupObj, 60);
        res.json(groupObj);
        return;
      }

      await cache.set(`group:${req.params.id}`, group, 60);
      res.json(group);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching group", error: error.message });
    }
  }
);

// Purchase lessons in a group (student only, must be a member).
// LECTURES: one-time pack with remaining credits. MONTHLY: unlimited for 30 days.
router.post(
  "/:id/purchases",
  auth,
  requireRole("STUDENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { type, lectures } = req.body;
      const group = await Group.findById(req.params.id);

      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      if (!group.students.some((s) => s.toString() === req.user!._id.toString())) {
        res.status(403).json({ message: "You must be a member of this group to buy lessons" });
        return;
      }

      const unitPrice = group.totalSessionPrice || 0;
      if (unitPrice <= 0) {
        res.status(400).json({ message: "Group price is not configured yet" });
        return;
      }

      if (type === "LECTURES") {
        const parsedCount = Math.floor(Number(lectures) || 0);
        if (parsedCount < 1) {
          res.status(400).json({ message: "عدد الحصص المطلوب غير صحيح" });
          return;
        }
        const lecturesCount = parsedCount;
        const purchase = await Purchase.create({
          groupId: group._id,
          studentId: req.user!._id,
          type: "LECTURES",
          lectures: lecturesCount,
          remainingLectures: lecturesCount,
          monthlyExpiresAt: null,
          unitPrice,
          amountPaid: lecturesCount * unitPrice,
          teacherShareTotal: lecturesCount * (group.priceTeacherShare || 0),
          platformFeeTotal: lecturesCount * (group.platformFee || 0),
          status: "PAID",
        });
        await cache.delete(`group:${group._id}`);
        res.status(201).json({ success: true, data: purchase });
        return;
      }

      if (type === "MONTHLY") {
        const weekly = (group.scheduleDays || []).length || 1;
        const lecturesCount = weekly * 4;
        const now = new Date();
        const existingActive = await Purchase.findOne({
          groupId: group._id,
          studentId: req.user!._id,
          type: "MONTHLY",
          monthlyExpiresAt: { $gt: now },
        });
        const fromDate = existingActive?.monthlyExpiresAt
          ? new Date(existingActive.monthlyExpiresAt)
          : now;
        const expiresAt = new Date(fromDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        const purchase = await Purchase.create({
          groupId: group._id,
          studentId: req.user!._id,
          type: "MONTHLY",
          lectures: lecturesCount,
          remainingLectures: 0,
          monthlyExpiresAt: expiresAt,
          unitPrice,
          amountPaid: lecturesCount * unitPrice,
          teacherShareTotal: lecturesCount * (group.priceTeacherShare || 0),
          platformFeeTotal: lecturesCount * (group.platformFee || 0),
          status: "PAID",
        });
        await cache.delete(`group:${group._id}`);
        res.status(201).json({ success: true, data: purchase });
        return;
      }

      res.status(400).json({ message: "Invalid purchase type" });
    } catch (error: any) {
      res.status(500).json({ message: "Error creating purchase", error: error.message });
    }
  }
);

// Get purchases for a group - student sees own, teacher/admin sees all.
router.get(
  "/:id/purchases",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const group = await Group.findById(req.params.id);

      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      if (req.user!.role === "STUDENT") {
        if (!group.students.some((s) => s.toString() === req.user!._id.toString())) {
          res.status(403).json({ message: "You must be a member of this group" });
          return;
        }
        const purchases = await Purchase.find({
          groupId: group._id,
          studentId: req.user!._id,
        })
          .sort("-createdAt")
          .lean();
        res.json({
          success: true,
          data: purchases,
          entitlement: computeEntitlement(purchases),
        });
        return;
      }

      if (req.user!.role === "TEACHER") {
        if (group.teacherId.toString() !== req.user!._id.toString()) {
          res.status(403).json({ message: "Forbidden" });
          return;
        }
      } else if (req.user!.role !== "ADMIN") {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const purchases = await Purchase.find({ groupId: group._id })
        .populate("studentId", "name email phone")
        .sort("-createdAt")
        .lean();

      res.json({ success: true, data: purchases });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching purchases", error: error.message });
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

      const { title, subject, grade, stage, googleMeetLink, scheduleDays, learningPoints, descriptionVideo } = req.body;

      if (scheduleDays) {
        if (!Array.isArray(scheduleDays) || scheduleDays.length === 0) {
          res.status(400).json({ message: "يرجى إضافة موعد حصة واحد على الأقل" });
          return;
        }
        const conflict = checkScheduleConflicts(scheduleDays, req.user!._id.toString(), group._id.toString());
        if (conflict) {
          res.status(400).json({ message: conflict });
          return;
        }
      }

      if (title) group.title = title;
      if (subject) group.subject = subject;
      if (grade) group.grade = grade;
      if (stage) group.stage = stage;
      if (googleMeetLink !== undefined) group.googleMeetLink = googleMeetLink;
      if (learningPoints !== undefined) group.learningPoints = normalizeLearningPoints(learningPoints);
      if (descriptionVideo !== undefined) group.descriptionVideo = (descriptionVideo || "").trim();
      if (scheduleDays) group.scheduleDays = scheduleDays;

      await group.save();
      await cache.delete(`group:${group._id}`);
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
      // Cascade cleanup of related records so no dangling references remain
      await Purchase.deleteMany({ groupId: req.params.id });

      // Best-effort cleanup of every file this group owns in Supabase Storage:
      // lessons' recorded videos + uploaded documents, live session recordings,
      // and the group's description video.
      const lessonFiles = await Lesson.find({ groupId: req.params.id })
        .select("videoUrl documentUrl recordedLiveVideoUrl recordedVideoUrl documents")
        .lean();
      for (const lesson of lessonFiles) {
        const paths = [
          toStorageVideoPath(lesson.videoUrl || ""),
          toStorageVideoPath(lesson.recordedLiveVideoUrl || ""),
          toStorageVideoPath(lesson.recordedVideoUrl || ""),
          toStoragePath(lesson.documentUrl || ""),
          ...(Array.isArray(lesson.documents)
            ? lesson.documents.map((d: string) => toStoragePath(d || ""))
            : []),
        ].filter((p): p is string => Boolean(p));
        for (const path of paths) {
          try {
            await deleteFile(path);
          } catch (e) {
            console.warn("Failed to delete group lesson file:", e);
          }
        }
      }

      const sessionRecordings = await Session.find({ groupId: req.params.id })
        .select("supabaseVideoPath")
        .lean();
      for (const session of sessionRecordings) {
        const path = toStorageSessionPath(session.supabaseVideoPath || "");
        if (!path) continue;
        try {
          await deleteFile(path);
        } catch (e) {
          console.warn("Failed to delete session recording:", e);
        }
      }

      const descriptionVideoPath = toStorageGroupVideoPath(group.descriptionVideo || "");
      if (descriptionVideoPath) {
        try {
          await deleteFile(descriptionVideoPath);
        } catch (e) {
          console.warn("Failed to delete group description video:", e);
        }
      }

      const sessionIds = (await Session.find({ groupId: req.params.id }).select("_id").lean()).map(
        (s: any) => s._id
      );
      if (sessionIds.length > 0) {
        await Attendance.deleteMany({ sessionId: { $in: sessionIds } });
        await Session.deleteMany({ _id: { $in: sessionIds } });
      }
      await GroupInvitation.deleteMany({ groupId: req.params.id });
      await cache.delete(`group:${req.params.id}`);
      await cache.deleteByPattern("groups:list:*");
      await cache.deleteByPattern("groups:stats:*");
      await cache.deleteByPattern("admin:groups:*");
      await cache.deleteByPattern("attendance:*");
      res.json({ message: "Group deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting group", error: error.message });
    }
  }
);

// Add existing student to group - direct add (student views group activities,
// purchases lessons separately). No student-side acceptance required.
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

      if (group.students.some((s) => s.toString() === String(studentId))) {
        res.status(409).json({ message: "Student already in group" });
        return;
      }

      const maxStudents = group.maxStudentsPerGroup || 20;
      if (group.students.length >= maxStudents) {
        res.status(409).json({ message: "Group has reached maximum capacity" });
        return;
      }

      const student = await User.findById(studentId);
      if (!student) {
        res.status(404).json({ message: "Student not found" });
        return;
      }

      if (!group.students.includes(student._id)) {
        group.students.push(student._id);
        await group.save();
      }

      await User.findByIdAndUpdate(student._id, {
        $addToSet: { groups: group._id },
        $set: { stage: student.stage || group.stage || "", grade: student.grade || group.grade || "" },
      });

      const invitation = await GroupInvitation.create({
        groupId: group._id,
        studentId: student._id,
        teacherId: group.teacherId,
        status: "ACCEPTED",
        stage: student.stage || group.stage || "",
        grade: student.grade || group.grade || "",
        subject: group.subject,
      });

      const teacher = await User.findById(group.teacherId).select("name");
      const loginUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`;

      if (teacher) {
        sendGroupInvitationEmail(
          student.name,
          student.email,
          group.title,
          group.subject,
          teacher.name,
          group.scheduleDays || [],
          loginUrl,
          undefined,
          student.stage || group.stage || "",
          student.grade || group.grade || ""
        ).catch((err) => console.error("Failed to send group invitation email:", err));
      }

      await createNotification({
        userId: student._id,
        title: "تمت إضافتك لمجموعة",
        message: `تمت إضافتك إلى مجموعة ${group.title} - يمكنك الآن متابعة أنشطة المجموعة`,
        type: "SUCCESS",
        category: "GROUP",
        link: "/student/my-groups",
      });

      const admins = await User.find({ role: "ADMIN" });
      for (const admin of admins) {
        await createNotification({
          userId: admin._id,
          title: "طالب جديد في مجموعة",
          message: `المعلم ${teacher?.name || "غير معروف"} أضاف الطالب ${student.name} إلى مجموعة ${group.title}`,
          type: "INFO",
          category: "GROUP",
          link: "/admin",
        });
      }

      await cache.deleteByPattern("groups:list:*");
      await cache.deleteByPattern("groups:stats:*");
      await cache.deleteByPattern("admin:groups:*");
      await cache.delete(`group:${group._id}`);

      res.status(201).json({
        success: true,
        data: invitation,
        message: "Student added to group successfully",
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error adding student", error: error.message });
    }
  }
);

// Create student and add to group (teacher only)
router.post(
  "/:id/students/create",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { name, email, phone, stage, grade, parentName, parentEmail, parentPhone } = req.body;
      const group = await Group.findById(req.params.id);

      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      if (group.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      if (!name || !email || !phone) {
        res.status(400).json({ message: "Name, email, and phone are required" });
        return;
      }

      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        res.status(409).json({ message: "Email already exists" });
        return;
      }

      const maxStudents = group.maxStudentsPerGroup || 20;
      if (group.students.length >= maxStudents) {
        res.status(409).json({ message: "Group has reached maximum capacity" });
        return;
      }

      const password = generatePassword();
      const passwordHash = await bcrypt.hash(password, 12);

      const student = await User.create({
        name,
        email: email.toLowerCase(),
        phone,
        passwordHash,
        role: "STUDENT",
        stage: stage || group.stage || "",
        grade: grade || group.grade || "",
      });

      if (!group.students.includes(student._id)) {
        group.students.push(student._id);
        await group.save();
      }

      await User.findByIdAndUpdate(student._id, {
        $addToSet: { groups: group._id },
        $set: { stage: stage || group.stage || "", grade: grade || group.grade || "" },
      });
      const invitation = await GroupInvitation.create({
        groupId: group._id,
        studentId: student._id,
        teacherId: group.teacherId,
        status: "ACCEPTED",
        stage: stage || group.stage || "",
        grade: grade || group.grade || "",
        subject: group.subject,
        password,
      });

      const teacher = await User.findById(group.teacherId).select("name");
      const loginUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/login`;

      if (teacher) {
        sendStudentGroupWelcomeEmail(
          student.name,
          student.email,
          password,
          group.title,
          group.subject,
          teacher.name,
          group.scheduleDays || [],
          stage || group.stage || "",
          grade || group.grade || "",
          loginUrl
        ).catch((err) => console.error("Failed to send student welcome email:", err));
      }

      await createNotification({
        userId: student._id,
        title: "تمت إضافتك لمجموعة",
        message: `تم إنشاء حسابك وإضافتك إلى مجموعة ${group.title} - يمكنك الآن متابعة أنشطة المجموعة`,
        type: "SUCCESS",
        category: "GROUP",
        link: "/student/my-groups",
      });

      // Optional parent info: create/link a PARENT account and email it.
      let parentGeneratedPassword: string | undefined;
      let parentLinked = false;
      if (parentEmail) {
        const normalizedParentEmail = String(parentEmail).trim().toLowerCase();
        const existingParent = await User.findOne({ email: normalizedParentEmail });
        if (existingParent) {
          if (existingParent.role === "PARENT") {
            await User.findByIdAndUpdate(existingParent._id, {
              $addToSet: { students: student._id },
            });
            await User.findByIdAndUpdate(student._id, { $set: { parentId: existingParent._id } });
            parentLinked = true;
            sendParentGroupWelcomeEmail(
              existingParent.name || parentName || "ولي أمر",
              normalizedParentEmail,
              undefined,
              student.name,
              group.title,
              group.subject,
              teacher?.name || "غير محدد",
              group.scheduleDays || [],
              stage || group.stage || "",
              grade || group.grade || "",
              loginUrl
            ).catch((err) => console.error("Failed to send parent welcome email:", err));
          } else {
            console.warn(
              `Parent email ${normalizedParentEmail} already belongs to a ${existingParent.role} account; skipping parent link`
            );
          }
        } else {
          const parentPassword = generatePassword();
          const parentPasswordHash = await bcrypt.hash(parentPassword, 12);
          const parent = await User.create({
            name: parentName?.trim() || `ولي أمر ${student.name}`,
            email: normalizedParentEmail,
            phone: parentPhone?.trim() || student.phone,
            passwordHash: parentPasswordHash,
            role: "PARENT",
            students: [student._id],
          });
          await User.findByIdAndUpdate(student._id, { $set: { parentId: parent._id } });
          parentGeneratedPassword = parentPassword;
          parentLinked = true;
          sendParentGroupWelcomeEmail(
            parent.name,
            normalizedParentEmail,
            parentPassword,
            student.name,
            group.title,
            group.subject,
            teacher?.name || "غير محدد",
            group.scheduleDays || [],
            stage || group.stage || "",
            grade || group.grade || "",
            loginUrl
          ).catch((err) => console.error("Failed to send parent welcome email:", err));
        }
      }

      const admins = await User.find({ role: "ADMIN" });
      for (const admin of admins) {
        await createNotification({
          userId: admin._id,
          title: "طالب جديد في مجموعة",
          message: `المعلم ${teacher?.name || "غير معروف"} أنشأ حساب للطالب ${student.name} وأضافه إلى مجموعة ${group.title}`,
          type: "INFO",
          category: "GROUP",
          link: "/admin",
        });
      }

      await cache.deleteByPattern("groups:list:*");
      await cache.deleteByPattern("groups:stats:*");
      await cache.deleteByPattern("admin:groups:*");
      await cache.delete(`group:${group._id}`);

      res.status(201).json({
        success: true,
        data: student,
        generatedPassword: password,
        parentLinked,
        parentGeneratedPassword,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error creating student", error: error.message });
    }
  }
);

// Get suggested students for a group (teacher only - must be owner)
// - With "search": find STUDENT accounts by name/email/phone
// - Without "search": list all students in the same stage & grade as the group
// Both exclude students already in the group and flag those with a pending invitation.
router.get(
  "/:id/suggested-students",
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

      const { search } = req.query;
      const query: any = { role: "STUDENT" };

      if (search) {
        const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const searchRegex = new RegExp(escaped, "i");
        query.$or = [
          { name: searchRegex },
          { email: searchRegex },
          { phone: searchRegex },
        ];
      } else {
        if (group.stage) query.stage = group.stage;
        if (group.grade) query.grade = group.grade;
      }

      const students = await User.find(query)
        .select("name email phone avatarUrl stage grade")
        .sort("name")
        .limit(60)
        .lean();

      const alreadyInGroup = new Set(
        (group.students || []).map((id: any) => id.toString())
      );

      const data = students
        .filter((s: any) => !alreadyInGroup.has(s._id.toString()))
        .map((s: any) => ({
          id: s._id,
          name: s.name,
          email: s.email,
          phone: s.phone || "",
          avatarUrl: s.avatarUrl,
          stage: s.stage || "",
          grade: s.grade || "",
        }));

      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({
        message: "Error fetching suggested students",
        error: error.message,
      });
    }
  }
);

// Get student's teacher-added group invitations (student only).
// Only TEACHER-initiated invitations appear here; student-initiated join
// requests are surfaced through GET /groups/:id (joinRequest) instead.
router.get(
  "/invitations",
  auth,
  requireRole("STUDENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const invitations = await GroupInvitation.find({
        studentId: req.user!._id,
        initiator: "TEACHER",
      })
        .populate("groupId", "title subject grade stage scheduleDays totalSessionPrice students")
        .populate("teacherId", "name email")
        .sort({ createdAt: -1 })
        .lean();

      // A student may have multiple invitation records for the same group
      // (e.g. re-added after removal). Deduplicate by group keeping the
      // latest record, and flag whether the student is still a member so
      // stale "added" records can be shown correctly on the frontend.
      const studentIdStr = req.user!._id.toString();
      const seen = new Set<string>();
      const data: any[] = [];
      for (const inv of invitations as any[]) {
        const gid = inv.groupId?._id?.toString();
        if (!gid || seen.has(gid)) continue;
        seen.add(gid);
        const isMember = (inv.groupId?.students || []).some(
          (s: any) => (s?._id || s)?.toString() === studentIdStr
        );
        const { students, ...groupInfo } = inv.groupId || {};
        data.push({
          _id: inv._id,
          groupId: groupInfo,
          teacherId: inv.teacherId,
          stage: inv.stage,
          grade: inv.grade,
          subject: inv.subject,
          status: inv.status,
          createdAt: inv.createdAt,
          isMember,
        });
      }

      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching invitations", error: error.message });
    }
  }
);

// Accept invitation (student only)
router.post(
  "/invitations/:id/accept",
  auth,
  requireRole("STUDENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const invitation = await GroupInvitation.findById(req.params.id);

      if (!invitation) {
        res.status(404).json({ message: "Invitation not found" });
        return;
      }

      if (invitation.studentId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      if (invitation.status !== "PENDING") {
        res.status(400).json({ message: "Invitation has already been processed" });
        return;
      }

      if (invitation.initiator === "STUDENT") {
        res.status(400).json({ message: "هذا الطلب بانتظار رد المعلم" });
        return;
      }

      const group = await Group.findById(invitation.groupId);
      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      if (!group.students.includes(invitation.studentId)) {
        group.students.push(invitation.studentId);
        await group.save();
      }

      await User.findByIdAndUpdate(invitation.studentId, {
        $addToSet: { groups: group._id },
        $set: { stage: invitation.stage, grade: invitation.grade },
      });

      invitation.status = "ACCEPTED";
      await invitation.save();

      const student = await User.findById(invitation.studentId).select("name");
      const teacher = await User.findById(invitation.teacherId).select("name");

      if (teacher) {
        await createNotification({
          userId: invitation.teacherId,
          title: "تم قبول الدعوة",
          message: `الطالب ${student?.name || "غير معروف"} قبل دعوة الانضمام إلى مجموعة ${group.title}`,
          type: "SUCCESS",
          category: "GROUP",
          link: `/teacher/groups/${group._id}`,
        });

        try {
          await sendInvitationAcceptedEmail(
            teacher.name || "معلم",
            teacher.email,
            student?.name || "طالب",
            group.title,
            group.subject,
            `${process.env.FRONTEND_URL || "http://localhost:3000"}/teacher/groups/${group._id}`
          );
          console.log(`✅ Acceptance email sent to teacher ${teacher.email}`);
        } catch (emailError) {
          console.error("⚠️ Failed to send acceptance email:", emailError);
        }
      }

      const admins = await User.find({ role: "ADMIN" });
      for (const admin of admins) {
        await createNotification({
          userId: admin._id,
          title: "تم قبول دعوة مجموعة",
          message: `الطالب ${student?.name || "غير معروف"} قبل دعوة الانضمام إلى مجموعة ${group.title}`,
          type: "INFO",
          category: "GROUP",
          link: "/admin",
        });
      }

      res.json({ success: true, message: "Invitation accepted", data: invitation });
    } catch (error: any) {
      res.status(500).json({ message: "Error accepting invitation", error: error.message });
    }
  }
);

// Reject invitation (student only)
router.post(
  "/invitations/:id/reject",
  auth,
  requireRole("STUDENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const invitation = await GroupInvitation.findById(req.params.id);

      if (!invitation) {
        res.status(404).json({ message: "Invitation not found" });
        return;
      }

      if (invitation.studentId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      if (invitation.status !== "PENDING") {
        res.status(400).json({ message: "Invitation has already been processed" });
        return;
      }

      if (invitation.initiator === "STUDENT") {
        res.status(400).json({ message: "هذا الطلب بانتظار رد المعلم" });
        return;
      }

      invitation.status = "REJECTED";
      await invitation.save();

      const group = await Group.findById(invitation.groupId);
      const student = await User.findById(invitation.studentId).select("name");
      const teacher = await User.findById(invitation.teacherId).select("name");

      if (teacher) {
        await createNotification({
          userId: invitation.teacherId,
          title: "تم رفض الدعوة",
          message: `الطالب ${student?.name || "غير معروف"} رفض دعوة الانضمام إلى مجموعة ${group?.title || "غير معروف"}`,
          type: "WARNING",
          category: "GROUP",
          link: "/teacher/groups",
        });

        try {
          await sendInvitationRejectedEmail(
            teacher.name || "معلم",
            teacher.email,
            student?.name || "طالب",
            group?.title || "غير معروف",
            `${process.env.FRONTEND_URL || "http://localhost:3000"}/teacher/groups`
          );
          console.log(`✅ Rejection email sent to teacher ${teacher.email}`);
        } catch (emailError) {
          console.error("⚠️ Failed to send rejection email:", emailError);
        }
      }

      const admins = await User.find({ role: "ADMIN" });
      for (const admin of admins) {
        await createNotification({
          userId: admin._id,
          title: "تم رفض دعوة مجموعة",
          message: `الطالب ${student?.name || "غير معروف"} رفض دعوة الانضمام إلى مجموعة ${group?.title || "غير معروف"}`,
          type: "INFO",
          category: "GROUP",
          link: "/admin",
        });
      }

      res.json({ success: true, message: "Invitation rejected", data: invitation });
    } catch (error: any) {
      res.status(500).json({ message: "Error rejecting invitation", error: error.message });
    }
  }
);

// Student requests to join a group (student only). The teacher reviews the
// request and accepts/rejects it via /join-requests routes below.
router.post(
  "/:id/join-request",
  auth,
  requireRole("STUDENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const group = await Group.findById(req.params.id);
      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      const studentId = req.user!._id.toString();
      if ((group.students || []).some((s: any) => s.toString() === studentId)) {
        res.status(409).json({ message: "أنت عضو بالفعل في هذه المجموعة" });
        return;
      }

      const existing = await GroupInvitation.findOne({
        groupId: group._id,
        studentId: req.user!._id,
        status: "PENDING",
        initiator: "STUDENT",
      });
      if (existing) {
        res.status(409).json({ message: "لديك طلب انضمام قيد المراجعة لهذه المجموعة" });
        return;
      }

      const student = await User.findById(req.user!._id).select("name stage grade");
      const invitation = await GroupInvitation.create({
        groupId: group._id,
        studentId: req.user!._id,
        teacherId: group.teacherId,
        status: "PENDING",
        initiator: "STUDENT",
        stage: student?.stage || group.stage || "",
        grade: student?.grade || group.grade || "",
        subject: group.subject,
      });

      await createNotification({
        userId: group.teacherId,
        title: "طلب انضمام جديد",
        message: `الطالب ${student?.name || "غير معروف"} طلب الانضمام إلى مجموعتك "${group.title}"`,
        type: "INFO",
        category: "GROUP",
        link: `/teacher/groups/${group._id}`,
      });

      await cache.delete(`group:${group._id}`);
      res.status(201).json({ success: true, data: invitation, message: "تم إرسال طلب الانضمام للمعلم" });
    } catch (error: any) {
      res.status(500).json({ message: "Error creating join request", error: error.message });
    }
  }
);

// Student unlinks himself from a group (student only). Cleans up entitlement.
router.delete(
  "/:id/membership",
  auth,
  requireRole("STUDENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const group = await Group.findById(req.params.id);
      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      const studentId = req.user!._id.toString();
      const isMember = (group.students || []).some((s: any) => s.toString() === studentId);
      if (!isMember) {
        res.status(400).json({ message: "لست عضواً في هذه المجموعة" });
        return;
      }

      group.students = group.students.filter((s: any) => s.toString() !== studentId);
      await group.save();

      await User.findByIdAndUpdate(req.user!._id, { $pull: { groups: group._id } });

      await Purchase.deleteMany({ groupId: group._id, studentId: req.user!._id });
      await GroupInvitation.deleteMany({
        groupId: group._id,
        studentId: req.user!._id,
        status: "PENDING",
      });

      const student = await User.findById(req.user!._id).select("name");
      await createNotification({
        userId: group.teacherId,
        title: "انسحاب طالب من مجموعة",
        message: `انسحب الطالب ${student?.name || "غير معروف"} من مجموعة "${group.title}"`,
        type: "INFO",
        category: "GROUP",
        link: `/teacher/groups/${group._id}`,
      });

      await cache.deleteByPattern("groups:list:*");
      await cache.deleteByPattern("groups:stats:*");
      await cache.deleteByPattern("admin:groups:*");
      await cache.delete(`group:${group._id}`);

      res.json({ success: true, message: "تم إلغاء اشتراكك في المجموعة" });
    } catch (error: any) {
      res.status(500).json({ message: "Error leaving group", error: error.message });
    }
  }
);

// Teacher: list all pending student join requests across the teacher's groups.
router.get(
  "/join-requests",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const requests = await GroupInvitation.find({
        teacherId: req.user!._id,
        status: "PENDING",
        initiator: "STUDENT",
      })
        .populate("groupId", "title subject grade stage")
        .populate("studentId", "name email phone avatarUrl stage grade")
        .sort({ createdAt: -1 })
        .lean();

      res.json({
        success: true,
        data: requests.map((r: any) => ({
          id: r._id,
          group: r.groupId,
          student: r.studentId,
          status: r.status,
          createdAt: r.createdAt,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching join requests", error: error.message });
    }
  }
);

// Teacher: list pending join requests for one of his groups.
router.get(
  "/:id/join-requests",
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

      const requests = await GroupInvitation.find({
        groupId: group._id,
        status: "PENDING",
        initiator: "STUDENT",
      })
        .populate("studentId", "name email phone avatarUrl stage grade")
        .sort({ createdAt: -1 })
        .lean();

      res.json({
        success: true,
        data: requests.map((r: any) => ({
          id: r._id,
          student: r.studentId,
          status: r.status,
          createdAt: r.createdAt,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching join requests", error: error.message });
    }
  }
);

// Teacher: accept a student's join request (adds the student to the group).
router.post(
  "/join-requests/:requestId/accept",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const invitation = await GroupInvitation.findById(req.params.requestId);
      if (!invitation) {
        res.status(404).json({ message: "Request not found" });
        return;
      }
      if (invitation.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
      if (invitation.status !== "PENDING" || invitation.initiator !== "STUDENT") {
        res.status(400).json({ message: "الطلب تمت معالجته بالفعل" });
        return;
      }

      const group = await Group.findById(invitation.groupId);
      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      const studentIdStr = invitation.studentId.toString();
      if (!(group.students || []).some((s: any) => s.toString() === studentIdStr)) {
        if (group.students.length >= (group.maxStudentsPerGroup || 20)) {
          res.status(409).json({ message: "المجموعة ممتلئة" });
          return;
        }
        group.students.push(invitation.studentId);
        await group.save();
      }

      await User.findByIdAndUpdate(invitation.studentId, {
        $addToSet: { groups: group._id },
        $set: {
          stage: invitation.stage || group.stage || "",
          grade: invitation.grade || group.grade || "",
        },
      });

      invitation.status = "ACCEPTED";
      await invitation.save();

      const student = await User.findById(invitation.studentId).select("name");
      await createNotification({
        userId: invitation.studentId,
        title: "تم قبول طلب الانضمام",
        message: `وافق المعلم على طلب انضمامك إلى مجموعة "${group.title}" - يمكنك الآن متابعة أنشطة المجموعة`,
        type: "SUCCESS",
        category: "GROUP",
        link: `/student/my-groups/${group._id}`,
      });

      const admins = await User.find({ role: "ADMIN" });
      for (const admin of admins) {
        await createNotification({
          userId: admin._id,
          title: "طلب انضمام مقبول",
          message: `الطالب ${student?.name || "غير معروف"} انضم إلى مجموعة ${group.title}`,
          type: "INFO",
          category: "GROUP",
          link: "/admin",
        });
      }

      await cache.deleteByPattern("groups:list:*");
      await cache.deleteByPattern("groups:stats:*");
      await cache.deleteByPattern("admin:groups:*");
      await cache.delete(`group:${group._id}`);

      res.json({ success: true, message: "تم قبول الطلب", data: invitation });
    } catch (error: any) {
      res.status(500).json({ message: "Error accepting request", error: error.message });
    }
  }
);

// Teacher: reject a student's join request.
router.post(
  "/join-requests/:requestId/reject",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const invitation = await GroupInvitation.findById(req.params.requestId);
      if (!invitation) {
        res.status(404).json({ message: "Request not found" });
        return;
      }
      if (invitation.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
      if (invitation.status !== "PENDING" || invitation.initiator !== "STUDENT") {
        res.status(400).json({ message: "الطلب تمت معالجته بالفعل" });
        return;
      }

      const group = await Group.findById(invitation.groupId);
      invitation.status = "REJECTED";
      await invitation.save();

      await createNotification({
        userId: invitation.studentId,
        title: "تم رفض طلب الانضمام",
        message: `آسف، رفض المعلم طلب انضمامك إلى مجموعة "${group?.title || "غير معروف"}"`,
        type: "WARNING",
        category: "GROUP",
        link: "/groups",
      });

      res.json({ success: true, message: "تم رفض الطلب", data: invitation });
    } catch (error: any) {
      res.status(500).json({ message: "Error rejecting request", error: error.message });
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

      await User.findByIdAndUpdate(req.params.studentId, { $pull: { groups: group._id } });

      res.json(group);
    } catch (error: any) {
      res.status(500).json({ message: "Error removing student", error: error.message });
    }
  }
);

export default router;

// ============================================================
// Lessons
// ============================================================

// Upload an attachment (video / document) for a lesson (teacher, group owner).
// Recorded videos go to the private lesson-videos bucket, everything else to
// documents. Returns the bucket-relative path; lesson videos are served through
// the authenticated proxy route, never as public URLs.
router.post(
  "/:id/lessons/upload",
  auth,
  requireRole("TEACHER"),
  lessonUpload.single("file"),
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

      if (!req.file) {
        res.status(400).json({ message: "No file uploaded" });
        return;
      }

      const userId = req.user!._id.toString();
      const fileExt = req.file.originalname.split(".").pop() || "bin";
      const safeExt = fileExt.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
      const fileName = `${userId}-${Date.now()}.${safeExt}`;
      const isVideo = req.file.mimetype.startsWith("video/");
      const filePath = `${isVideo ? LESSON_VIDEOS_BUCKET : "documents"}/lessons/${fileName}`;

      const uploadResult = await uploadFile(filePath, req.file.buffer, req.file.mimetype);
      if (!uploadResult) {
        res.status(500).json({ message: "Failed to upload file" });
        return;
      }

      res.json({ success: true, url: filePath, mimeType: req.file.mimetype });
    } catch (error: any) {
      console.error("Lesson upload error:", error);
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          res.status(400).json({ message: "حجم الملف يجب أن يكون أقل من 200 ميجابايت" });
          return;
        }
      }
      res.status(500).json({ message: "Error uploading file", error: error.message });
    }
  }
);

// Create a signed upload URL so the browser can upload large lesson files
// (recorded videos) directly to Supabase Storage. Backend-buffered uploads
// cannot handle 4K videos or Vercel's serverless body limit, and this keeps
// files in the private buckets without ever exposing a public URL.
router.post(
  "/:id/lessons/upload-url",
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

      const { filename, mimeType } = req.body || {};
      if (!filename || !mimeType) {
        res.status(400).json({ message: "filename and mimeType are required" });
        return;
      }

      const isVideo = String(mimeType).startsWith("video/");
      const bucket = isVideo ? LESSON_VIDEOS_BUCKET : "documents";
      const ext = (String(filename).split(".").pop() || (isVideo ? "mp4" : "bin"))
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 8);
      const userId = req.user!._id.toString();
      const fullPath = `${bucket}/lessons/${userId}-${Date.now()}.${ext}`;

      const signed = await createSignedUploadUrl(
        bucket,
        fullPath.replace(`${bucket}/`, "")
      );
      if (!signed) {
        res.status(500).json({ message: "Failed to create upload URL" });
        return;
      }

      res.json({
        success: true,
        bucket,
        path: fullPath.replace(`${bucket}/`, ""),
        fullPath,
        token: signed.token,
        uploadUrl: signed.uploadUrl,
        mimeType,
      });
    } catch (error: any) {
      console.error("Lesson upload URL error:", error);
      res.status(500).json({ message: "Error creating upload URL", error: error.message });
    }
  }
);

// Create a lesson in a group (teacher, group owner).
// Every new lesson is a live session (meetingLink + scheduleDay/scheduleTime are
// required) that may bundle optional extras: a recorded video, multiple documents
// and multiple reference links. The recording of the live session itself is added
// later through a separate upload action once the session has finished.
router.post(
  "/:id/lessons",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const {
        title,
        description,
        meetingLink,
        scheduleDay,
        scheduleTime,
        recordedVideoUrl,
        documents,
        referenceLinks,
      } = req.body;
      const group = await Group.findById(req.params.id);

      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }
      if (group.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
      if (!title || !title.trim()) {
        res.status(400).json({ message: "عنوان الدرس مطلوب" });
        return;
      }
      if (!meetingLink || !meetingLink.trim()) {
        res.status(400).json({ message: "رابط اجتماع الدرس المباشر مطلوب" });
        return;
      }
      if (!scheduleDay || !scheduleTime) {
        res.status(400).json({ message: "يرجى اختيار يوم ووقت الحصة من جدول المجموعة" });
        return;
      }

      // Private lesson content must live inside our own buckets; external links
      // (YouTube, Google Drive, ...) are not allowed for videos or documents.
      if (isExternalStoredUrl(recordedVideoUrl)) {
        res.status(400).json({ message: "الروابط الخارجية للفيديوهات غير مسموحة — ارفع الفيديو داخل المنصة" });
        return;
      }
      const incomingDocuments = Array.isArray(documents) ? documents : [];
      if (incomingDocuments.some((d: string) => isExternalStoredUrl(d))) {
        res.status(400).json({ message: "الروابط الخارجية للمستندات غير مسموحة — ارفع الملف داخل المنصة" });
        return;
      }

      const lesson = await Lesson.create({
        groupId: group._id,
        teacherId: req.user!._id,
        title: title.trim(),
        description: description?.trim() || "",
        type: "LIVE",
        meetingLink: meetingLink.trim(),
        recordedVideoUrl: normalizeStoredUrl(recordedVideoUrl),
        documents: normalizeLessonList(documents, true),
        referenceLinks: normalizeLessonList(referenceLinks, false),
        scheduleDay: scheduleDay.trim(),
        scheduleTime: scheduleTime.trim(),
        scheduledAt: nextScheduledDate(scheduleDay, scheduleTime),
      });

      // Notify enrolled students about the new lesson
      const students = await User.find({ _id: { $in: group.students } }).select("_id");
      for (const student of students) {
        await createNotification({
          userId: student._id,
          title: "درس جديد في مجموعتك",
          message: `تمت إضافة "${lesson.title}" إلى مجموعة ${group.title}`,
          type: "INFO",
          category: "GROUP",
          link: `/student/my-groups/${group._id}`,
        });
      }

      await cache.delete(`group:${group._id}`);
      await cache.deleteByPattern(`lessons:${group._id}:*`);

      res.status(201).json({ success: true, data: lesson });
    } catch (error: any) {
      res.status(500).json({ message: "Error creating lesson", error: error.message });
    }
  }
);

// List lessons of a group (teacher owner or enrolled student).
router.get(
  "/:id/lessons",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const group = await Group.findById(req.params.id).select("teacherId students");
      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      const isTeacher = group.teacherId.toString() === req.user!._id.toString();
      const isStudent = (group.students || []).some(
        (s: any) => s.toString() === req.user!._id.toString()
      );
      if (!isTeacher && !isStudent && req.user!.role !== "ADMIN") {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const lessons = await Lesson.find({ groupId: group._id })
        .sort({ createdAt: -1 })
        .lean();

      // Students only get lesson content once they have paid for that specific
      // lesson (opened it). The list exposes lesson metadata + which lessons
      // are already unlocked; the content itself is delivered by the
      // POST /:id/lessons/:lessonId/open endpoint, which consumes one credit.
      const isPrivileged = isTeacher || req.user!.role === "ADMIN";
      let hasAccess = true;
      let remainingCredits = 0;
      let monthlyActive = false;
      if (isStudent && !isPrivileged) {
        const purchases = await Purchase.find({
          groupId: group._id,
          studentId: req.user!._id,
        }).lean();
        const entitlement = computeEntitlement(purchases);
        hasAccess = entitlement.hasAccess;
        remainingCredits = entitlement.remainingCredits;
        monthlyActive = entitlement.monthlyActive;

        const accesses = await LessonAccess.find({
          groupId: group._id,
          studentId: req.user!._id,
        })
          .select("lessonId")
          .lean();
        const openedIds = new Set(
          accesses.map((a) => String((a as any).lessonId))
        );

        for (const lesson of lessons) {
          (lesson as any).opened = openedIds.has(String(lesson._id));
          (lesson as any).hasRecordedVideo = Boolean(
            lesson.recordedLiveVideoUrl ||
              lesson.recordedVideoUrl ||
              lesson.videoUrl
          );
          (lesson as any).hasDocuments = Boolean(
            lesson.documentUrl ||
              (Array.isArray(lesson.documents) && lesson.documents.length > 0)
          );
          (lesson as any).hasLinks = Boolean(
            lesson.referenceUrl ||
              (Array.isArray(lesson.referenceLinks) && lesson.referenceLinks.length > 0)
          );
          delete lesson.description;
          delete lesson.meetingLink;
          delete lesson.videoUrl;
          delete lesson.documentUrl;
          delete lesson.referenceUrl;
          delete lesson.recordedLiveVideoUrl;
          delete lesson.recordedVideoUrl;
          delete lesson.documents;
          delete lesson.referenceLinks;
        }
      }

      // Present a unified shape to privileged clients: every lesson exposes
      // documents[] and referenceLinks[] (legacy single-value fields are folded
      // into the arrays), so the frontend never has to special-case old lessons.
      if (isPrivileged) {
        for (const lesson of lessons) {
          lesson.documents =
            Array.isArray(lesson.documents) && lesson.documents.length
              ? lesson.documents
              : lesson.documentUrl
              ? [lesson.documentUrl]
              : [];
          lesson.referenceLinks =
            Array.isArray(lesson.referenceLinks) && lesson.referenceLinks.length
              ? lesson.referenceLinks
              : lesson.referenceUrl
              ? [lesson.referenceUrl]
              : [];
        }
      }

      // For authorized users, private lesson files are delivered exclusively
      // through authenticated endpoints — never via unauthenticated signed or
      // public URLs. Videos use the video proxy route (?field= selects which
      // video), documents use the document proxy route (?index= selects which
      // file). External links pass through unchanged.
      if (isPrivileged) {
        for (const lesson of lessons) {
          transformLessonForDelivery(req, group._id, lesson);
        }
      }

      res.json({
        success: true,
        data: lessons,
        hasAccess,
        remainingCredits,
        monthlyActive,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching lessons", error: error.message });
    }
  }
);

// A student opens a lesson. The first time, one LECTURES credit is consumed
// (unless a monthly subscription is active); the lesson then stays unlocked
// permanently for that student. The full lesson content — description, live
// meeting link, recorded videos, documents and reference links — is only
// returned here, never from the lessons list for students.
router.post(
  "/:id/lessons/:lessonId/open",
  auth,
  requireRole("STUDENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const group = await Group.findById(req.params.id).select("teacherId students");
      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      const isMember = (group.students || []).some(
        (s: any) => s.toString() === req.user!._id.toString()
      );
      if (!isMember) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const lesson = await Lesson.findOne({
        _id: req.params.lessonId,
        groupId: group._id,
      }).lean();
      if (!lesson) {
        res.status(404).json({ message: "Lesson not found" });
        return;
      }

      const purchases = await Purchase.find({
        groupId: group._id,
        studentId: req.user!._id,
      }).lean();
      const entitlement = computeEntitlement(purchases);

      let opened = entitlement.monthlyActive;
      let consumedCredit = false;

      if (!opened) {
        const access = await LessonAccess.findOne({
          lessonId: lesson._id,
          studentId: req.user!._id,
        }).lean();
        if (access) {
          opened = true;
        } else if (entitlement.remainingCredits > 0) {
          const consumed = await consumeLessonCredit(req.user!._id, group._id);
          if (!consumed) {
            res.status(402).json({
              message: "لا توجد حصص متبقية في رصيدك — اشترِ حصصاً لفتح هذا الدرس",
            });
            return;
          }
          await LessonAccess.create({
            groupId: group._id,
            lessonId: lesson._id,
            studentId: req.user!._id,
          });
          opened = true;
          consumedCredit = true;
        } else {
          res.status(402).json({
            message: "لا توجد حصص متبقية في رصيدك — اشترِ حصصاً لفتح هذا الدرس",
          });
          return;
        }
      }

      // Fold legacy single-value fields and apply the authenticated proxy
      // transform so content is delivered exactly like the privileged list.
      const lessonObj = lesson as any;
      lessonObj.documents =
        Array.isArray(lessonObj.documents) && lessonObj.documents.length
          ? lessonObj.documents
          : lessonObj.documentUrl
          ? [lessonObj.documentUrl]
          : [];
      lessonObj.referenceLinks =
        Array.isArray(lessonObj.referenceLinks) && lessonObj.referenceLinks.length
          ? lessonObj.referenceLinks
          : lessonObj.referenceUrl
          ? [lessonObj.referenceUrl]
          : [];
      const delivered = transformLessonForDelivery(req, group._id, lessonObj);

      res.json({
        success: true,
        data: delivered,
        opened,
        consumedCredit,
        remainingCredits: entitlement.remainingCredits - (consumedCredit ? 1 : 0),
        monthlyActive: entitlement.monthlyActive,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error opening lesson", error: error.message });
    }
  }
);

// Teacher-only preview stream for a recorded lesson video that was just
// uploaded but has no lessonId yet (the proxy route below requires a saved
// lesson). Validates that the path is a lesson-videos object so a teacher can
// only preview their own group's uploads before saving.
router.get(
  "/:id/lessons/video/preview",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const group = await Group.findById(req.params.id);
      if (!group || group.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const videoPath = toStorageVideoPath(String(req.query.path || ""));
      if (!videoPath) {
        res.status(400).json({ message: "Invalid video path" });
        return;
      }

      const upstream = await fetchStorageObject(
        LESSON_VIDEOS_BUCKET,
        videoPath.replace(`${LESSON_VIDEOS_BUCKET}/`, ""),
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
      console.error("Lesson video preview error:", error);
      if (!res.headersSent) res.status(500).json({ message: "Error streaming video" });
      else res.end();
    }
  }
);

// Stream a recorded lesson video through the API so access is re-checked on
// every request. Auth is taken from the JWT cookie, so <video> tags work
// without an Authorization header. Range headers are forwarded to Supabase so
// seeking/scrubbing works. The underlying object lives in the private
// lesson-videos bucket and is never exposed via a public URL. A lesson may
// hold several videos (legacy videoUrl, the recorded live session, or an extra
// recorded video); the ?field= query selects which one to stream.
router.get(
  "/:id/lessons/:lessonId/video",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const group = await Group.findById(req.params.id).select("teacherId students");
      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      const isTeacher = group.teacherId.toString() === req.user!._id.toString();
      const isStudent = (group.students || []).some(
        (s: any) => s.toString() === req.user!._id.toString()
      );

      if (!isTeacher && !isStudent && req.user!.role !== "ADMIN") {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      // Students must have opened (paid for) this lesson to watch, or hold an
      // active monthly subscription. Group-level credits alone are not enough —
      // opening a lesson consumes one credit and records per-lesson access.
      if (isStudent && !isTeacher && req.user!.role !== "ADMIN") {
        const purchases = await Purchase.find({
          groupId: group._id,
          studentId: req.user!._id,
        }).lean();
        let allowed = computeEntitlement(purchases).monthlyActive;
        if (!allowed) {
          const access = await LessonAccess.findOne({
            lessonId: req.params.lessonId,
            studentId: req.user!._id,
          }).lean();
          allowed = Boolean(access);
        }
        if (!allowed) {
          res.status(402).json({ message: "Payment required" });
          return;
        }
      }

      const field =
        req.query.field === "recordedLiveVideoUrl" ||
        req.query.field === "recordedVideoUrl"
          ? req.query.field
          : "videoUrl";

      const lesson = await Lesson.findOne({
        _id: req.params.lessonId,
        groupId: group._id,
      }).select(`${field} type`);
      if (!lesson) {
        res.status(404).json({ message: "Lesson not found" });
        return;
      }

      const stored = (lesson as any)[field] || "";
      const videoPath = toStorageVideoPath(stored);
      if (!videoPath) {
        res.status(400).json({ message: "Lesson has no stored video" });
        return;
      }

      const upstream = await fetchStorageObject(
        LESSON_VIDEOS_BUCKET,
        videoPath.replace(`${LESSON_VIDEOS_BUCKET}/`, ""),
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
      console.error("Lesson video proxy error:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Error streaming video" });
      } else {
        res.end();
      }
    }
  }
);

// Stream a lesson document through the API so access is re-checked on every
// request. Auth is taken from the JWT cookie (works for <a> and <embed> tags
// in the same browser), and students must belong to the group and hold an
// active entitlement (paid). ?index= selects a document from the folded
// documents[] array (legacy documentUrl is included). The object lives in the
// private documents bucket and is never exposed via a public URL.
router.get(
  "/:id/lessons/:lessonId/document",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const group = await Group.findById(req.params.id).select("teacherId students");
      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }

      const isTeacher = group.teacherId.toString() === req.user!._id.toString();
      const isStudent = (group.students || []).some(
        (s: any) => s.toString() === req.user!._id.toString()
      );

      if (!isTeacher && !isStudent && req.user!.role !== "ADMIN") {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      // Students must have opened (paid for) this lesson to view, or hold an
      // active monthly subscription. Group-level credits alone are not enough —
      // opening a lesson consumes one credit and records per-lesson access.
      if (isStudent && !isTeacher && req.user!.role !== "ADMIN") {
        const purchases = await Purchase.find({
          groupId: group._id,
          studentId: req.user!._id,
        }).lean();
        let allowed = computeEntitlement(purchases).monthlyActive;
        if (!allowed) {
          const access = await LessonAccess.findOne({
            lessonId: req.params.lessonId,
            studentId: req.user!._id,
          }).lean();
          allowed = Boolean(access);
        }
        if (!allowed) {
          res.status(402).json({ message: "Payment required" });
          return;
        }
      }

      const lesson = await Lesson.findOne({
        _id: req.params.lessonId,
        groupId: group._id,
      }).select("documents documentUrl type");
      if (!lesson) {
        res.status(404).json({ message: "Lesson not found" });
        return;
      }

      const docs =
        Array.isArray(lesson.documents) && lesson.documents.length
          ? lesson.documents
          : lesson.documentUrl
          ? [lesson.documentUrl]
          : [];

      const index = parseInt(String(req.query.index ?? ""), 10);
      if (!Number.isInteger(index) || index < 0 || index >= docs.length) {
        res.status(400).json({ message: "Invalid document index" });
        return;
      }

      const stored = docs[index];
      const path = toStoragePath(stored);
      if (!path) {
        res.status(400).json({ message: "Lesson has no stored document" });
        return;
      }

      const upstream = await fetchStorageObject(DOCUMENTS_BUCKET, path);

      if (!upstream.body) {
        res.status(upstream.status).end();
        return;
      }

      res.status(upstream.status);
      res.setHeader(
        "Content-Type",
        upstream.headers.get("Content-Type") || "application/octet-stream"
      );
      const contentLength = upstream.headers.get("Content-Length");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Cache-Control", "private, no-transform, max-age=60");
      res.setHeader("X-Content-Type-Options", "nosniff");

      const body: any = upstream.body;
      if (typeof body.getReader === "function") {
        Readable.fromWeb(body, { highWaterMark: 128 * 1024 }).pipe(res);
      } else {
        body.pipe(res);
      }
    } catch (error: any) {
      console.error("Lesson document proxy error:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Error streaming document" });
      } else {
        res.end();
      }
    }
  }
);

// Remux a stored lesson video to faststart MP4 so browsers can start playback
// immediately. Teacher/group owner only. Downloads the object, remuxes it
// server-side with a stream copy (no re-encode), stores the optimized copy and
// points the lesson at it.
router.post(
  "/:id/lessons/:lessonId/video/optimize",
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

      const lesson = await Lesson.findOne({
        _id: req.params.lessonId,
        groupId: group._id,
      });
      if (!lesson) {
        res.status(404).json({ message: "Lesson not found" });
        return;
      }

      const field =
        req.body?.field === "recordedVideoUrl" ? "recordedVideoUrl" : "recordedLiveVideoUrl";
      const stored = (lesson as any)[field];
      const videoPath = toStorageVideoPath(String(stored || ""));
      if (!videoPath) {
        res.status(400).json({ message: "Lesson has no stored video" });
        return;
      }

      const upstream = await fetchStorageObject(
        LESSON_VIDEOS_BUCKET,
        videoPath.replace(`${LESSON_VIDEOS_BUCKET}/`, "")
      );
      if (!upstream.ok || !upstream.body) {
        res.status(upstream.status).json({ message: "Failed to download video" });
        return;
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());

      const optimized = await remuxVideoToFaststart(buffer);

      const userId = req.user!._id.toString();
      const newPath = `lesson-videos/lessons/${userId}-${Date.now()}-optimized.mp4`;
      const uploaded = await uploadFile(newPath, optimized, "video/mp4");
      if (!uploaded) {
        res.status(500).json({ message: "Failed to store optimized video" });
        return;
      }

      (lesson as any)[field] = newPath;
      await lesson.save();

      // Remove the old (unoptimized) object; the lesson now points at the new one.
      if (videoPath !== newPath) {
        await deleteFile(videoPath);
      }

      res.json({ success: true, lesson });
    } catch (error: any) {
      console.error("Lesson video optimize error:", error);
      res.status(500).json({ message: "Error optimizing video", error: error.message });
    }
  }
);

// Update a lesson (teacher, group owner).
router.put(
  "/:id/lessons/:lessonId",
  auth,
  requireRole("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const {
        title,
        description,
        type,
        meetingLink,
        videoUrl,
        documentUrl,
        referenceUrl,
        recordedLiveVideoUrl,
        recordedVideoUrl,
        documents,
        referenceLinks,
        scheduleDay,
        scheduleTime,
      } = req.body;
      const group = await Group.findById(req.params.id);
      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }
      if (group.teacherId.toString() !== req.user!._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      const lesson = await Lesson.findOne({ _id: req.params.lessonId, groupId: group._id });
      if (!lesson) {
        res.status(404).json({ message: "Lesson not found" });
        return;
      }

      const newType = type || lesson.type;
      if (newType === "LIVE" && meetingLink !== undefined && !meetingLink.trim()) {
        res.status(400).json({ message: "رابط اجتماع الدرس المباشر مطلوب" });
        return;
      }
      if (newType === "LIVE" && ((scheduleDay !== undefined && !scheduleDay) || (scheduleTime !== undefined && !scheduleTime))) {
        res.status(400).json({ message: "يرجى اختيار يوم ووقت الحصة من جدول المجموعة" });
        return;
      }
      if (newType === "RECORDED" && videoUrl !== undefined && !videoUrl.trim()) {
        res.status(400).json({ message: "رابط أو ملف الفيديو المسجل مطلوب" });
        return;
      }
      if (newType === "DOCUMENT" && documentUrl !== undefined && !documentUrl.trim()) {
        res.status(400).json({ message: "ملف المستند مطلوب" });
        return;
      }
      if (newType === "LINK" && referenceUrl !== undefined && !referenceUrl.trim()) {
        res.status(400).json({ message: "الرابط المرجعي مطلوب" });
        return;
      }

      // Private lesson content must live inside our own buckets; external links
      // (YouTube, Google Drive, ...) are not allowed for videos or documents.
      if (isExternalStoredUrl(videoUrl)) {
        res.status(400).json({ message: "الروابط الخارجية للفيديوهات غير مسموحة — ارفع الفيديو داخل المنصة" });
        return;
      }
      if (isExternalStoredUrl(recordedLiveVideoUrl)) {
        res.status(400).json({ message: "الروابط الخارجية للفيديوهات غير مسموحة — ارفع الفيديو داخل المنصة" });
        return;
      }
      if (isExternalStoredUrl(recordedVideoUrl)) {
        res.status(400).json({ message: "الروابط الخارجية للفيديوهات غير مسموحة — ارفع الفيديو داخل المنصة" });
        return;
      }
      if (isExternalStoredUrl(documentUrl)) {
        res.status(400).json({ message: "الروابط الخارجية للمستندات غير مسموحة — ارفع الملف داخل المنصة" });
        return;
      }
      const incomingDocuments = Array.isArray(documents) ? documents : [];
      if (incomingDocuments.some((d: string) => isExternalStoredUrl(d))) {
        res.status(400).json({ message: "الروابط الخارجية للمستندات غير مسموحة — ارفع الملف داخل المنصة" });
        return;
      }

      if (title !== undefined) lesson.title = title.trim();
      if (description !== undefined) lesson.description = description.trim();
      if (type !== undefined) lesson.type = newType;
      if (meetingLink !== undefined) lesson.meetingLink = meetingLink.trim();
      if (videoUrl !== undefined) {
        // The UI hands back the proxy URL for a lesson it did not re-upload;
        // keep the stored path in that case instead of persisting the URL.
        if (isProxyVideoUrl(videoUrl, String(req.params.lessonId))) {
          // unchanged
        } else {
          lesson.videoUrl = normalizeStoredUrl(videoUrl);
        }
      }
      if (documentUrl !== undefined) lesson.documentUrl = normalizeStoredUrl(documentUrl);
      if (referenceUrl !== undefined) lesson.referenceUrl = referenceUrl.trim();
      if (recordedLiveVideoUrl !== undefined) {
        if (isProxyVideoUrl(recordedLiveVideoUrl, String(req.params.lessonId))) {
          // unchanged
        } else {
          lesson.recordedLiveVideoUrl = normalizeStoredUrl(recordedLiveVideoUrl);
        }
      }
      if (recordedVideoUrl !== undefined) {
        if (isProxyVideoUrl(recordedVideoUrl, String(req.params.lessonId))) {
          // unchanged
        } else {
          lesson.recordedVideoUrl = normalizeStoredUrl(recordedVideoUrl);
        }
      }
      if (documents !== undefined) {
        const currentDocs =
          Array.isArray(lesson.documents) && lesson.documents.length
            ? lesson.documents
            : lesson.documentUrl
            ? [lesson.documentUrl]
            : [];
        // The UI hands back proxy URLs for files it did not re-upload; map them
        // back to the stored paths so proxy URLs are never persisted.
        const resolved = (Array.isArray(documents) ? documents : []).map(
          (d: string, i: number) =>
            isDocumentProxyUrl(String(d)) && currentDocs[i] ? currentDocs[i] : d
        );
        lesson.documents = normalizeLessonList(resolved, true);
      }
      if (referenceLinks !== undefined) {
        lesson.referenceLinks = normalizeLessonList(referenceLinks, false);
      }
      if (scheduleDay !== undefined) lesson.scheduleDay = scheduleDay.trim();
      if (scheduleTime !== undefined) lesson.scheduleTime = scheduleTime.trim();
      if (scheduleDay !== undefined || scheduleTime !== undefined) {
        lesson.scheduledAt = nextScheduledDate(
          lesson.scheduleDay || "",
          lesson.scheduleTime || ""
        );
      }

      await lesson.save();

      await cache.delete(`group:${group._id}`);
      await cache.deleteByPattern(`lessons:${group._id}:*`);

      res.json({ success: true, data: lesson });
    } catch (error: any) {
      res.status(500).json({ message: "Error updating lesson", error: error.message });
    }
  }
);

// Delete a lesson (teacher, group owner).
router.delete(
  "/:id/lessons/:lessonId",
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

      const lesson = await Lesson.findOneAndDelete({ _id: req.params.lessonId, groupId: group._id });
      if (!lesson) {
        res.status(404).json({ message: "Lesson not found" });
        return;
      }

      // Best-effort cleanup of every file this lesson owns in Supabase Storage:
      // the recorded videos (lesson-videos bucket) and the uploaded documents
      // (documents bucket). Old lessons may hold public URLs, so normalize
      // before deleting.
      const storedFiles = [
        toStorageVideoPath(lesson.videoUrl || ""),
        toStorageVideoPath(lesson.recordedLiveVideoUrl || ""),
        toStorageVideoPath(lesson.recordedVideoUrl || ""),
        toStoragePath(lesson.documentUrl || ""),
        ...(Array.isArray(lesson.documents)
          ? lesson.documents.map((d: string) => toStoragePath(d || ""))
          : []),
      ].filter((p): p is string => Boolean(p));
      for (const path of storedFiles) {
        try {
          await deleteFile(path);
        } catch (e) {
          console.warn("Failed to delete lesson file:", e);
        }
      }

      await cache.delete(`group:${group._id}`);
      await cache.deleteByPattern(`lessons:${group._id}:*`);

      res.json({ success: true, message: "Lesson deleted" });
    } catch (error: any) {
      res.status(500).json({ message: "Error deleting lesson", error: error.message });
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

// Compute the next occurrence of an Arabic weekday + "HH:MM" time as a Date.
const ARABIC_DAY_TO_JS: Record<string, number> = {
  الأحد: 0,
  الاثنين: 1,
  الثلاثاء: 2,
  الأربعاء: 3,
  الخميس: 4,
  الجمعة: 5,
  السبت: 6,
};

function nextScheduledDate(day: string, time: string): Date {
  const target = ARABIC_DAY_TO_JS[day] ?? new Date().getDay();
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(hours || 0, minutes || 0, 0, 0);
  let diff = (target - next.getDay() + 7) % 7;
  next.setDate(next.getDate() + diff);
  if (next.getTime() < now.getTime()) {
    next.setDate(next.getDate() + 7);
  }
  return next;
}