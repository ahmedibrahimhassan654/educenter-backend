import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { Request } from "express";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Key on IP + submitted email so one attacker cannot lock out every account
 * from a single address, and one address cannot be hammered from many IPs.
 * ipKeyGenerator normalises IPv6 addresses to a subnet (required in v8).
 */
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
