import mongoose, { Document, Schema } from "mongoose";

export interface IGroupInvitation extends Document {
  groupId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  teacherId: mongoose.Types.ObjectId;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  stage: string;
  grade: string;
  subject: string;
  password?: string;
  createdAt: Date;
  updatedAt: Date;
}

const groupInvitationSchema = new Schema<IGroupInvitation>(
  {
    groupId: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      required: true,
      index: true,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    teacherId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "REJECTED"],
      default: "PENDING",
    },
    stage: {
      type: String,
      trim: true,
    },
    grade: {
      type: String,
      trim: true,
    },
    subject: {
      type: String,
      trim: true,
    },
    password: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

groupInvitationSchema.index({ studentId: 1, status: 1 });
groupInvitationSchema.index({ groupId: 1, status: 1 });

export const GroupInvitation = mongoose.model<IGroupInvitation>("GroupInvitation", groupInvitationSchema);
