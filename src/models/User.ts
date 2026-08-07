import mongoose, { Document, Schema } from "mongoose";

export interface IVerificationData {
  experience?: string;
  curriculum?: string[];
  bio?: string;
  documents?: string[];
}

export interface IUser extends Document {
  supabaseId: string;
  name: string;
  email: string;
  phone: string;
  avatarUrl?: string;
  role: "TEACHER" | "STUDENT" | "PARENT" | "ADMIN";
  parentId?: mongoose.Types.ObjectId;
  students: mongoose.Types.ObjectId[];
  linkingCode?: string;
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

const userSchema = new Schema<IUser>(
  {
    supabaseId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
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
    linkingCode: {
      type: String,
      unique: true,
      sparse: true,
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

export const User = mongoose.model<IUser>("User", userSchema);
