import rateLimit from "express-rate-limit";
import { Request } from "express";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Key on IP + submitted email so one attacker cannot lock out every account
 * from a single address, and one address cannot be hammered from many IPs.
 */
function ipKeyGenerator(ip: string): string {
  // Normalize IPv6 to subnet (required in v8)
  if (ip.includes(":")) {
    return ip.split(":").slice(0, 4).join(":");
  }
  return ip;
}

function ipAndEmailKey(req: Request): string {
  const email = String(req.body?.email || "").toLowerCase().trim();
  return `${ipKeyGenerator(req.ip || "")}:${email}`;
}

const common = {
  windowMs: WINDOW_MS,
  standardHeaders: true,
  legacyHeaders: false,
};

/** Requesting a new code is the most abusable step (it sends email). */
export const forgotPasswordLimiter = rateLimit({
  ...common,
  limit: 3,
  keyGenerator: ipAndEmailKey,
  message: {
    message: "لقد تجاوزت عدد المحاولات المسموح بها. حاول مرة أخرى بعد ١٥ دقيقة.",
  },
});

/** Guards against brute-forcing the 6-digit code across many records. */
export const verifyOtpLimiter = rateLimit({
  ...common,
  limit: 10,
  keyGenerator: ipAndEmailKey,
  message: {
    message: "لقد تجاوزت عدد المحاولات المسموح بها. حاول مرة أخرى بعد ١٥ دقيقة.",
  },
});

export const resetPasswordLimiter = rateLimit({
  ...common,
  limit: 5,
  keyGenerator: ipAndEmailKey,
  message: {
    message: "لقد تجاوزت عدد المحاولات المسموح بها. حاول مرة أخرى بعد ١٥ دقيقة.",
  },
});

/** Authenticated, so key on the user id rather than the request body. */
export const changePasswordLimiter = rateLimit({
  ...common,
  limit: 5,
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?._id?.toString();
    return userId || ipKeyGenerator(req.ip || "");
  },
  message: {
    message: "لقد تجاوزت عدد المحاولات المسموح بها. حاول مرة أخرى بعد ١٥ دقيقة.",
  },
});

/** Login attempts - stricter limit */
export const loginLimiter = rateLimit({
  ...common,
  limit: 10,
  keyGenerator: ipAndEmailKey,
  message: {
    message: "لقد تجاوزت عدد محاولات تسجيل الدخول. حاول مرة أخرى بعد ١٥ دقيقة.",
  },
});

/** Registration attempts - prevent spam signups */
export const registerLimiter = rateLimit({
  ...common,
  limit: 5,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip || ""),
  message: {
    message: "لقد تجاوزت عدد محاولات التسجيل. حاول مرة أخرى بعد ١٥ دقيقة.",
  },
});

/** Family invitation sending - prevent spamming other users */
export const familyInvitationLimiter = rateLimit({
  ...common,
  limit: 10,
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?._id?.toString();
    return userId || ipKeyGenerator(req.ip || "");
  },
  message: {
    message: "لقد تجاوزت عدد الدعوات المسموح بها. حاول مرة أخرى بعد ١٥ دقيقة.",
  },
});
