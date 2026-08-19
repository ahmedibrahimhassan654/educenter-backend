import { Router, Response } from "express";
import { auth, AuthRequest } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
  getOrCreateWallet,
  getWalletTransactions,
} from "../services/walletService";
import { WalletTransaction } from "../models/Wallet";
import { LessonAccess } from "../models/LessonAccess";

const router = Router();

/**
 * GET /api/wallet
 * Student's general lesson-credit wallet: current balance, recent transactions,
 * and every lesson already paid for from the wallet.
 */
router.get(
  "/",
  auth,
  requireRole("STUDENT"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const studentId = req.user!._id;
      const wallet = await getOrCreateWallet(studentId);

      const transactions = await WalletTransaction.find({ studentId })
        .sort({ createdAt: -1 })
        .limit(100)
        .populate("groupId", "name")
        .populate("lessonId", "title")
        .lean();

      const paidLessons = await LessonAccess.find({ studentId })
        .sort({ consumedAt: -1 })
        .populate("groupId", "name subject stage grade")
        .populate("lessonId", "title type scheduledAt")
        .lean();

      res.json({
        success: true,
        data: {
          balance: wallet.balance,
          transactions: transactions.map((t: any) => ({
            id: t._id,
            type: t.type,
            amount: t.amount,
            notes: t.notes || "",
            groupName: t.groupId?.name || null,
            lessonTitle: t.lessonId?.title || null,
            createdAt: t.createdAt,
          })),
          paidLessons: paidLessons.map((a: any) => ({
            id: a._id,
            groupId: a.groupId?._id,
            groupName: a.groupId?.name || null,
            subject: a.groupId?.subject || null,
            stage: a.groupId?.stage || null,
            grade: a.groupId?.grade || null,
            lessonId: a.lessonId?._id,
            lessonTitle: a.lessonId?.title || null,
            lessonType: a.lessonId?.type || null,
            scheduledAt: a.lessonId?.scheduledAt || null,
            consumedAt: a.consumedAt,
          })),
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: "Error fetching wallet", error: error.message });
    }
  }
);

export default router;