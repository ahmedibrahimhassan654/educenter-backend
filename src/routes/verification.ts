import { Router, Response } from "express";
import { User } from "../models/User";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";

const router = Router();

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

      res.json({
        verificationStatus: user.verificationStatus,
        verificationData: user.verificationData,
        verificationNotes: user.verificationNotes,
        verifiedAt: user.verifiedAt,
      });
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

      const [users, total] = await Promise.all([
        User.find(query)
          .select("name email phone avatarUrl verificationStatus verificationData verificationNotes verifiedAt createdAt")
          .sort("-createdAt")
          .skip(skip)
          .limit(limitNum)
          .lean(),
        User.countDocuments(query),
      ]);

      res.json({
        success: true,
        data: users,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching verification requests", error: error.message });
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
