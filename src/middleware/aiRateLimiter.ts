import rateLimit from "express-rate-limit";
import { Request } from "express";

const AI_WINDOW_MS = 60 * 60 * 1000;

function ipKeyGenerator(ip: string): string {
  if (ip.includes(":")) {
    return ip.split(":").slice(0, 4).join(":");
  }
  return ip;
}

export const aiRateLimiter = rateLimit({
  windowMs: AI_WINDOW_MS,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?._id?.toString();
    return userId || ipKeyGenerator(req.ip || "anonymous");
  },
  message: {
    message: "لقد تجاوزت عدد طلبات الذكاء الاصطناعي المسموح بها. حاول مرة أخرى بعد ساعة.",
  },
});

export const aiHeavyRateLimiter = rateLimit({
  windowMs: AI_WINDOW_MS,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?._id?.toString();
    return userId || ipKeyGenerator(req.ip || "anonymous");
  },
  message: {
    message: "لقد تجاوزت عدد طلبات المعالجة الثقيلة المسموح بها. حاول مرة أخرى بعد ساعة.",
  },
});
