import mongoose, { Document, Schema } from "mongoose";

export interface IParentChildInvitation extends Document {
  senderId: mongoose.Types.ObjectId;
  senderRole: "PARENT" | "STUDENT";
  targetUserId: mongoose.Types.ObjectId;
  targetEmail?: string;
  targetPhone?: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  message?: string;
  respondedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const parentChildInvitationSchema = new Schema<IParentChildInvitation>(
  {
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    senderRole: {
      type: String,
      enum: ["PARENT", "STUDENT"],
      required: true,
    },
    targetUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    targetEmail: {
      type: String,
      trim: true,
    },
    targetPhone: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "REJECTED"],
      default: "PENDING",
    },
    message: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    respondedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

parentChildInvitationSchema.index({ targetUserId: 1, status: 1 });
parentChildInvitationSchema.index({ senderId: 1, status: 1 });

export const ParentChildInvitation = mongoose.model<IParentChildInvitation>(
  "ParentChildInvitation",
  parentChildInvitationSchema
);