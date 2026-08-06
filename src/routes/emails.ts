import { Router, Response } from "express";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  sendEmail,
  sendTeacherWelcomeEmail,
  sendStudentWelcomeEmail,
  sendParentWelcomeEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
} from "../services/emailService";

const router = Router();

// All email routes require admin authentication
router.use(auth);
router.use(requireRole("ADMIN"));

/**
 * POST /api/emails/test
 * Send a test email
 */
router.post("/test", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { to } = req.body;

    if (!to) {
      res.status(400).json({ message: "Recipient email is required" });
      return;
    }

    const result = await sendEmail({
      to,
      subject: "اختبار البريد الإلكتروني - إديو سنتر",
      html: `
        <div style="font-family: Arial, sans-serif; direction: rtl; text-align: right; padding: 20px;">
          <h1 style="color: #4F46E5;">اختبار البريد الإلكتروني ✅</h1>
          <p>هذا بريد اختباري من منصة إديو سنتر.</p>
          <p>إذا وصلك هذا البريد، فإن إعدادات البريد الإلكتروني تعمل بشكل صحيح!</p>
          <hr style="margin: 20px 0;" />
          <p style="color: #6B7280; font-size: 14px;">تم الإرسال في: ${new Date().toLocaleString("ar-EG")}</p>
        </div>
      `,
    });

    if (result) {
      res.json({ success: true, message: "Test email sent successfully" });
    } else {
      res.status(500).json({ success: false, message: "Failed to send test email" });
    }
  } catch (error: any) {
    res.status(500).json({ message: "Error sending test email", error: error.message });
  }
});

/**
 * POST /api/emails/welcome/teacher
 * Send welcome email to a teacher
 */
router.post("/welcome/teacher", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      res.status(400).json({ message: "Name and email are required" });
      return;
    }

    const result = await sendTeacherWelcomeEmail(name, email);

    if (result) {
      res.json({ success: true, message: "Welcome email sent to teacher" });
    } else {
      res.status(500).json({ success: false, message: "Failed to send welcome email" });
    }
  } catch (error: any) {
    res.status(500).json({ message: "Error sending welcome email", error: error.message });
  }
});

/**
 * POST /api/emails/welcome/student
 * Send welcome email to a student
 */
router.post("/welcome/student", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      res.status(400).json({ message: "Name and email are required" });
      return;
    }

    const result = await sendStudentWelcomeEmail(name, email);

    if (result) {
      res.json({ success: true, message: "Welcome email sent to student" });
    } else {
      res.status(500).json({ success: false, message: "Failed to send welcome email" });
    }
  } catch (error: any) {
    res.status(500).json({ message: "Error sending welcome email", error: error.message });
  }
});

/**
 * POST /api/emails/welcome/parent
 * Send welcome email to a parent
 */
router.post("/welcome/parent", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      res.status(400).json({ message: "Name and email are required" });
      return;
    }

    const result = await sendParentWelcomeEmail(name, email);

    if (result) {
      res.json({ success: true, message: "Welcome email sent to parent" });
    } else {
      res.status(500).json({ success: false, message: "Failed to send welcome email" });
    }
  } catch (error: any) {
    res.status(500).json({ message: "Error sending welcome email", error: error.message });
  }
});

/**
 * POST /api/emails/verification
 * Send verification email
 */
router.post("/verification", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email, verificationLink } = req.body;

    if (!name || !email || !verificationLink) {
      res.status(400).json({ message: "Name, email, and verification link are required" });
      return;
    }

    const result = await sendVerificationEmail(name, email, verificationLink);

    if (result) {
      res.json({ success: true, message: "Verification email sent" });
    } else {
      res.status(500).json({ success: false, message: "Failed to send verification email" });
    }
  } catch (error: any) {
    res.status(500).json({ message: "Error sending verification email", error: error.message });
  }
});

/**
 * POST /api/emails/password-reset
 * Send password reset email
 */
router.post("/password-reset", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email, resetLink } = req.body;

    if (!name || !email || !resetLink) {
      res.status(400).json({ message: "Name, email, and reset link are required" });
      return;
    }

    const result = await sendPasswordResetEmail(name, email, resetLink);

    if (result) {
      res.json({ success: true, message: "Password reset email sent" });
    } else {
      res.status(500).json({ success: false, message: "Failed to send password reset email" });
    }
  } catch (error: any) {
    res.status(500).json({ message: "Error sending password reset email", error: error.message });
  }
});

export default router;
