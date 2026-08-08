import { Router, Response } from "express";
import { Settings } from "../models/Settings";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";

const router = Router();

// GET /api/settings/public - Get current defaults (for teachers to use when creating groups)
router.get(
  "/public",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
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
      res.json({
        defaultPricePerLecture: settings.defaultPricePerLecture,
        maxStudentsPerGroup: settings.maxStudentsPerGroup,
        platformFeePercentage: settings.platformFeePercentage,
        socialLinks: settings.socialLinks,
      });
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
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({
        message: "Error updating settings",
        error: error.message,
      });
    }
  }
);

export default router;
