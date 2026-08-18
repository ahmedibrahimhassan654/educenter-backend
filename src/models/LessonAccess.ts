import mongoose, { Document, Schema } from "mongoose";

export interface ILessonAccess extends Document {
  groupId: mongoose.Types.ObjectId;
  lessonId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  consumedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tracks which lessons a student has already paid for (opened). Unlocking a
 * lesson consumes one LECTURES credit the first time it is opened; afterwards
 * the lesson stays unlocked for that student without further charges. Monthly
 * subscribers are granted access without creating records (time-bound access).
 */
const lessonAccessSchema = new Schema<ILessonAccess>(
  {
    groupId: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      required: true,
      index: true,
    },
    lessonId: {
      type: Schema.Types.ObjectId,
      ref: "Lesson",
      required: true,
      index: true,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    consumedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

lessonAccessSchema.index({ lessonId: 1, studentId: 1 }, { unique: true });

export const LessonAccess = mongoose.model<ILessonAccess>(
  "LessonAccess",
  lessonAccessSchema
);