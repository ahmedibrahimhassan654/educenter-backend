import { Notification, NotificationSetting, INotification } from "../models/Notification";
import mongoose from "mongoose";

/**
 * Notification Service
 * Handles creating and managing notifications
 */

interface CreateNotificationParams {
  userId: string | mongoose.Types.ObjectId;
  title: string;
  message: string;
  type?: "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "SYSTEM";
  category?: "GENERAL" | "USER" | "PAYMENT" | "GROUP" | "SESSION" | "ATTENDANCE" | "SYSTEM";
  link?: string;
  metadata?: Record<string, any>;
}

/**
 * Create a new notification for a user
 */
export const createNotification = async (
  params: CreateNotificationParams
): Promise<INotification | null> => {
  try {
    // Check user's notification settings
    const settings = await NotificationSetting.findOne({ userId: params.userId });
    
    if (settings) {
      // Check if the specific notification type is enabled
      const shouldSend = checkNotificationSetting(settings.settings, params.category, params.type);
      if (!shouldSend) {
        console.log(`Notification skipped for user ${params.userId} - setting disabled`);
        return null;
      }
    }

    const notification = await Notification.create({
      userId: params.userId,
      title: params.title,
      message: params.message,
      type: params.type || "INFO",
      category: params.category || "GENERAL",
      link: params.link,
      metadata: params.metadata || {},
    });

    return notification;
  } catch (error) {
    console.error("Error creating notification:", error);
    return null;
  }
};

/**
 * Create notifications for multiple users
 */
export const createBulkNotifications = async (
  userIds: (string | mongoose.Types.ObjectId)[],
  params: Omit<CreateNotificationParams, "userId">
): Promise<number> => {
  try {
    const notifications = userIds.map((userId) => ({
      userId,
      title: params.title,
      message: params.message,
      type: params.type || "INFO",
      category: params.category || "GENERAL",
      link: params.link,
      metadata: params.metadata || {},
    }));

    const result = await Notification.insertMany(notifications);
    return result.length;
  } catch (error) {
    console.error("Error creating bulk notifications:", error);
    return 0;
  }
};

/**
 * Check if a notification should be sent based on user settings
 */
const checkNotificationSetting = (
  settings: Record<string, boolean>,
  category?: string,
  type?: string
): boolean => {
  // System notifications are always sent
  if (type === "SYSTEM") return true;
  
  switch (category) {
    case "USER":
      return settings.newStudent ?? true;
    case "PAYMENT":
      return settings.studentPayment ?? true;
    case "SESSION":
      return settings.sessionReminder ?? true;
    case "GROUP":
      return settings.groupUpdate ?? true;
    case "ATTENDANCE":
      return settings.attendanceMarked ?? true;
    case "SYSTEM":
      return settings.systemUpdates ?? true;
    default:
      return true;
  }
};

/**
 * Get notifications for a user
 */
export const getUserNotifications = async (
  userId: string | mongoose.Types.ObjectId,
  options: {
    page?: number;
    limit?: number;
    unreadOnly?: boolean;
  } = {}
) => {
  const { page = 1, limit = 20, unreadOnly = false } = options;
  
  const query: any = { userId };
  if (unreadOnly) query.isRead = false;

  const skip = (page - 1) * limit;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments(query),
    Notification.countDocuments({ userId, isRead: false }),
  ]);

  return {
    notifications,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
    unreadCount,
  };
};

/**
 * Mark notification as read
 */
export const markAsRead = async (
  notificationId: string | mongoose.Types.ObjectId,
  userId: string | mongoose.Types.ObjectId
): Promise<boolean> => {
  try {
    const result = await Notification.findOneAndUpdate(
      { _id: notificationId, userId },
      { isRead: true }
    );
    return !!result;
  } catch (error) {
    console.error("Error marking notification as read:", error);
    return false;
  }
};

/**
 * Mark all notifications as read for a user
 */
export const markAllAsRead = async (
  userId: string | mongoose.Types.ObjectId
): Promise<number> => {
  try {
    const result = await Notification.updateMany(
      { userId, isRead: false },
      { isRead: true }
    );
    return result.modifiedCount;
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    return 0;
  }
};

/**
 * Delete a notification
 */
export const deleteNotification = async (
  notificationId: string | mongoose.Types.ObjectId,
  userId: string | mongoose.Types.ObjectId
): Promise<boolean> => {
  try {
    const result = await Notification.findOneAndDelete({
      _id: notificationId,
      userId,
    });
    return !!result;
  } catch (error) {
    console.error("Error deleting notification:", error);
    return false;
  }
};

/**
 * Delete all notifications for a user
 */
export const deleteAllNotifications = async (
  userId: string | mongoose.Types.ObjectId
): Promise<number> => {
  try {
    const result = await Notification.deleteMany({ userId });
    return result.deletedCount;
  } catch (error) {
    console.error("Error deleting all notifications:", error);
    return 0;
  }
};

/**
 * Get or create notification settings for a user
 */
export const getNotificationSettings = async (
  userId: string | mongoose.Types.ObjectId
) => {
  let settings = await NotificationSetting.findOne({ userId });
  
  if (!settings) {
    settings = await NotificationSetting.create({ userId });
  }
  
  return settings;
};

/**
 * Update notification settings for a user
 */
export const updateNotificationSettings = async (
  userId: string | mongoose.Types.ObjectId,
  settings: Record<string, boolean>
) => {
  const result = await NotificationSetting.findOneAndUpdate(
    { userId },
    { settings },
    { upsert: true, new: true }
  );
  
  return result;
};
