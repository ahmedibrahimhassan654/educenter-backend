import mongoose, { Document, Schema } from "mongoose";

export interface IGroup extends Document {
  teacherId: mongoose.Types.ObjectId;
  title: string;
  subject: string;
  grade: string;
  stage: string;
  priceTeacherShare: number;
  platformFee: number;
  totalSessionPrice: number;
  maxStudentsPerGroup: number;
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
    stage: {
      type: String,
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
    maxStudentsPerGroup: {
      type: Number,
      default: 20,
      min: 1,
    },
    googleMeetLink: {
      type: String,
      trim: true,
    },
    scheduleDays: [
      {
        type: String,
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
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        if (ret._id) {
          ret.id = ret._id;
          delete ret._id;
        }
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        if (ret._id) {
          ret.id = ret._id;
          delete ret._id;
        }
        return ret;
      },
    },
  }
);

export const Group = mongoose.model<IGroup>("Group", groupSchema);