import mongoose, { Document, Schema } from "mongoose";

export interface INotification extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  message: string;
  type: "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "SYSTEM";
  category: "GENERAL" | "USER" | "PAYMENT" | "GROUP" | "SESSION" | "ATTENDANCE" | "SYSTEM";
  isRead: boolean;
  link?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: {
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
    message: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["INFO", "SUCCESS", "WARNING", "ERROR", "SYSTEM"],
      default: "INFO",
    },
    category: {
      type: String,
      enum: ["GENERAL", "USER", "PAYMENT", "GROUP", "SESSION", "ATTENDANCE", "SYSTEM"],
      default: "GENERAL",
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    link: {
      type: String,
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification = mongoose.model<INotification>("Notification", notificationSchema);

// ==========================================
// NOTIFICATION SETTINGS SCHEMA
// ==========================================

export interface INotificationSetting extends Document {
  userId: mongoose.Types.ObjectId;
  settings: {
    // Teacher notifications
    newStudent: boolean;
    studentPayment: boolean;
    sessionReminder: boolean;
    sessionCancelled: boolean;
    groupUpdate: boolean;
    
    // Student notifications
    newSession: boolean;
    homeworkGraded: boolean;
    attendanceMarked: boolean;
    
    // Parent notifications
    childAttendance: boolean;
    childProgress: boolean;
    paymentReminder: boolean;
    
    // Common notifications
    systemUpdates: boolean;
    weeklyReport: boolean;
    promotions: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const notificationSettingSchema = new Schema<INotificationSetting>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    settings: {
      // Teacher notifications
      newStudent: { type: Boolean, default: true },
      studentPayment: { type: Boolean, default: true },
      sessionReminder: { type: Boolean, default: true },
      sessionCancelled: { type: Boolean, default: true },
      groupUpdate: { type: Boolean, default: true },
      
      // Student notifications
      newSession: { type: Boolean, default: true },
      homeworkGraded: { type: Boolean, default: true },
      attendanceMarked: { type: Boolean, default: true },
      
      // Parent notifications
      childAttendance: { type: Boolean, default: true },
      childProgress: { type: Boolean, default: true },
      paymentReminder: { type: Boolean, default: true },
      
      // Common notifications
      systemUpdates: { type: Boolean, default: true },
      weeklyReport: { type: Boolean, default: false },
      promotions: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
  }
);

export const NotificationSetting = mongoose.model<INotificationSetting>(
  "NotificationSetting",
  notificationSettingSchema
);
