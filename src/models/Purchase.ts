import mongoose, { Document, Schema } from "mongoose";

export interface IPurchase extends Document {
  groupId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  type: "LECTURES" | "MONTHLY";
  lectures: number;
  remainingLectures: number;
  monthlyExpiresAt: Date | null;
  unitPrice: number;
  amountPaid: number;
  teacherShareTotal: number;
  platformFeeTotal: number;
  status: "PAID";
  createdAt: Date;
  updatedAt: Date;
}

const purchaseSchema = new Schema<IPurchase>(
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
    type: {
      type: String,
      enum: ["LECTURES", "MONTHLY"],
      required: true,
    },
    lectures: {
      type: Number,
      required: true,
      min: 1,
    },
    remainingLectures: {
      type: Number,
      default: 0,
      min: 0,
    },
    monthlyExpiresAt: {
      type: Date,
      default: null,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    amountPaid: {
      type: Number,
      required: true,
      min: 0,
    },
    teacherShareTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    platformFeeTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["PAID"],
      default: "PAID",
    },
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

purchaseSchema.index({ studentId: 1, groupId: 1 });
purchaseSchema.index({ groupId: 1, status: 1 });

export const Purchase = mongoose.model<IPurchase>("Purchase", purchaseSchema);
