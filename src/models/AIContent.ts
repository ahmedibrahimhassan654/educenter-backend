import mongoose, { Document, Schema } from "mongoose";

export interface IAIContent extends Document {
  userId: mongoose.Types.ObjectId;
  type: "DOCUMENT" | "VIDEO_TRANSCRIPT";
  title: string;
  sourceType:
    | "SESSION_RECORDING"
    | "UPLOAD"
    | "CURRICULUM"
    | "LESSON_DOCUMENT"
    | "LESSON_VIDEO";
  sourceId?: string;
  lessonId?: mongoose.Types.ObjectId;
  groupId?: mongoose.Types.ObjectId;
  supabasePath?: string;
  content: string;
  tokenCount: number;
  status: "PROCESSING" | "READY" | "ERROR";
  error?: string;
  metadata: {
    fileType?: string;
    fileSize?: number;
    pageCount?: number;
    duration?: number;
    language?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const aiContentSchema = new Schema<IAIContent>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["DOCUMENT", "VIDEO_TRANSCRIPT"],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    sourceType: {
      type: String,
      enum: ["SESSION_RECORDING", "UPLOAD", "CURRICULUM", "LESSON_DOCUMENT", "LESSON_VIDEO"],
      required: true,
    },
    sourceId: {
      type: String,
      trim: true,
    },
    lessonId: {
      type: Schema.Types.ObjectId,
      ref: "Lesson",
      index: true,
    },
    groupId: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      index: true,
    },
    supabasePath: {
      type: String,
      trim: true,
    },
    content: {
      type: String,
      default: "",
    },
    tokenCount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["PROCESSING", "READY", "ERROR"],
      default: "PROCESSING",
    },
    error: {
      type: String,
    },
    metadata: {
      fileType: String,
      fileSize: Number,
      pageCount: Number,
      duration: Number,
      language: { type: String, default: "ar" },
    },
  },
  {
    timestamps: true,
  }
);

export const AIContent = mongoose.model<IAIContent>("AIContent", aiContentSchema);
