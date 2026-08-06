import mongoose, { Document, Schema } from "mongoose";

export interface IGroup extends Document {
  teacherId: mongoose.Types.ObjectId;
  title: string;
  subject: string;
  grade: string;
  priceTeacherShare: number;
  platformFee: number;
  totalSessionPrice: number;
  googleMeetLink: string;
  scheduleDays: string[];
  students: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const groupSchema = new Schema<IGroup>(
  {
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
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    grade: {
      type: String,
      required: true,
      trim: true,
    },
    priceTeacherShare: {
      type: Number,
      default: 50,
    },
    platformFee: {
      type: Number,
      default: 10,
    },
    totalSessionPrice: {
      type: Number,
      default: 60,
    },
    googleMeetLink: {
      type: String,
      trim: true,
    },
    scheduleDays: [
      {
        type: String,
        enum: [
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ],
      },
    ],
    students: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  {
    timestamps: true,
  }
);

export const Group = mongoose.model<IGroup>("Group", groupSchema);