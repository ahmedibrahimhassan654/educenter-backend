import { Router, Response } from "express";
import { Group } from "../models/Group";
import { User } from "../models/User";
import { Settings } from "../models/Settings";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { createNotification } from "../services/notificationService";
import { cache } from "../services/cache";

const router = Router();

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
        data: groups,
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
      const { title, subject, grade, stage, googleMeetLink, scheduleDays } = req.body;

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
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const group = await Group.findById(req.params.id)
        .populate("teacherId", "name email phone verificationData verificationStatus")
        .populate("students", "name email phone");

      if (!group) {
        res.status(404).json({ message: "Group not found" });
        return;
      }
      await cache.set(`group:${req.params.id}`, group, 60);
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

      const { title, subject, grade, stage, googleMeetLink, scheduleDays } = req.body;

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
      await cache.delete(`group:${req.params.id}`);
      await cache.deleteByPattern("groups:list:*");
      await cache.deleteByPattern("groups:stats:*");
      await cache.deleteByPattern("admin:groups:*");
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

      const maxStudents = group.maxStudentsPerGroup || 20;
      if (group.students.length >= maxStudents) {
        res.status(409).json({ message: "Group has reached maximum capacity" });
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