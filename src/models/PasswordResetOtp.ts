import mongoose, { Document, Schema } from "mongoose";

export interface IPasswordResetOtp extends Document {
  email: string;
  // Only hashes are stored, never the raw code or token
  codeHash: string;
  resetTokenHash?: string;
  attempts: number;
  consumed: boolean;
  verifiedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const passwordResetOtpSchema = new Schema<IPasswordResetOtp>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    codeHash: {
      type: String,
      required: true,
    },
    // Issued once the code is verified; required to actually change the password
    resetTokenHash: {
      type: String,
      default: null,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    consumed: {
      type: Boolean,
      default: false,
    },
    verifiedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Mongo removes documents automatically once expiresAt passes
passwordResetOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordResetOtp = mongoose.model<IPasswordResetOtp>(
  "PasswordResetOtp",
  passwordResetOtpSchema
);
