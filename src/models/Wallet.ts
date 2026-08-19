import mongoose, { Document, Schema } from "mongoose";

export interface IWallet extends Document {
  studentId: mongoose.Types.ObjectId;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IWalletTransaction extends Document {
  studentId: mongoose.Types.ObjectId;
  type: "PURCHASE" | "OPEN_LESSON";
  amount: number;
  groupId?: mongoose.Types.ObjectId;
  lessonId?: mongoose.Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A student's general lesson-credit wallet. Balance is shared across all
 * groups the student joins. Opening a lesson consumes one credit the first
 * time; buying LECTURES packs adds to the balance.
 */
const walletSchema = new Schema<IWallet>(
  {
    studentId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

walletSchema.index({ studentId: 1 }, { unique: true });

const walletTransactionSchema = new Schema<IWalletTransaction>(
  {
    studentId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["PURCHASE", "OPEN_LESSON"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    groupId: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      default: null,
    },
    lessonId: {
      type: Schema.Types.ObjectId,
      ref: "Lesson",
      default: null,
    },
    notes: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

walletTransactionSchema.index({ studentId: 1, createdAt: -1 });

export const Wallet = mongoose.model<IWallet>("Wallet", walletSchema);
export const WalletTransaction = mongoose.model<IWalletTransaction>(
  "WalletTransaction",
  walletTransactionSchema
);