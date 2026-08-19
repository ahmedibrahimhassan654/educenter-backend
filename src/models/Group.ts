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
  learningPoints: string[];
  descriptionVideo: string;
  videoOptimized?: boolean;
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
    learningPoints: [
      {
        type: String,
        trim: true,
      },
    ],
    descriptionVideo: {
      type: String,
      trim: true,
    },
    videoOptimized: {
      type: Boolean,
      default: false,
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
        index: true,
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

// Virtual for students count (without loading full array)
groupSchema.virtual("studentsCount").get(function () {
  return this.students ? this.students.length : 0;
});

// Ensure virtuals are included in toJSON/toObject
groupSchema.set("toJSON", { virtuals: true });
groupSchema.set("toObject", { virtuals: true });

// Compound indexes for common query patterns
// Note: students field already has index: true in schema definition
groupSchema.index({ teacherId: 1, createdAt: -1 }); // Teacher's groups sorted by date
groupSchema.index({ stage: 1, grade: 1 }); // Filter by stage + grade
groupSchema.index({ subject: 1 }); // Filter by subject

export const Group = mongoose.model<IGroup>("Group", groupSchema);