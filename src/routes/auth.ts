import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
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
  loginLimiter,
  registerLimiter,
} from "../middleware/rateLimiter";

const router = Router();

const MIN_PASSWORD_LENGTH = 6;
const BCRYPT_ROUNDS = 12;

function generateToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, {
    expiresIn: config.jwtExpiry as import("ms").StringValue,
  });
}

const SELF_ASSIGNABLE_ROLES = ["TEACHER", "STUDENT", "PARENT"];

router.post(
  "/register",
  registerLimiter,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { name, email, phone, password, role } = req.body;

      if (!name || !email || !phone || !password) {
        res
          .status(400)
          .json({ message: "name, email, phone and password are required" });
        return;
      }

      if (password.length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({
          message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        });
        return;
      }

      if (role && !SELF_ASSIGNABLE_ROLES.includes(role)) {
        res.status(403).json({
          message: `Invalid role. Must be one of: ${SELF_ASSIGNABLE_ROLES.join(", ")}`,
        });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();

      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser) {
        res.status(409).json({ message: "User already exists" });
        return;
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const user = await User.create({
        name,
        email: normalizedEmail,
        phone,
        passwordHash,
        role: role || "STUDENT",
      });

      try {
        switch (user.role) {
          case "TEACHER":
            await sendTeacherWelcomeEmail(name, normalizedEmail);
            break;
          case "STUDENT":
            await sendStudentWelcomeEmail(name, normalizedEmail);
            break;
          case "PARENT":
            await sendParentWelcomeEmail(name, normalizedEmail);
            break;
        }
        console.log(`✅ Welcome email sent to ${normalizedEmail} (${user.role})`);
      } catch (emailError) {
        console.error("⚠️ Failed to send welcome email:", emailError);
      }

      try {
        const admins = await User.find({ role: "ADMIN" });
        for (const admin of admins) {
          await createNotification({
            userId: admin._id,
            title: "مستخدم جديد",
            message: `تسجيل مستخدم جديد: ${name} (${user.role})`,
            type: "INFO",
            category: "USER",
            link: "/admin/users",
          });
        }
      } catch (notifError) {
        console.error("⚠️ Failed to send admin notification:", notifError);
      }

      const token = generateToken(user._id.toString());

      const userResponse = user.toObject() as any;
      delete userResponse.passwordHash;

      res.status(201).json({ user: userResponse, token });
    } catch (error: any) {
      res.status(500).json({ message: "Error creating user", error: error.message });
    }
  }
);

router.post(
  "/login",
  loginLimiter,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ message: "Email and password are required" });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();

      const user = await User.findOne({ email: normalizedEmail }).select(
        "+passwordHash"
      );
      if (!user) {
        res.status(401).json({ message: "Invalid credentials" });
        return;
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ message: "Invalid credentials" });
        return;
      }

      const token = generateToken(user._id.toString());

      const userResponse = user.toObject() as any;
      delete userResponse.passwordHash;

      res.cookie("educenter_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: "/",
      });

      res.json({ user: userResponse });
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Error logging in", error: error.message, stack: error.stack });
    }
  }
);

router.post(
  "/logout",
  async (req: AuthRequest, res: Response): Promise<void> => {
    res.clearCookie("educenter_token", { path: "/" });
    res.json({ success: true });
  }
);

router.get("/me", auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
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

router.post(
  "/link-student",
  auth,
  requireRole("PARENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { linkingCode } = req.body;
      const parent = req.user;

      const student = await User.findOne({
        linkingCode,
        role: "STUDENT",
      });

      if (!student) {
        res.status(404).json({ message: "Student not found with this linking code" });
        return;
      }

      if (student.parentId) {
        res.status(409).json({ message: "Student is already linked to a parent" });
        return;
      }

      student.parentId = parent!._id;
      await student.save();

      parent!.students.push(student._id);
      await parent!.save();

      res.json({ message: "Student linked successfully", student });
    } catch (error: any) {
      res.status(500).json({ message: "Error linking student", error: error.message });
    }
  }
);

const NEUTRAL_FORGOT_RESPONSE = {
  success: true,
  message: "إذا كان هناك حساب مرتبط بهذا البريد، فقد أرسلنا رمز التحقق إليه.",
};

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

      const tokenValid = await consumeResetToken(email, resetToken);
      if (!tokenValid) {
        res.status(400).json({
          message: "انتهت صلاحية الجلسة. ابدأ من جديد.",
        });
        return;
      }

      const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      user.passwordHash = passwordHash;
      await user.save();

      res.json({ success: true, message: "تم تغيير كلمة المرور بنجاح" });
    } catch (error: any) {
      console.error("reset-password error:", error);
      res.status(500).json({ message: "حدث خطأ. حاول مرة أخرى." });
    }
  }
);

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

      const userWithPassword = await User.findById(user._id).select("+passwordHash");
      if (!userWithPassword) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      const valid = await bcrypt.compare(currentPassword, userWithPassword.passwordHash);
      if (!valid) {
        res.status(400).json({ message: "كلمة المرور الحالية غير صحيحة" });
        return;
      }

      const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      userWithPassword.passwordHash = passwordHash;
      await userWithPassword.save();

      res.json({ success: true, message: "تم تغيير كلمة المرور بنجاح" });
    } catch (error: any) {
      console.error("change-password error:", error);
      res.status(500).json({ message: "حدث خطأ. حاول مرة أخرى." });
    }
  }
);

export default router;