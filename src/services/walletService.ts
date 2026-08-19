import mongoose from "mongoose";
import { Wallet, WalletTransaction } from "../models/Wallet";
import { Purchase } from "../models/Purchase";

/**
 * Return the student's wallet, creating it on first access. For data migrated
 * from the previous group-scoped model, the initial balance is seeded from the
 * sum of all LECTURES purchase remaining credits so no credit is lost.
 */
export async function getOrCreateWallet(
  studentId: mongoose.Types.ObjectId | string
): Promise<InstanceType<typeof Wallet>> {
  const existing = await Wallet.findOne({ studentId });
  if (existing) return existing;

  const legacyPurchases = await Purchase.find({
    studentId,
    type: "LECTURES",
  }).lean();
  const seedBalance = legacyPurchases.reduce(
    (sum, p) => sum + (p.remainingLectures || 0),
    0
  );

  return Wallet.create({ studentId, balance: seedBalance });
}

export async function getWalletBalance(
  studentId: mongoose.Types.ObjectId | string
): Promise<number> {
  const wallet = await getOrCreateWallet(studentId);
  return wallet.balance;
}

/**
 * Add credits to the student's general wallet (LECTURES purchase).
 */
export async function addWalletCredits(
  studentId: mongoose.Types.ObjectId | string,
  amount: number,
  groupId?: mongoose.Types.ObjectId | string,
  notes?: string
): Promise<number> {
  if (amount <= 0) return getWalletBalance(studentId);

  const wallet = await Wallet.findOneAndUpdate(
    { studentId },
    { $inc: { balance: amount } },
    { new: true, upsert: true }
  );

  await WalletTransaction.create({
    studentId,
    type: "PURCHASE",
    amount,
    groupId: groupId || undefined,
    notes: notes || "",
  });

  return wallet.balance;
}

/**
 * Try to consume one credit from the wallet. Returns the remaining balance,
 * or -1 when the balance is insufficient. Records an OPEN_LESSON transaction
 * on success.
 */
export async function consumeWalletCredit(
  studentId: mongoose.Types.ObjectId | string,
  groupId: mongoose.Types.ObjectId | string,
  lessonId: mongoose.Types.ObjectId | string,
  notes?: string
): Promise<number> {
  const wallet = await getOrCreateWallet(studentId);
  if (wallet.balance <= 0) return -1;

  wallet.balance -= 1;
  await wallet.save();

  await WalletTransaction.create({
    studentId,
    type: "OPEN_LESSON",
    amount: -1,
    groupId: groupId || undefined,
    lessonId: lessonId || undefined,
    notes: notes || "",
  });

  return wallet.balance;
}

export async function getWalletTransactions(
  studentId: mongoose.Types.ObjectId | string
) {
  return WalletTransaction.find({ studentId }).sort({ createdAt: -1 }).lean();
}