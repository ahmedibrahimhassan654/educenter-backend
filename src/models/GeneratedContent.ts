import mongoose, { Document, Schema } from "mongoose";

export interface IGeneratedContent extends Document {
  userId: mongoose.Types.ObjectId;
  contentId: mongoose.Types.ObjectId;
  type: "QUESTIONS" | "SUMMARY" | "FLASHCARDS" | "STUDY_NOTES";
  title: string;
  data: any;
  config: {
    questionCount?: number;
    difficulty?: string;
    language: string;
    questionType?: string;
  };
  createdAt: Date;
}

const generatedContentSchema = new Schema<IGeneratedContent>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    contentId: {
      type: Schema.Types.ObjectId,
      ref: "AIContent",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["QUESTIONS", "SUMMARY", "FLASHCARDS", "STUDY_NOTES"],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    data: {
      type: Schema.Types.Mixed,
      required: true,
    },
    config: {
      questionCount: Number,
      difficulty: { type: String, default: "medium" },
      language: { type: String, default: "ar" },
      questionType: { type: String, default: "mixed" },
    },
  },
  {
    timestamps: true,
  }
);

export const GeneratedContent = mongoose.model<IGeneratedContent>("GeneratedContent", generatedContentSchema);
