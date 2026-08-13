import nodemailer from "nodemailer";
import { renderTemplate } from "./emailTemplateEngine";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const createTransporter = () => {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
};

export const sendEmail = async (options: EmailOptions): Promise<boolean> => {
  try {
    const transporter = createTransporter();
    const mailOptions = {
      from: `"EduCenter" <${process.env.GMAIL_USER}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || options.subject,
      replyTo: process.env.GMAIL_USER,
      headers: {
        "X-Mailer": "EduCenter",
        "List-Unsubscribe": `<mailto:${process.env.GMAIL_USER}>`,
        "Precedence": "bulk",
      },
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${options.to}`);
    return true;
  } catch (error) {
    console.error("❌ Error sending email:", error);
    return false;
  }
};

export const sendTeacherWelcomeEmail = async (teacherName: string, teacherEmail: string): Promise<boolean> => {
  const html = await renderTemplate("teacher-welcome", {
    name: teacherName,
    loginUrl: `${process.env.FRONTEND_URL || "http://localhost:3000"}/teacher`,
  });
  return sendEmail({ to: teacherEmail, subject: "مرحباً بك في إديو سنتر - حسابك كمعلم جاهز!", html });
};

export const sendStudentWelcomeEmail = async (studentName: string, studentEmail: string): Promise<boolean> => {
  const html = await renderTemplate("student-welcome", {
    name: studentName,
    loginUrl: `${process.env.FRONTEND_URL || "http://localhost:3000"}/student`,
  });
  return sendEmail({ to: studentEmail, subject: "مرحباً بك في إديو سنتر - ابدأ رحلتك التعليمية!", html });
};

export const sendParentWelcomeEmail = async (parentName: string, parentEmail: string): Promise<boolean> => {
  const html = await renderTemplate("parent-welcome", {
    name: parentName,
    loginUrl: `${process.env.FRONTEND_URL || "http://localhost:3000"}/parent`,
  });
  return sendEmail({ to: parentEmail, subject: "مرحباً بك في إديو سنتر - تتبع تقدم طفلك!", html });
};

export const sendVerificationEmail = async (userName: string, userEmail: string, verificationLink: string): Promise<boolean> => {
  const html = await renderTemplate("verification", {
    name: userName,
    verificationLink,
  });
  return sendEmail({ to: userEmail, subject: "تأكيد بريدك الإلكتروني - إديو سنتر", html });
};

export const sendPasswordResetEmail = async (userName: string, userEmail: string, resetLink: string): Promise<boolean> => {
  const html = await renderTemplate("password-reset", {
    name: userName,
    resetLink,
  });
  return sendEmail({ to: userEmail, subject: "إعادة تعيين كلمة المرور - إديو سنتر", html });
};

export const sendPasswordResetOtpEmail = async (userName: string, userEmail: string, code: string, minutes: number): Promise<boolean> => {
  const html = await renderTemplate("password-reset-otp", {
    name: userName,
    code,
    minutes,
  });
  return sendEmail({
    to: userEmail,
    subject: `رمز إعادة تعيين كلمة المرور: ${code} - إديو سنتر`,
    html,
    text: `رمز إعادة تعيين كلمة المرور الخاص بك هو ${code}. صالح لمدة ${minutes} دقائق.`,
  });
};

export const sendAccountDeletionEmail = async (userName: string, userEmail: string): Promise<boolean> => {
  const html = await renderTemplate("account-deletion", { name: userName });
  return sendEmail({ to: userEmail, subject: "إشعار حذف الحساب - إديو سنتر", html });
};

export const sendCredentialsEmail = async (
  userName: string,
  userEmail: string,
  password: string,
  role: string,
  loginUrl: string
): Promise<boolean> => {
  const roleLabels: Record<string, string> = {
    TEACHER: "معلم",
    STUDENT: "طالب",
    PARENT: "ولي أمر",
    ADMIN: "مدير",
  };

  const html = await renderTemplate("credentials", {
    name: userName,
    email: userEmail,
    password,
    roleLabel: roleLabels[role] || role,
    loginUrl,
  });
  return sendEmail({ to: userEmail, subject: "بيانات حسابك في إديو سنتر", html });
};

export const sendGroupInvitationEmail = async (
  studentName: string,
  studentEmail: string,
  groupTitle: string,
  subject: string,
  teacherName: string,
  scheduleDays: string[],
  loginUrl: string,
  password?: string,
  stage?: string,
  grade?: string
): Promise<boolean> => {
  const scheduleText = scheduleDays.length > 0 ? scheduleDays.join("، ") : "غير محدد";

  const html = await renderTemplate("group-invitation", {
    studentName,
    studentEmail,
    groupTitle,
    subject,
    teacherName,
    scheduleText,
    loginUrl,
    password,
    stage,
    grade,
  });
  return sendEmail({ to: studentEmail, subject: `تمت إضافتك لمجموعة ${groupTitle} - إديو سنتر`, html });
};

export const sendStudentGroupWelcomeEmail = async (
  studentName: string,
  studentEmail: string,
  password: string,
  groupTitle: string,
  subject: string,
  teacherName: string,
  scheduleDays: string[],
  stage: string,
  grade: string,
  loginUrl: string
): Promise<boolean> => {
  const scheduleText = scheduleDays.length > 0 ? scheduleDays.join("، ") : "غير محدد";

  const html = await renderTemplate("student-group-welcome", {
    studentName,
    studentEmail,
    password,
    groupTitle,
    subject,
    teacherName,
    scheduleText,
    stage,
    grade,
    loginUrl,
  });
  return sendEmail({
    to: studentEmail,
    subject: `مرحباً بك في إديو سنتر - حسابك ومجموعتك ${groupTitle}`,
    html,
  });
};
