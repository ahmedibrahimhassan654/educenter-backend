import { User } from "../models/User";
import mongoose from "mongoose";

/**
 * Link a student to a parent (idempotent).
 * Sets student.parentId and adds the student to parent.students.
 */
export const linkParentChild = async (
  parentId: string | mongoose.Types.ObjectId,
  studentId: string | mongoose.Types.ObjectId
): Promise<boolean> => {
  const student = await User.findByIdAndUpdate(
    studentId,
    { $set: { parentId } },
    { new: true }
  );
  if (!student) return false;

  await User.findByIdAndUpdate(parentId, {
    $addToSet: { students: student._id },
  });

  return true;
};

/**
 * Unlink a student from a parent (idempotent).
 * Removes the student from parent.students and clears student.parentId.
 */
export const unlinkParentChild = async (
  parentId: string | mongoose.Types.ObjectId,
  studentId: string | mongoose.Types.ObjectId
): Promise<boolean> => {
  const parent = await User.findByIdAndUpdate(parentId, {
    $pull: { students: studentId },
  });
  if (!parent) return false;

  await User.findByIdAndUpdate(studentId, {
    $unset: { parentId: "" },
  });

  return true;
};

/**
 * Check whether a student is already linked to the given parent
 * (or to any parent).
 */
export const isStudentLinked = async (
  studentId: string | mongoose.Types.ObjectId,
  parentId?: string | mongoose.Types.ObjectId
): Promise<boolean> => {
  const student = await User.findById(studentId).select("parentId");
  if (!student) return false;
  if (!student.parentId) return false;
  if (parentId) return student.parentId.toString() === parentId.toString();
  return true;
};

/**
 * Check whether the given student is already in the parent's children list.
 */
export const isInParentChildren = async (
  parentId: string | mongoose.Types.ObjectId,
  studentId: string | mongoose.Types.ObjectId
): Promise<boolean> => {
  const parent = await User.findById(parentId).select("students");
  if (!parent) return false;
  return (parent.students || []).some(
    (id) => id.toString() === studentId.toString()
  );
};