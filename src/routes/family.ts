import { Router, Response } from "express";
import { User } from "../models/User";
import { ParentChildInvitation } from "../models/ParentChildInvitation";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { familyInvitationLimiter } from "../middleware/rateLimiter";
import { createNotification } from "../services/notificationService";
import {
  sendFamilyInvitationEmail,
  sendFamilyInvitationAcceptedEmail,
  sendFamilyInvitationRejectedEmail,
} from "../services/emailService";
import {
  linkParentChild,
  unlinkParentChild,
  isStudentLinked,
  isInParentChildren,
} from "../services/familyLinkService";

const router = Router();

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const OPPOSITE_ROLE: Record<string, "PARENT" | "STUDENT"> = {
  PARENT: "STUDENT",
  STUDENT: "PARENT",
};

const familyPageForRole = (role: string): string =>
  role === "PARENT" ? "/parent/family" : "/student/family";

/**
 * POST /api/family/invitations
 * Send a family-link invitation by email or phone (parent -> student, or student -> parent).
 */
router.post(
  "/invitations",
  auth,
  requireRole("PARENT", "STUDENT"),
  familyInvitationLimiter,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const sender = req.user!;
      const { targetEmail, targetPhone, message } = req.body;

      const email = String(targetEmail || "").toLowerCase().trim();
      const phone = String(targetPhone || "").trim();

      if (!email && !phone) {
        res.status(400).json({
          message: "يرجى إدخال البريد الإلكتروني أو رقم الهاتف الخاص بالطالب",
        });
        return;
      }

      if (email && !EMAIL_REGEX.test(email)) {
        res.status(400).json({ message: "البريد الإلكتروني غير صالح" });
        return;
      }

      const targetRole = OPPOSITE_ROLE[sender.role];

      const targetUser = await User.findOne({
        role: targetRole,
        $or: [
          ...(email ? [{ email }] : []),
          ...(phone ? [{ phone }] : []),
        ],
      });

      if (!targetUser) {
        res.status(404).json({
          message:
            "لم يتم العثور على حساب مسجّل بهذا البريد أو الهاتف. يجب أن يقوم بالطرف الآخر بالتسجيل أولاً ثم إعادة المحاولة.",
        });
        return;
      }

      if (targetUser._id.toString() === sender._id.toString()) {
        res.status(400).json({ message: "لا يمكنك إرسال دعوة لنفسك" });
        return;
      }

      const isLinked =
        sender.role === "PARENT"
          ? (await isStudentLinked(targetUser._id, sender._id)) ||
            (await isInParentChildren(sender._id, targetUser._id))
          : (await isStudentLinked(sender._id)) ||
            (await isInParentChildren(targetUser._id, sender._id));

      if (isLinked) {
        res.status(409).json({
          message: "تم ربط الحسابين بالفعل",
        });
        return;
      }

      const duplicate = await ParentChildInvitation.findOne({
        senderId: sender._id,
        targetUserId: targetUser._id,
        status: "PENDING",
      });
      if (duplicate) {
        res.status(409).json({
          message: "تم إرسال دعوة معلّقة لهذا الحساب بالفعل",
        });
        return;
      }

      const invitation = await ParentChildInvitation.create({
        senderId: sender._id,
        senderRole: sender.role as "PARENT" | "STUDENT",
        targetUserId: targetUser._id,
        targetEmail: targetUser.email,
        targetPhone: targetUser.phone,
        message: message || undefined,
        status: "PENDING",
      });

      await createNotification({
        userId: targetUser._id,
        title: "طلب ربط حساب",
        message: `أرسل لك ${sender.name} طلباً لربط الحسابات. يمكنك قبوله أو رفضه من صفحة العائلة.`,
        type: "INFO",
        category: "FAMILY",
        link: familyPageForRole(targetRole),
      });

      try {
        await sendFamilyInvitationEmail(
          targetUser.name,
          targetUser.email,
          sender.name,
          sender.role,
          `${FRONTEND_URL}/login?next=${familyPageForRole(targetRole)}`,
          message
        );
        console.log(`✅ Family invitation email sent to ${targetUser.email}`);
      } catch (emailError) {
        console.error("⚠️ Failed to send family invitation email:", emailError);
      }

      res.status(201).json({ success: true, message: "تم إرسال الدعوة بنجاح", data: invitation });
    } catch (error: any) {
      res.status(500).json({ message: "Error sending invitation", error: error.message });
    }
  }
);

/**
 * GET /api/family/invitations
 * List incoming and outgoing family invitations for the current user.
 */
router.get(
  "/invitations",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user!._id;

      const [incoming, outgoing] = await Promise.all([
        ParentChildInvitation.find({ targetUserId: userId })
          .populate("senderId", "name email avatarUrl role")
          .populate("targetUserId", "name email avatarUrl role")
          .sort({ createdAt: -1 })
          .lean(),
        ParentChildInvitation.find({ senderId: userId })
          .populate("senderId", "name email avatarUrl role")
          .populate("targetUserId", "name email avatarUrl role")
          .sort({ createdAt: -1 })
          .lean(),
      ]);

      res.json({ success: true, data: { incoming, outgoing } });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching invitations", error: error.message });
    }
  }
);

/**
 * GET /api/family/connections
 * List the current user's linked family relations.
 */
router.get(
  "/connections",
  auth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = req.user!;

      let connections: any[] = [];

      if (user.role === "PARENT") {
        const parent = await User.findById(user._id).populate(
          "students",
          "name email phone avatarUrl stage grade"
        );
        connections = (parent?.students || []) as any[];
      } else if (user.role === "STUDENT") {
        if (user.parentId) {
          const parent = await User.findById(user.parentId).select(
            "name email phone avatarUrl"
          );
          if (parent) connections = [parent];
        }
      }

      res.json({ success: true, data: { connections, role: user.role } });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching connections", error: error.message });
    }
  }
);

/**
 * POST /api/family/invitations/:id/accept
 * Accept a pending family invitation (only the target user can).
 */
router.post(
  "/invitations/:id/accept",
  auth,
  requireRole("PARENT", "STUDENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const invitation = await ParentChildInvitation.findById(req.params.id);

      if (!invitation) {
        res.status(404).json({ message: "Invitation not found" });
        return;
      }

      if (invitation.targetUserId.toString() !== user._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      if (invitation.status !== "PENDING") {
        res.status(400).json({ message: "تمت معالجة هذه الدعوة بالفعل" });
        return;
      }

      const isParent =
        invitation.senderRole === "PARENT"
          ? invitation.senderId
          : invitation.targetUserId;
      const isStudent =
        invitation.senderRole === "PARENT"
          ? invitation.targetUserId
          : invitation.senderId;

      const linked = await linkParentChild(isParent, isStudent);
      if (!linked) {
        res.status(500).json({ message: "تعذر ربط الحسابين" });
        return;
      }

      invitation.status = "ACCEPTED";
      invitation.respondedAt = new Date();
      await invitation.save();

      const sender = await User.findById(invitation.senderId).select("name email role");
      const target = await User.findById(invitation.targetUserId).select("name email role");

      if (sender) {
        await createNotification({
          userId: sender._id,
          title: "تم قبول طلب الربط",
          message: `قبل ${target?.name || "الطرف الآخر"} طلب ربط الحسابات.`,
          type: "SUCCESS",
          category: "FAMILY",
          link: familyPageForRole(sender.role),
        });

        try {
          await sendFamilyInvitationAcceptedEmail(
            sender.name,
            sender.email,
            target?.name || "الطرف الآخر",
            target?.role || "",
            `${FRONTEND_URL}${familyPageForRole(sender.role)}`
          );
          console.log(`✅ Acceptance email sent to ${sender.email}`);
        } catch (emailError) {
          console.error("⚠️ Failed to send acceptance email:", emailError);
        }
      }

      res.json({ success: true, message: "تم قبول الطلب وربط الحسابين", data: invitation });
    } catch (error: any) {
      res.status(500).json({ message: "Error accepting invitation", error: error.message });
    }
  }
);

/**
 * POST /api/family/invitations/:id/reject
 * Reject a pending family invitation (only the target user can).
 */
router.post(
  "/invitations/:id/reject",
  auth,
  requireRole("PARENT", "STUDENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const invitation = await ParentChildInvitation.findById(req.params.id);

      if (!invitation) {
        res.status(404).json({ message: "Invitation not found" });
        return;
      }

      if (invitation.targetUserId.toString() !== user._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      if (invitation.status !== "PENDING") {
        res.status(400).json({ message: "تمت معالجة هذه الدعوة بالفعل" });
        return;
      }

      invitation.status = "REJECTED";
      invitation.respondedAt = new Date();
      await invitation.save();

      const sender = await User.findById(invitation.senderId).select("name email role");
      const target = await User.findById(invitation.targetUserId).select("name email role");

      if (sender) {
        await createNotification({
          userId: sender._id,
          title: "تم رفض طلب الربط",
          message: `رفض ${target?.name || "الطرف الآخر"} طلب ربط الحسابات.`,
          type: "WARNING",
          category: "FAMILY",
          link: familyPageForRole(sender.role),
        });

        try {
          await sendFamilyInvitationRejectedEmail(
            sender.name,
            sender.email,
            target?.name || "الطرف الآخر",
            target?.role || ""
          );
          console.log(`✅ Rejection email sent to ${sender.email}`);
        } catch (emailError) {
          console.error("⚠️ Failed to send rejection email:", emailError);
        }
      }

      res.json({ success: true, message: "تم رفض الطلب", data: invitation });
    } catch (error: any) {
      res.status(500).json({ message: "Error rejecting invitation", error: error.message });
    }
  }
);

/**
 * DELETE /api/family/invitations/:id
 * Cancel a pending invitation (only the sender can).
 */
router.delete(
  "/invitations/:id",
  auth,
  requireRole("PARENT", "STUDENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const invitation = await ParentChildInvitation.findById(req.params.id);

      if (!invitation) {
        res.status(404).json({ message: "Invitation not found" });
        return;
      }

      if (invitation.senderId.toString() !== user._id.toString()) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      if (invitation.status !== "PENDING") {
        res.status(400).json({ message: "لا يمكن إلغاء دعوة تمت معالجتها" });
        return;
      }

      await ParentChildInvitation.deleteOne({ _id: invitation._id });

      res.json({ success: true, message: "تم إلغاء الدعوة" });
    } catch (error: any) {
      res.status(500).json({ message: "Error cancelling invitation", error: error.message });
    }
  }
);

/**
 * DELETE /api/family/parent-link
 * Unlink the current student from their parent (student only).
 */
router.delete(
  "/parent-link",
  auth,
  requireRole("STUDENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const student = req.user!;
      const parentId = student.parentId;

      if (!parentId) {
        res.status(400).json({ message: "لا يوجد ولي أمر مرتبط بحسابك" });
        return;
      }

      const parent = await User.findById(parentId).select("name email role");
      const unlinked = await unlinkParentChild(parentId, student._id);
      if (!unlinked) {
        res.status(500).json({ message: "تعذر فك الربط" });
        return;
      }

      if (parent) {
        await createNotification({
          userId: parentId,
          title: "تم فك ربط الحسابات",
          message: `قام ${student.name} بفك ربط حسابه من حسابك.`,
          type: "WARNING",
          category: "FAMILY",
          link: "/parent/family",
        });
      }

      res.json({ success: true, message: "تم فك ربط الحسابات بنجاح" });
    } catch (error: any) {
      res.status(500).json({ message: "Error unlinking parent", error: error.message });
    }
  }
);

/**
 * DELETE /api/family/connections/:studentId
 * Unlink a child from the parent (parent only).
 */
router.delete(
  "/connections/:studentId",
  auth,
  requireRole("PARENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const parent = req.user!;
      const studentId = req.params.studentId;

      const student = await User.findById(studentId);
      if (!student) {
        res.status(404).json({ message: "Student not found" });
        return;
      }

      const unlinked = await unlinkParentChild(parent._id, studentId);
      if (!unlinked) {
        res.status(500).json({ message: "تعذر فك الربط" });
        return;
      }

      await createNotification({
        userId: studentId,
        title: "تم فك ربط الحسابات",
        message: `قام ${parent.name} بفك ربط حسابك من حسابه.`,
        type: "WARNING",
        category: "FAMILY",
        link: "/student/family",
      });

      res.json({ success: true, message: "تم فك ربط الطالب بنجاح" });
    } catch (error: any) {
      res.status(500).json({ message: "Error unlinking student", error: error.message });
    }
  }
);

export default router;