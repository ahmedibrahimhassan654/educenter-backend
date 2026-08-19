import mongoose, { Document, Schema } from "mongoose";

export interface ILesson extends Document {
  groupId: mongoose.Types.ObjectId;
  teacherId: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  type: "LIVE" | "RECORDED" | "DOCUMENT" | "LINK";
  meetingLink?: string;
  videoUrl?: string;
  documentUrl?: string;
  referenceUrl?: string;
  recordedLiveVideoUrl?: string;
  recordedVideoUrl?: string;
  documents?: string[];
  referenceLinks?: string[];
  scheduleDay?: string;
  scheduleTime?: string;
  scheduledAt?: Date;
  videoOptimized?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const lessonSchema = new Schema<ILesson>(
  {
    groupId: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      required: true,
      index: true,
    },
    teacherId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: ["LIVE", "RECORDED", "DOCUMENT", "LINK"],
      required: true,
    },
    meetingLink: {
      type: String,
      trim: true,
    },
    videoUrl: {
      type: String,
      trim: true,
    },
    documentUrl: {
      type: String,
      trim: true,
    },
    referenceUrl: {
      type: String,
      trim: true,
    },
    recordedLiveVideoUrl: {
      type: String,
      trim: true,
    },
    recordedVideoUrl: {
      type: String,
      trim: true,
    },
    documents: {
      type: [String],
      default: undefined,
    },
    referenceLinks: {
      type: [String],
      default: undefined,
    },
    scheduleDay: {
      type: String,
      trim: true,
    },
    scheduleTime: {
      type: String,
      trim: true,
    },
    scheduledAt: {
      type: Date,
    },
    videoOptimized: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for listing a group's lessons by creation order
lessonSchema.index({ groupId: 1, createdAt: -1 });

export const Lesson = mongoose.model<ILesson>("Lesson", lessonSchema);
