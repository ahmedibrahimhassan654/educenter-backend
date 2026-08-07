import crypto from "crypto";
import { PasswordResetOtp } from "../models/PasswordResetOtp";

export const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);
export const RESET_TOKEN_TTL_MINUTES = Number(
  process.env.RESET_TOKEN_TTL_MINUTES || 10
);
export const MAX_OTP_ATTEMPTS = 5;

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Compare two hex digests without leaking timing information.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Cryptographically secure 6-digit code.
 * Note: Math.random() is NOT suitable for security codes.
 */
function generateNumericCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * Issue a fresh OTP for an email, invalidating any previous pending codes.
 * Returns the plaintext code — the caller sends it and must not persist it.
 */
export async function createOtp(email: string): Promise<string> {
  const normalized = email.toLowerCase().trim();

  // Any previously issued code becomes unusable
  await PasswordResetOtp.deleteMany({ email: normalized, consumed: false });

  const code = generateNumericCode();

  await PasswordResetOtp.create({
    email: normalized,
    codeHash: sha256(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
  });

  return code;
}

export type VerifyOtpResult =
  | { ok: true; resetToken: string }
  | { ok: false; reason: "NOT_FOUND" | "EXPIRED" | "TOO_MANY_ATTEMPTS" | "INVALID" };

/**
 * Validate a submitted code and, on success, issue a single-use reset token.
 */
export async function verifyOtp(
  email: string,
  code: string
): Promise<VerifyOtpResult> {
  const normalized = email.toLowerCase().trim();

  const record = await PasswordResetOtp.findOne({
    email: normalized,
    consumed: false,
  }).sort({ createdAt: -1 });

  if (!record) return { ok: false, reason: "NOT_FOUND" };

  if (record.expiresAt.getTime() < Date.now()) {
    await record.deleteOne();
    return { ok: false, reason: "EXPIRED" };
  }

  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    await record.deleteOne();
    return { ok: false, reason: "TOO_MANY_ATTEMPTS" };
  }

  if (!safeEqual(sha256(code), record.codeHash)) {
    record.attempts += 1;
    await record.save();
    return { ok: false, reason: "INVALID" };
  }

  // Code is correct: swap it for a reset token and restart the expiry window
  const resetToken = crypto.randomBytes(32).toString("hex");
  record.resetTokenHash = sha256(resetToken);
  record.verifiedAt = new Date();
  record.expiresAt = new Date(
    Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000
  );
  await record.save();

  return { ok: true, resetToken };
}

/**
 * Consume a reset token. Single use: the record is deleted on success.
 */
export async function consumeResetToken(
  email: string,
  resetToken: string
): Promise<boolean> {
  const normalized = email.toLowerCase().trim();

  const record = await PasswordResetOtp.findOne({
    email: normalized,
    consumed: false,
    resetTokenHash: { $ne: null },
  }).sort({ createdAt: -1 });

  if (!record || !record.resetTokenHash) return false;

  if (record.expiresAt.getTime() < Date.now()) {
    await record.deleteOne();
    return false;
  }

  if (!safeEqual(sha256(resetToken), record.resetTokenHash)) {
    return false;
  }

  await record.deleteOne();
  return true;
}
