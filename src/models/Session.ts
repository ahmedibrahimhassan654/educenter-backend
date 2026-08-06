import mongoose, { Document, Schema } from "mongoose";

export interface ISession extends Document {
  groupId: mongoose.Types.ObjectId;
  teacherId: mongoose.Types.ObjectId;
  title: string;
  date: Date;
  supabaseVideoPath?: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
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
    date: {
      type: Date,
      required: true,
    },
    supabaseVideoPath: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["SCHEDULED", "COMPLETED", "CANCELLED"],
      default: "SCHEDULED",
    },
  },
  {
    timestamps: true,
  }
);

export const Session = mongoose.model<ISession>("Session", sessionSchema);