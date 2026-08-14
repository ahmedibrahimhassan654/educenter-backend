import mongoose, { Document, Schema } from "mongoose";

export interface IVerificationData {
  experience?: string;
  curriculum?: string[];
  bio?: string;
  documents?: string[];
}

export interface IAcademicEntry {
  stage: string;
  grade: string;
  year: string;
  startDate?: Date;
  endDate?: Date;
}

export interface IUser extends Document {
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  avatarUrl?: string;
  role: "TEACHER" | "STUDENT" | "PARENT" | "ADMIN";
  parentId?: mongoose.Types.ObjectId;
  students: mongoose.Types.ObjectId[];
  groups: mongoose.Types.ObjectId[];
  linkingCode?: string;
  stage?: string;
  grade?: string;
  academicHistory?: IAcademicEntry[];
  // Verification fields (for teachers)
  verificationStatus: "PENDING" | "SUBMITTED" | "VERIFIED" | "REJECTED";
  verificationData?: IVerificationData;
  verificationNotes?: string;
  verifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const verificationDataSchema = new Schema<IVerificationData>(
  {
    experience: { type: String, trim: true },
    curriculum: [{ type: String, trim: true }],
    bio: { type: String, trim: true },
    documents: [{ type: String }],
  },
  { _id: false }
);

const academicEntrySchema = new Schema<IAcademicEntry>(
  {
    stage: { type: String, trim: true },
    grade: { type: String, trim: true },
    year: { type: String, trim: true },
    startDate: { type: Date },
    endDate: { type: Date },
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      enum: ["TEACHER", "STUDENT", "PARENT", "ADMIN"],
      default: "STUDENT",
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    students: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    groups: [
      {
        type: Schema.Types.ObjectId,
        ref: "Group",
        index: true,
      },
    ],
    linkingCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    stage: {
      type: String,
      trim: true,
    },
    grade: {
      type: String,
      trim: true,
    },
    academicHistory: {
      type: [academicEntrySchema],
      default: undefined,
    },
    // Verification fields
    verificationStatus: {
      type: String,
      enum: ["PENDING", "SUBMITTED", "VERIFIED", "REJECTED"],
      default: function (this: IUser) {
        return this.role === "TEACHER" ? "PENDING" : "VERIFIED";
      },
    },
    verificationData: {
      type: verificationDataSchema,
      default: undefined,
    },
    verificationNotes: {
      type: String,
      trim: true,
    },
    verifiedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Generate linking code before saving
userSchema.pre("save" as any, async function (this: IUser) {
  if (this.isNew && (this.role === "STUDENT" || this.role === "PARENT")) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.linkingCode = code;
  }
});

// Compound index for admin filtering (email and linkingCode already indexed via unique: true)
userSchema.index({ role: 1, verificationStatus: 1 });
userSchema.index({ role: 1, stage: 1, grade: 1 });

export const User = mongoose.model<IUser>("User", userSchema);
