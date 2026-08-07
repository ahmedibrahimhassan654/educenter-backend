import { Router, Response } from "express";
import { User } from "../models/User";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { config } from "../config/env";
import { createNotification } from "../services/notificationService";
import {
  sendTeacherWelcomeEmail,
  sendStudentWelcomeEmail,
  sendParentWelcomeEmail,
} from "../services/emailService";
import {
  createOtp,
  verifyOtp,
  consumeResetToken,
  OTP_TTL_MINUTES,
} from "../services/otpService";
import { getOtpChannel } from "../services/otpChannel";
import {
  forgotPasswordLimiter,
  verifyOtpLimiter,
  resetPasswordLimiter,
  changePasswordLimiter,
} from "../middleware/rateLimiter";

const router = Router();

const MIN_PASSWORD_LENGTH = 6;

/**
 * Update a Supabase user's password using the admin API.
 */
async function updateSupabasePassword(
  supabaseId: string,
  password: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `${config.supabaseUrl}/auth/v1/admin/users/${supabaseId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          apikey: config.supabaseSecretKey,
          Authorization: `Bearer ${config.supabaseSecretKey}`,
        },
        body: JSON.stringify({ password }),
      }
    );

    if (!response.ok) {
      console.error(
        `Supabase password update failed (${response.status}):`,
        await response.text()
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error("Supabase password update error:", error);
    return false;
  }
}

/**
 * Confirm a password by attempting a Supabase password grant.
 */
async function verifyCurrentPassword(
  email: string,
  password: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `${config.supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.supabasePublishableKey,
        },
        body: JSON.stringify({ email, password }),
      }
    );

    return response.ok;
  } catch (error) {
    console.error("Password verification error:", error);
    return false;
  }
}

// Roles a user may assign to themselves during self-registration.
// ADMIN is deliberately excluded and can only be granted by an existing admin.
const SELF_ASSIGNABLE_ROLES = ["TEACHER", "STUDENT", "PARENT"];

// Confirm the supabaseId really exists in Supabase and return its authoritative
// email. Signup does not issue a session (email confirmation is enabled), so we
// cannot require a bearer token here; instead we verify against the Admin API
// rather than trusting the client payload.
async function fetchSupabaseUser(
  supabaseId: string
): Promise<{ id: string; email: string } | null> {
  try {
    const response = await fetch(
      `${config.supabaseUrl}/auth/v1/admin/users/${supabaseId}`,
      {
        headers: {
          apikey: config.supabaseSecretKey,
          Authorization: `Bearer ${config.supabaseSecretKey}`,
        },
      }
    );

    if (!response.ok) return null;

    const data: any = await response.json();
    if (!data?.id || !data?.email) return null;

    return { id: data.id, email: data.email };
  } catch (error) {
    console.error("Failed to verify Supabase user:", error);
    return null;
  }
}

// Register user profile after Supabase signup.
// Identity is verified against Supabase; the client cannot choose its own
// email or grant itself the ADMIN role.
router.post(
  "/register",
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { supabaseId, name, phone, role } = req.body;

      if (!supabaseId || !name || !phone) {
        res
          .status(400)
          .json({ message: "supabaseId, name and phone are required" });
        return;
      }

      if (!SELF_ASSIGNABLE_ROLES.includes(role)) {
        res.status(403).json({
          message: `Invalid role. Must be one of: ${SELF_ASSIGNABLE_ROLES.join(", ")}`,
        });
        return;
      }

      // The email is taken from Supabase, never from the request body
      const supabaseUser = await fetchSupabaseUser(supabaseId);
      if (!supabaseUser) {
        res.status(401).json({ message: "Unknown Supabase user" });
        return;
      }

      const email = supabaseUser.email;

      // Check if user already exists (by Supabase id or email)
      const existingUser = await User.findOne({
        $or: [{ supabaseId }, { email }],
      });
      if (existingUser) {
        res.status(409).json({ message: "User already exists" });
        return;
      }

      const user = await User.create({
        supabaseId,
        name,
        email,
        phone,
        role,
      });

      // Send welcome email based on role
      try {
        switch (role) {
          case "TEACHER":
            await sendTeacherWelcomeEmail(name, email);
            break;
          case "STUDENT":
            await sendStudentWelcomeEmail(name, email);
            break;
          case "PARENT":
            await sendParentWelcomeEmail(name, email);
            break;
        }
        console.log(`✅ Welcome email sent to ${email} (${role})`);
      } catch (emailError) {
        // Don't fail registration if email fails
        console.error("⚠️ Failed to send welcome email:", emailError);
      }

      // Notify all admins about new user registration
      try {
        const admins = await User.find({ role: "ADMIN" });
        for (const admin of admins) {
          await createNotification({
            userId: admin._id,
            title: "مستخدم جديد",
            message: `تسجيل مستخدم جديد: ${name} (${role})`,
            type: "INFO",
            category: "USER",
            link: "/admin/users",
          });
        }
      } catch (notifError) {
        console.error("⚠️ Failed to send admin notification:", notifError);
      }

      res.status(201).json(user);
    } catch (error: any) {
      res.status(500).json({ message: "Error creating user", error: error.message });
    }
  }
);

// Get current user profile
router.get("/me", auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // verificationData.documents holds base64 data URIs that can be hundreds of
    // KB each. Strip them here: this endpoint runs on every page load and the
    // documents are only needed on the verification screens.
    const user: any = req.user!.toObject();
    const documents = user.verificationData?.documents;

    if (Array.isArray(documents)) {
      user.verificationData = {
        ...user.verificationData,
        documents: undefined,
        documentsCount: documents.length,
      };
    }

    res.json(user);
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching user", error: error.message });
  }
});

// Parent links student via linking code
router.post(
  "/link-student",
  auth,
  requireRole("PARENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { linkingCode } = req.body;
      const parent = req.user;

      // Find student by linking code
      const student = await User.findOne({
        linkingCode,
        role: "STUDENT",
      });

      if (!student) {
        res.status(404).json({ message: "Student not found with this linking code" });
        return;
      }

      // Check if student is already linked
      if (student.parentId) {
        res.status(409).json({ message: "Student is already linked to a parent" });
        return;
      }

      // Link student to parent
      student.parentId = parent!._id;
      await student.save();

      // Add student to parent's students array
      parent!.students.push(student._id);
      await parent!.save();

      res.json({ message: "Student linked successfully", student });
    } catch (error: any) {
      res.status(500).json({ message: "Error linking student", error: error.message });
    }
  }
);

/* ------------------------------------------------------------------ *
 * Password reset (public, OTP based)
 * ------------------------------------------------------------------ */

// Deliberately identical whether or not the account exists, so the endpoint
// cannot be used to discover which emails are registered.
const NEUTRAL_FORGOT_RESPONSE = {
  success: true,
  message: "إذا كان هناك حساب مرتبط بهذا البريد، فقد أرسلنا رمز التحقق إليه.",
};

// Step 1: request a code
router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const email = String(req.body?.email || "").toLowerCase().trim();

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ message: "البريد الإلكتروني غير صالح" });
        return;
      }

      const user = await User.findOne({ email });

      // Unknown address: respond as if it worked, but send nothing
      if (!user) {
        res.json(NEUTRAL_FORGOT_RESPONSE);
        return;
      }

      const code = await createOtp(email);

      try {
        await getOtpChannel().sendOtp(
          { name: user.name, email: user.email, phone: user.phone },
          code
        );
      } catch (sendError) {
        console.error("Failed to deliver OTP:", sendError);
      }

      res.json(NEUTRAL_FORGOT_RESPONSE);
    } catch (error: any) {
      console.error("forgot-password error:", error);
      res.status(500).json({ message: "حدث خطأ. حاول مرة أخرى." });
    }
  }
);

// Step 2: exchange the code for a single-use reset token
router.post(
  "/verify-otp",
  verifyOtpLimiter,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const email = String(req.body?.email || "").toLowerCase().trim();
      const code = String(req.body?.code || "").trim();

      if (!email || !/^\d{6}$/.test(code)) {
        res.status(400).json({ message: "الرمز غير صالح" });
        return;
      }

      const result = await verifyOtp(email, code);

      if (!result.ok) {
        const messages: Record<string, string> = {
          NOT_FOUND: "لم يتم طلب رمز لهذا البريد. اطلب رمزاً جديداً.",
          EXPIRED: "انتهت صلاحية الرمز. اطلب رمزاً جديداً.",
          TOO_MANY_ATTEMPTS: "عدد محاولات كبير. اطلب رمزاً جديداً.",
          INVALID: "الرمز غير صحيح.",
        };
        res.status(400).json({ message: messages[result.reason] });
        return;
      }

      res.json({ success: true, resetToken: result.resetToken });
    } catch (error: any) {
      console.error("verify-otp error:", error);
      res.status(500).json({ message: "حدث خطأ. حاول مرة أخرى." });
    }
  }
);

// Step 3: set the new password
router.post(
  "/reset-password",
  resetPasswordLimiter,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const email = String(req.body?.email || "").toLowerCase().trim();
      const resetToken = String(req.body?.resetToken || "").trim();
      const newPassword = String(req.body?.newPassword || "");

      if (!email || !resetToken) {
        res.status(400).json({ message: "طلب غير صالح" });
        return;
      }

      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({
          message: "كلمة المرور يجب أن تكون ٦ أحرف على الأقل",
        });
        return;
      }

      const user = await User.findOne({ email });
      if (!user) {
        res.status(400).json({ message: "طلب غير صالح" });
        return;
      }

      // Token is single use and is consumed here
      const tokenValid = await consumeResetToken(email, resetToken);
      if (!tokenValid) {
        res.status(400).json({
          message: "انتهت صلاحية الجلسة. ابدأ من جديد.",
        });
        return;
      }

      const updated = await updateSupabasePassword(
        user.supabaseId,
        newPassword
      );
      if (!updated) {
        res.status(500).json({ message: "تعذر تحديث كلمة المرور. حاول مرة أخرى." });
        return;
      }

      res.json({ success: true, message: "تم تغيير كلمة المرور بنجاح" });
    } catch (error: any) {
      console.error("reset-password error:", error);
      res.status(500).json({ message: "حدث خطأ. حاول مرة أخرى." });
    }
  }
);

// Change password while signed in (requires the current password)
router.post(
  "/change-password",
  auth,
  changePasswordLimiter,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const currentPassword = String(req.body?.currentPassword || "");
      const newPassword = String(req.body?.newPassword || "");
      const user = req.user!;

      if (!currentPassword || !newPassword) {
        res.status(400).json({ message: "جميع الحقول مطلوبة" });
        return;
      }

      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({
          message: "كلمة المرور يجب أن تكون ٦ أحرف على الأقل",
        });
        return;
      }

      if (newPassword === currentPassword) {
        res.status(400).json({
          message: "كلمة المرور الجديدة يجب أن تكون مختلفة عن الحالية",
        });
        return;
      }

      const valid = await verifyCurrentPassword(user.email, currentPassword);
      if (!valid) {
        res.status(400).json({ message: "كلمة المرور الحالية غير صحيحة" });
        return;
      }

      const updated = await updateSupabasePassword(
        user.supabaseId,
        newPassword
      );
      if (!updated) {
        res.status(500).json({ message: "تعذر تحديث كلمة المرور. حاول مرة أخرى." });
        return;
      }

      res.json({ success: true, message: "تم تغيير كلمة المرور بنجاح" });
    } catch (error: any) {
      console.error("change-password error:", error);
      res.status(500).json({ message: "حدث خطأ. حاول مرة أخرى." });
    }
  }
);

export default router;