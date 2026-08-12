import { Router, Response, NextFunction } from "express";
import { Group } from "../models/Group";
import { User } from "../models/User";
import { GroupInvitation } from "../models/GroupInvitation";
import { Settings } from "../models/Settings";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { createNotification } from "../services/notificationService";
import { cache } from "../services/cache";
import {
  sendGroupInvitationEmail,
  sendCredentialsEmail,
} from "../services/emailService";
import bcrypt from "bcryptjs";

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
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    // Skip non-ObjectId params (e.g. /invitations) so they match their own routes
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
      return next();
    }
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

// Add student to group - creates invitation for existing student
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

      const existingInvitation = await GroupInvitation.findOne({
        groupId: group._id,
        studentId,
        status: "PENDING",
      });

      if (existingInvitation) {
        res.status(409).json({ message: "Student already has a pending invitation for this group" });
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

      const student = await User.findById(studentId);
      if (!student) {
        res.status(404).json({ message: "Student not found" });
        return;
      }

      const invitation = await GroupInvitation.create({
        groupId: group._id,
        studentId,
        teacherId: group.teacherId,
        status: "PENDING",
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
        title: "دعوة لمجموعة جديدة",
        message: `تمت إضافة ${student.name} إلى مجموعة ${group.title} - في انتظار الموافقة`,
        type: "INFO",
        category: "GROUP",
        link: "/student/invitations",
      });

      const admins = await User.find({ role: "ADMIN" });
      for (const admin of admins) {
        await createNotification({
          userId: admin._id,
          title: "دعوة مجموعة جديدة",
          message: `المعلم ${teacher?.name || "غير معروف"} أرسل دعوة للطالب ${student.name} للانضمام إلى مجموعة ${group.title}`,
          type: "INFO",
          category: "GROUP",
          link: "/admin",
        });
      }

      res.status(201).json({
        success: true,
        data: invitation,
        message: "Invitation sent successfully",
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
      const { name, email, phone, stage, grade } = req.body;
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

      const invitation = await GroupInvitation.create({
        groupId: group._id,
        studentId: student._id,
        teacherId: group.teacherId,
        status: "PENDING",
        stage: stage || group.stage || "",
        grade: grade || group.grade || "",
        subject: group.subject,
        password,
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
          password,
          stage || group.stage || "",
          grade || group.grade || ""
        ).catch((err) => console.error("Failed to send group invitation email:", err));
      }

      await createNotification({
        userId: student._id,
        title: "دعوة لمجموعة جديدة",
        message: `تم إنشاء حسابك وإضافتك إلى مجموعة ${group.title} - في انتظار الموافقة`,
        type: "SUCCESS",
        category: "GROUP",
        link: "/student/invitations",
      });

      const admins = await User.find({ role: "ADMIN" });
      for (const admin of admins) {
        await createNotification({
          userId: admin._id,
          title: "دعوة مجموعة جديدة",
          message: `المعلم ${teacher?.name || "غير معروف"} أنشأ حساب للطالب ${student.name} وأرسل دعوة للانضمام إلى مجموعة ${group.title}`,
          type: "INFO",
          category: "GROUP",
          link: "/admin",
        });
      }

      res.status(201).json({
        success: true,
        data: student,
        generatedPassword: password,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error creating student", error: error.message });
    }
  }
);

// Get student's invitations (student only)
router.get(
  "/invitations",
  auth,
  requireRole("STUDENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const invitations = await GroupInvitation.find({ studentId: req.user!._id })
        .populate("groupId", "title subject grade stage scheduleDays totalSessionPrice")
        .populate("teacherId", "name email")
        .sort({ createdAt: -1 })
        .lean();

      res.json({ success: true, data: invitations });
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
        $addToSet: { groups: group._id, stage: invitation.stage, grade: invitation.grade },
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

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}