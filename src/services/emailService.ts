import nodemailer from "nodemailer";

/**
 * Email Service
 * Handles sending emails using Gmail SMTP
 */

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

// Create Gmail transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD, // Use App Password, not regular password
    },
  });
};

/**
 * Send an email
 */
export const sendEmail = async (options: EmailOptions): Promise<boolean> => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: `"إديو سنتر" <${process.env.GMAIL_USER}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${options.to}`);
    return true;
  } catch (error) {
    console.error("❌ Error sending email:", error);
    return false;
  }
};

/**
 * Send welcome email to new teacher
 */
export const sendTeacherWelcomeEmail = async (
  teacherName: string,
  teacherEmail: string
): Promise<boolean> => {
  const html = getTeacherWelcomeTemplate(teacherName);
  
  return sendEmail({
    to: teacherEmail,
    subject: "مرحباً بك في إديو سنتر - حسابك كمعلم جاهز!",
    html,
  });
};

/**
 * Send welcome email to new student
 */
export const sendStudentWelcomeEmail = async (
  studentName: string,
  studentEmail: string
): Promise<boolean> => {
  const html = getStudentWelcomeTemplate(studentName);
  
  return sendEmail({
    to: studentEmail,
    subject: "مرحباً بك في إديو سنتر - ابدأ رحلتك التعليمية!",
    html,
  });
};

/**
 * Send welcome email to new parent
 */
export const sendParentWelcomeEmail = async (
  parentName: string,
  parentEmail: string
): Promise<boolean> => {
  const html = getParentWelcomeTemplate(parentName);
  
  return sendEmail({
    to: parentEmail,
    subject: "مرحباً بك في إديو سنتر - تتبع تقدم طفلك!",
    html,
  });
};

/**
 * Send email verification
 */
export const sendVerificationEmail = async (
  userName: string,
  userEmail: string,
  verificationLink: string
): Promise<boolean> => {
  const html = getVerificationTemplate(userName, verificationLink);
  
  return sendEmail({
    to: userEmail,
    subject: "تأكيد بريدك الإلكتروني - إديو سنتر",
    html,
  });
};

/**
 * Send password reset email
 */
export const sendPasswordResetEmail = async (
  userName: string,
  userEmail: string,
  resetLink: string
): Promise<boolean> => {
  const html = getPasswordResetTemplate(userName, resetLink);
  
  return sendEmail({
    to: userEmail,
    subject: "إعادة تعيين كلمة المرور - إديو سنتر",
    html,
  });
};

/**
 * Send account deletion email
 */
export const sendAccountDeletionEmail = async (
  userName: string,
  userEmail: string
): Promise<boolean> => {
  const html = getAccountDeletionTemplate(userName);
  
  return sendEmail({
    to: userEmail,
    subject: "إشعار حذف الحساب - إديو سنتر",
    html,
  });
};

// ==========================================
// EMAIL TEMPLATES
// ==========================================

const baseStyles = `
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; direction: rtl; text-align: right; margin: 0; padding: 0; background-color: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
    .header { background: linear-gradient(135deg, #4F46E5, #7C3AED); padding: 40px 30px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 28px; }
    .header p { color: #E0E7FF; margin: 10px 0 0; font-size: 16px; }
    .content { padding: 40px 30px; }
    .content h2 { color: #1F2937; font-size: 24px; margin-top: 0; }
    .content p { color: #4B5563; font-size: 16px; line-height: 1.6; }
    .button { display: inline-block; background: linear-gradient(135deg, #4F46E5, #7C3AED); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: bold; margin: 20px 0; }
    .features { background-color: #F9FAFB; border-radius: 12px; padding: 24px; margin: 24px 0; }
    .feature-item { display: flex; align-items: center; gap: 12px; margin: 12px 0; }
    .feature-icon { width: 40px; height: 40px; background: linear-gradient(135deg, #4F46E5, #7C3AED); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-size: 18px; }
    .footer { background-color: #F9FAFB; padding: 30px; text-align: center; border-top: 1px solid #E5E7EB; }
    .footer p { color: #6B7280; font-size: 14px; margin: 5px 0; }
    .social-links { margin: 20px 0; }
    .social-links a { display: inline-block; margin: 0 8px; color: #4F46E5; text-decoration: none; }
    .divider { height: 1px; background-color: #E5E7EB; margin: 24px 0; }
  </style>
`;

const getTeacherWelcomeTemplate = (name: string) => `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>مرحباً بك في إديو سنتر</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F3F4F6; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  
  <!-- Main Container -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #F3F4F6;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        
        <!-- Email Container -->
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 48px 40px; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 16px;">🎓</div>
              <h1 style="color: #FFFFFF; margin: 0 0 8px 0; font-size: 32px; font-weight: 700;">إديو سنتر</h1>
              <p style="color: #E0E7FF; margin: 0; font-size: 18px;">مرحباً بك في منصة التعليم الرائدة</p>
            </td>
          </tr>
          
          <!-- Welcome Message -->
          <tr>
            <td style="padding: 48px 40px 32px 40px;">
              <h2 style="color: #111827; margin: 0 0 16px 0; font-size: 28px; font-weight: 700;">مرحباً ${name}! 👋</h2>
              <p style="color: #4B5563; margin: 0; font-size: 18px; line-height: 1.7;">
                يسعدنا انضمامك إلى فريق المعلمين في إديو سنتر. حسابك كمعلم جاهز الآن!
              </p>
            </td>
          </tr>
          
          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;">
              <hr style="border: none; border-top: 2px solid #E5E7EB; margin: 0;">
            </td>
          </tr>
          
          <!-- Features Section -->
          <tr>
            <td style="padding: 32px 40px;">
              <h3 style="color: #111827; margin: 0 0 24px 0; font-size: 22px; font-weight: 700;">ما يمكنك فعله الآن:</h3>
              
              <!-- Feature 1 -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 20px;">
                <tr>
                  <td width="60" valign="top">
                    <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%); border-radius: 12px; text-align: center; line-height: 56px; font-size: 24px;">📚</div>
                  </td>
                  <td style="padding-right: 16px;" valign="top">
                    <h4 style="color: #111827; margin: 0 0 4px 0; font-size: 18px; font-weight: 600;">إنشاء مجموعات دراسية</h4>
                    <p style="color: #6B7280; margin: 0; font-size: 15px; line-height: 1.5;">أنشئ مجموعاتك وأضف الطلاب إليها</p>
                  </td>
                </tr>
              </table>
              
              <!-- Feature 2 -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 20px;">
                <tr>
                  <td width="60" valign="top">
                    <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%); border-radius: 12px; text-align: center; line-height: 56px; font-size: 24px;">📅</div>
                  </td>
                  <td style="padding-right: 16px;" valign="top">
                    <h4 style="color: #111827; margin: 0 0 4px 0; font-size: 18px; font-weight: 600;">إدارة جدولك</h4>
                    <p style="color: #6B7280; margin: 0; font-size: 15px; line-height: 1.5;">حدد مواعيد حصصك بسهولة</p>
                  </td>
                </tr>
              </table>
              
              <!-- Feature 3 -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 20px;">
                <tr>
                  <td width="60" valign="top">
                    <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%); border-radius: 12px; text-align: center; line-height: 56px; font-size: 24px;">💰</div>
                  </td>
                  <td style="padding-right: 16px;" valign="top">
                    <h4 style="color: #111827; margin: 0 0 4px 0; font-size: 18px; font-weight: 600;">متابعة أرباحك</h4>
                    <p style="color: #6B7280; margin: 0; font-size: 15px; line-height: 1.5;">تتبع أرباحك واطلب السحب</p>
                  </td>
                </tr>
              </table>
              
              <!-- Feature 4 -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 0;">
                <tr>
                  <td width="60" valign="top">
                    <div style="width: 56px; height: 56px; background: linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%); border-radius: 12px; text-align: center; line-height: 56px; font-size: 24px;">📊</div>
                  </td>
                  <td style="padding-right: 16px;" valign="top">
                    <h4 style="color: #111827; margin: 0 0 4px 0; font-size: 18px; font-weight: 600;">تقارير الأداء</h4>
                    <p style="color: #6B7280; margin: 0; font-size: 15px; line-height: 1.5;">تابع أداء طلابك بالتفصيل</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- CTA Button -->
          <tr>
            <td style="padding: 16px 40px 48px 40px; text-align: center;">
              <a href="${process.env.FRONTEND_URL || "http://localhost:3000"}/teacher" style="display: inline-block; background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); color: #FFFFFF; text-decoration: none; padding: 18px 48px; border-radius: 12px; font-size: 18px; font-weight: 700; box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);">
                ابدأ التدريس الآن
              </a>
            </td>
          </tr>
          
          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;">
              <hr style="border: none; border-top: 2px solid #E5E7EB; margin: 0;">
            </td>
          </tr>
          
          <!-- Help Text -->
          <tr>
            <td style="padding: 32px 40px;">
              <p style="color: #4B5563; margin: 0 0 12px 0; font-size: 16px; line-height: 1.6;">
                إذا كنت بحاجة إلى أي مساعدة، لا تتردد في التواصل معنا.
              </p>
              <p style="color: #4B5563; margin: 0; font-size: 16px; line-height: 1.6;">
                مع تحيات فريق إديو سنتر 💜
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #F9FAFB; padding: 32px 40px; text-align: center; border-top: 2px solid #E5E7EB;">
              <!-- Social Links -->
              <p style="margin: 0 0 20px 0;">
                <a href="#" style="color: #4F46E5; text-decoration: none; margin: 0 12px; font-size: 15px;">فيسبوك</a>
                <span style="color: #D1D5DB;">|</span>
                <a href="#" style="color: #4F46E5; text-decoration: none; margin: 0 12px; font-size: 15px;">تويتر</a>
                <span style="color: #D1D5DB;">|</span>
                <a href="#" style="color: #4F46E5; text-decoration: none; margin: 0 12px; font-size: 15px;">إنستجرام</a>
              </p>
              
              <!-- Copyright -->
              <p style="color: #6B7280; margin: 0 0 8px 0; font-size: 14px;">
                © ${new Date().getFullYear()} إديو سنتر. جميع الحقوق محفوظة.
              </p>
              
              <!-- Disclaimer -->
              <p style="color: #9CA3AF; margin: 0; font-size: 12px;">
                تم إرسال هذا البريد تلقائياً، يرجى عدم الرد عليه.
              </p>
            </td>
          </tr>
          
        </table>
        <!-- End Email Container -->
        
      </td>
    </tr>
  </table>
  <!-- End Main Container -->
  
</body>
</html>
`;

const getStudentWelcomeTemplate = (name: string) => `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${baseStyles}
</head>
<body>
  <div class="container">
    <div class="header" style="background: linear-gradient(135deg, #059669, #10B981);">
      <h1>🎓 إديو سنتر</h1>
      <p>ابدأ رحلتك التعليمية</p>
    </div>
    <div class="content">
      <h2>مرحباً ${name}! 👋</h2>
      <p>يسعدنا انضمامك إلى إديو سنتر. حسابك كطالب جاهز الآن!</p>
      
      <div class="features">
        <h3 style="margin-top: 0; color: #1F2937;">ما يمكنك فعله الآن:</h3>
        <div class="feature-item">
          <div class="feature-icon" style="background: linear-gradient(135deg, #059669, #10B981);">🔍</div>
          <div>
            <strong>استكشف المجموعات</strong>
            <p style="margin: 4px 0 0; font-size: 14px; color: #6B7280;">ابحث عن المجموعات المناسبة لك</p>
          </div>
        </div>
        <div class="feature-item">
          <div class="feature-icon" style="background: linear-gradient(135deg, #059669, #10B981);">📝</div>
          <div>
            <strong>سجّل في المجموعات</strong>
            <p style="margin: 4px 0 0; font-size: 14px; color: #6B7280;">انضم إلى مجموعات المعلمين</p>
          </div>
        </div>
        <div class="feature-item">
          <div class="feature-icon" style="background: linear-gradient(135deg, #059669, #10B981);">📊</div>
          <div>
            <strong>تتبع تقدمك</strong>
            <p style="margin: 4px 0 0; font-size: 14px; color: #6B7280;">تابع حضورك وأدائك</p>
          </div>
        </div>
      </div>

      <div style="text-align: center;">
        <a href="${process.env.FRONTEND_URL || "http://localhost:3000"}/student" class="button" style="background: linear-gradient(135deg, #059669, #10B981);">
          ابدأ التعلم الآن
        </a>
      </div>

      <div class="divider"></div>

      <p>مع تحيات فريق إديو سنتر 💜</p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} إديو سنتر. جميع الحقوق محفوظة.</p>
    </div>
  </div>
</body>
</html>
`;

const getParentWelcomeTemplate = (name: string) => `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${baseStyles}
</head>
<body>
  <div class="container">
    <div class="header" style="background: linear-gradient(135deg, #D97706, #F59E0B);">
      <h1>🎓 إديو سنتر</h1>
      <p>تتبع تقدم طفلك التعليمي</p>
    </div>
    <div class="content">
      <h2>مرحباً ${name}! 👋</h2>
      <p>يسعدنا انضمامك إلى إديو سنتر. حسابك كولي أمر جاهز الآن!</p>
      
      <div class="features">
        <h3 style="margin-top: 0; color: #1F2937;">ما يمكنك فعله الآن:</h3>
        <div class="feature-item">
          <div class="feature-icon" style="background: linear-gradient(135deg, #D97706, #F59E0B);">👶</div>
          <div>
            <strong>ربط حساب طفلك</strong>
            <p style="margin: 4px 0 0; font-size: 14px; color: #6B7280;">استخدم رمز الربط لربط حساب طفلك</p>
          </div>
        </div>
        <div class="feature-item">
          <div class="feature-icon" style="background: linear-gradient(135deg, #D97706, #F59E0B);">📊</div>
          <div>
            <strong>متابعة الأداء</strong>
            <p style="margin: 4px 0 0; font-size: 14px; color: #6B7280;">تتبع حضور وأداء طفلك</p>
          </div>
        </div>
        <div class="feature-item">
          <div class="feature-icon" style="background: linear-gradient(135deg, #D97706, #F59E0B);">💳</div>
          <div>
            <strong>إدارة المدفوعات</strong>
            <p style="margin: 4px 0 0; font-size: 14px; color: #6B7280;">ادفع رسوم المجموعات بسهولة</p>
          </div>
        </div>
      </div>

      <div style="text-align: center;">
        <a href="${process.env.FRONTEND_URL || "http://localhost:3000"}/parent" class="button" style="background: linear-gradient(135deg, #D97706, #F59E0B);">
          لوحة التحكم
        </a>
      </div>

      <div class="divider"></div>

      <p>مع تحيات فريق إديو سنتر 💜</p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} إديو سنتر. جميع الحقوق محفوظة.</p>
    </div>
  </div>
</body>
</html>
`;

const getVerificationTemplate = (name: string, link: string) => `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${baseStyles}
</head>
<body>
  <div class="container">
    <div class="header" style="background: linear-gradient(135deg, #2563EB, #3B82F6);">
      <h1>📧 تأكيد البريد الإلكتروني</h1>
    </div>
    <div class="content">
      <h2>مرحباً ${name}!</h2>
      <p>شكراً لتسجيلك في إديو سنتر. يرجى تأكيد بريدك الإلكتروني بالنقر على الزر أدناه:</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${link}" class="button" style="background: linear-gradient(135deg, #2563EB, #3B82F6);">
          تأكيد البريد الإلكتروني
        </a>
      </div>

      <p style="font-size: 14px; color: #6B7280;">إذا لم تقم بإنشاء حساب، يمكنك تجاهل هذا البريد.</p>
      
      <div class="divider"></div>
      
      <p style="font-size: 14px; color: #6B7280;">رابط التأكيد: <a href="${link}" style="color: #2563EB;">${link}</a></p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} إديو سنتر. جميع الحقوق محفوظة.</p>
    </div>
  </div>
</body>
</html>
`;

const getPasswordResetTemplate = (name: string, link: string) => `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${baseStyles}
</head>
<body>
  <div class="container">
    <div class="header" style="background: linear-gradient(135deg, #DC2626, #EF4444);">
      <h1>🔐 إعادة تعيين كلمة المرور</h1>
    </div>
    <div class="content">
      <h2>مرحباً ${name}!</h2>
      <p>تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بك. انقر على الزر أدناه لإنشاء كلمة مرور جديدة:</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${link}" class="button" style="background: linear-gradient(135deg, #DC2626, #EF4444);">
          إعادة تعيين كلمة المرور
        </a>
      </div>

      <p style="font-size: 14px; color: #6B7280;">هذا الرابط صالح لمدة ساعة واحدة فقط.</p>
      <p style="font-size: 14px; color: #6B7280;">إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذا البريد.</p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} إديو سنتر. جميع الحقوق محفوظة.</p>
    </div>
  </div>
</body>
</html>
`;

const getAccountDeletionTemplate = (name: string) => `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>إشعار حذف الحساب</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F3F4F6; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  
  <!-- Main Container -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #F3F4F6;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        
        <!-- Email Container -->
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #DC2626 0%, #EF4444 100%); padding: 48px 40px; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
              <h1 style="color: #FFFFFF; margin: 0 0 8px 0; font-size: 32px; font-weight: 700;">إشعار حذف الحساب</h1>
              <p style="color: #FEE2E2; margin: 0; font-size: 18px;">إديو سنتر</p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 48px 40px;">
              <h2 style="color: #111827; margin: 0 0 16px 0; font-size: 28px; font-weight: 700;">مرحباً ${name}</h2>
              
              <p style="color: #4B5563; margin: 0 0 24px 0; font-size: 18px; line-height: 1.7;">
                نود إعلامك بأنه تم حذف حسابك من منصة إديو سنتر بواسطة مدير النظام.
              </p>
              
              <!-- Info Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 32px 0;">
                <tr>
                  <td style="background-color: #FEF2F2; border: 2px solid #FECACA; border-radius: 12px; padding: 24px;">
                    <h3 style="color: #991B1B; margin: 0 0 12px 0; font-size: 18px; font-weight: 600;">ما يعني هذا:</h3>
                    <ul style="color: #7F1D1D; margin: 0; padding: 0 0 0 20px; font-size: 16px; line-height: 1.8;">
                      <li>لن تتمكن من تسجيل الدخول إلى حسابك</li>
                      <li>تم حذف جميع بياناتك من النظام</li>
                      <li>لن تتمكن من الوصول إلى أي محتوى مرتبط بحسابك</li>
                    </ul>
                  </td>
                </tr>
              </table>
              
              <p style="color: #4B5563; margin: 0 0 16px 0; font-size: 18px; line-height: 1.7;">
                إذا كنت تعتقد أن هذا الخطأ، يرجى التواصل مع فريق الدعم الفني.
              </p>
              
              <!-- Contact Info -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 32px 0;">
                <tr>
                  <td style="background-color: #F9FAFB; border-radius: 12px; padding: 24px; text-align: center;">
                    <p style="color: #6B7280; margin: 0 0 8px 0; font-size: 14px;">للتواصل مع الدعم الفني</p>
                    <p style="color: #4F46E5; margin: 0; font-size: 18px; font-weight: 600;">support@educenter.com</p>
                  </td>
                </tr>
              </table>
              
              <p style="color: #4B5563; margin: 0; font-size: 16px; line-height: 1.6;">
                مع تحيات فريق إديو سنتر
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #F9FAFB; padding: 32px 40px; text-align: center; border-top: 2px solid #E5E7EB;">
              <p style="color: #6B7280; margin: 0 0 8px 0; font-size: 14px;">
                © ${new Date().getFullYear()} إديو سنتر. جميع الحقوق محفوظة.
              </p>
              <p style="color: #9CA3AF; margin: 0; font-size: 12px;">
                تم إرسال هذا البريد تلقائياً، يرجى عدم الرد عليه.
              </p>
            </td>
          </tr>
          
        </table>
        <!-- End Email Container -->
        
      </td>
    </tr>
  </table>
  <!-- End Main Container -->
  
</body>
</html>
`;
