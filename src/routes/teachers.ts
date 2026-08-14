import { Router, Request, Response } from "express";
import { User } from "../models/User";
import { Group } from "../models/Group";
import { cache } from "../services/cache";

const router = Router();

// Public list of verified teachers with their group counts (no auth)
router.get(
  "/public",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const cacheKey = "public:teachers:list";
      const cached = await cache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      const teachers = await User.find({
        role: "TEACHER",
        verificationStatus: "VERIFIED",
      })
        .select("name avatarUrl verificationStatus verificationData verifiedAt createdAt")
        .sort("-createdAt")
        .lean();

      const teacherIds = teachers.map((t) => (t as any)._id);
      const groupCounts = await Group.aggregate([
        { $match: { teacherId: { $in: teacherIds } } },
        {
          $group: {
            _id: "$teacherId",
            groupsCount: { $sum: 1 },
            studentsCount: { $sum: { $size: { $ifNull: ["$students", []] } } },
          },
        },
      ]);

      const statsMap = new Map(
        groupCounts.map((g) => [
          g._id.toString(),
          { groupsCount: g.groupsCount, studentsCount: g.studentsCount },
        ])
      );

      const data = teachers.map((t: any) => ({
        id: t._id,
        name: t.name,
        avatarUrl: t.avatarUrl,
        verificationStatus: t.verificationStatus,
        verifiedAt: t.verifiedAt,
        bio: t.verificationData?.bio || "",
        experience: t.verificationData?.experience || "",
        subjects: Array.from(
          new Set(
            (t.verificationData?.curriculum || []).map((entry: string) => {
              const idx = entry.indexOf(":");
              return idx !== -1 ? entry.slice(idx + 1).trim() : entry.trim();
            })
          )
        ),
        ...(statsMap.get(t._id.toString()) || { groupsCount: 0, studentsCount: 0 }),
      }));

      await cache.set(cacheKey, { success: true, data }, 300);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching teachers", error: error.message });
    }
  }
);

// Public teacher profile by ID (no auth)
router.get(
  "/public/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      if (!/^[0-9a-fA-F]{24}$/.test(id)) {
        res.status(404).json({ message: "Teacher not found" });
        return;
      }

      const cacheKey = `public:teacher:${id}`;
      const cached = await cache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      const teacher = await User.findOne({
        _id: id,
        role: "TEACHER",
        verificationStatus: "VERIFIED",
      })
        .select("name avatarUrl verificationStatus verificationData verifiedAt createdAt")
        .lean();

      if (!teacher) {
        res.status(404).json({ message: "Teacher not found" });
        return;
      }

      const groups = await Group.find({ teacherId: teacher._id })
        .select("title subject grade stage scheduleDays totalSessionPrice maxStudentsPerGroup students createdAt")
        .sort("-createdAt")
        .lean();

      const data = {
        id: (teacher as any)._id,
        name: teacher.name,
        avatarUrl: teacher.avatarUrl,
        verificationStatus: teacher.verificationStatus,
        verifiedAt: teacher.verifiedAt,
        createdAt: teacher.createdAt,
        bio: (teacher.verificationData as any)?.bio || "",
        experience: (teacher.verificationData as any)?.experience || "",
        curriculum: (teacher.verificationData as any)?.curriculum || [],
        groups: groups.map((g: any) => ({
          id: g._id,
          title: g.title,
          subject: g.subject,
          grade: g.grade,
          stage: g.stage,
          scheduleDays: g.scheduleDays || [],
          totalSessionPrice: g.totalSessionPrice,
          maxStudentsPerGroup: g.maxStudentsPerGroup,
          studentsCount: g.students?.length || 0,
          createdAt: g.createdAt,
        })),
      };

      await cache.set(cacheKey, data, 300);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching teacher", error: error.message });
    }
  }
);

export default router;