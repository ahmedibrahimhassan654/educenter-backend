import { Router, Response } from "express";
import { Settings } from "../models/Settings";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { cache } from "../services/cache";
import { setBucketPublic, GROUP_VIDEOS_BUCKET } from "../services/storageService";

const router = Router();

// GET /api/settings/public - Get current defaults (for teachers to use when creating groups)
router.get(
  "/public",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const cacheKey = "settings:public";
      const cached = await cache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }
      const settings = await Settings.findOne().sort("-createdAt").lean();
      if (!settings) {
        res.json({
          defaultPricePerLecture: 50,
          maxStudentsPerGroup: 20,
          platformFeePercentage: 15,
          socialLinks: {
            facebook: "",
            twitter: "",
            instagram: "",
            youtube: "",
            tiktok: "",
            linkedin: "",
            whatsapp: "",
            snapchat: "",
          },
        });
        return;
      }
      const response = {
        defaultPricePerLecture: settings.defaultPricePerLecture,
        maxStudentsPerGroup: settings.maxStudentsPerGroup,
        platformFeePercentage: settings.platformFeePercentage,
        socialLinks: settings.socialLinks,
      };
      await cache.set(cacheKey, response, 300); // 5 minutes
      res.json(response);
    } catch (error: any) {
      res.status(500).json({
        message: "Error fetching settings",
        error: error.message,
      });
    }
  }
);

// GET /api/admin/settings - Get full settings (admin only)
router.get(
  "/",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      let settings = await Settings.findOne().sort("-createdAt").lean();
      if (!settings) {
        settings = await Settings.create({});
      }
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({
        message: "Error fetching settings",
        error: error.message,
      });
    }
  }
);

// PUT /api/admin/settings - Update settings (admin only)
router.put(
  "/",
  auth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { defaultPricePerLecture, maxStudentsPerGroup, platformFeePercentage, socialLinks } =
        req.body;

      let settings = await Settings.findOne().sort("-createdAt");
      if (!settings) {
        settings = new Settings({});
      }

      if (defaultPricePerLecture !== undefined) {
        const val = Number(defaultPricePerLecture);
        if (isNaN(val) || val < 0) {
          res.status(400).json({ message: "Invalid price per lecture" });
          return;
        }
        settings.defaultPricePerLecture = val;
      }

      if (maxStudentsPerGroup !== undefined) {
        const val = Number(maxStudentsPerGroup);
        if (isNaN(val) || val < 1) {
          res.status(400).json({ message: "Invalid max students per group" });
          return;
        }
        settings.maxStudentsPerGroup = val;
      }

      if (platformFeePercentage !== undefined) {
        const val = Number(platformFeePercentage);
        if (isNaN(val) || val < 0 || val > 100) {
          res.status(400).json({ message: "Invalid platform fee percentage" });
          return;
        }
        settings.platformFeePercentage = val;
      }

      if (socialLinks !== undefined) {
        const platforms: Array<keyof typeof settings.socialLinks> = ["facebook", "twitter", "instagram", "youtube", "tiktok", "linkedin", "whatsapp", "snapchat"];
        for (const platform of platforms) {
          if (socialLinks[platform] !== undefined) {
            const url = String(socialLinks[platform]).trim();
            if (url && !/^https?:\/\/.+/i.test(url)) {
              res.status(400).json({ message: `Invalid URL for ${platform}` });
              return;
            }
            settings.socialLinks[platform] = url;
          }
        }
      }

      settings.updatedBy = req.user!._id;
      await settings.save();
      await cache.delete("settings:public"); // Invalidate cache
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({
        message: "Error updating settings",
        error: error.message,
      });
    }
  }
);

// POST /api/admin/settings/storage/group-videos-public
// One-time maintenance: make the group-videos bucket public so group
// description videos stream from their public URLs. Lesson videos live in the
// private lesson-videos bucket and are unaffected.
router.post(
  "/storage/group-videos-public",
  auth,
  requireRole("ADMIN"),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ok = await setBucketPublic(GROUP_VIDEOS_BUCKET);
      if (!ok) {
        res.status(500).json({ message: "تعذر جعل مجلد فيديوهات المجموعات عاماً" });
        return;
      }
      res.json({
        success: true,
        message: "تم جعل فيديوهات المجموعات عامة بنجاح",
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error making bucket public", error: error.message });
    }
  }
);

export default router;
