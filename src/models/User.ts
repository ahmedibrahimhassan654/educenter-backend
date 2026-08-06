import mongoose, { Document, Schema } from "mongoose";

export interface IUser extends Document {
  supabaseId: string;
  name: string;
  email: string;
  phone: string;
  avatarUrl?: string;
  role: "TEACHER" | "STUDENT" | "PARENT" | "ADMIN";
  parentId?: mongoose.Types.ObjectId;
  students: mongoose.Types.ObjectId[];
  subscriptionStatus: boolean;
  linkingCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

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
    subscriptionStatus: {
      type: Boolean,
      default: false,
    },
    linkingCode: {
      type: String,
      unique: true,
      sparse: true,
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