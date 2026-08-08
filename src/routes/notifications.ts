import { Router, Response } from "express";
import { auth, AuthRequest } from "../middleware/auth";
import {
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  getNotificationSettings,
  updateNotificationSettings,
} from "../services/notificationService";
import { cache } from "../services/cache";

const router = Router();

// All notification routes require authentication
router.use(auth);

/**
 * GET /api/notifications
 * Get notifications for the authenticated user
 */
router.get("/", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { page = "1", limit = "20", unreadOnly = "false" } = req.query;

    const cacheKey = `notifications:${userId}:${page}:${limit}:${unreadOnly}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const result = await getUserNotifications(userId, {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      unreadOnly: unreadOnly === "true",
    });

    const response = {
      success: true,
      data: result.notifications,
      pagination: result.pagination,
      unreadCount: result.unreadCount,
    };
    cache.set(cacheKey, response, 15); // Short TTL for notifications
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching notifications", error: error.message });
  }
});

/**
 * GET /api/notifications/unread-count
 * Get unread notification count
 */
router.get("/unread-count", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;
    const cacheKey = `notifications:unread:${userId}`;
    const cached = cache.get(cacheKey);
    if (cached) { res.json(cached); return; }
    const result = await getUserNotifications(userId, { limit: 1 });
    
    const response = {
      success: true,
      unreadCount: result.unreadCount,
    };
    cache.set(cacheKey, response, 15);
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching unread count", error: error.message });
  }
});

/**
 * PUT /api/notifications/:id/read
 * Mark a notification as read
 */
router.put("/:id/read", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;
    const success = await markAsRead(req.params.id, userId);

    if (!success) {
      res.status(404).json({ message: "Notification not found" });
      return;
    }

    cache.deleteByPattern(`notifications:${userId}:*`);
      res.json({ success: true, message: "Notification marked as read" });
  } catch (error: any) {
    res.status(500).json({ message: "Error marking notification as read", error: error.message });
  }
});

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read
 */
router.put("/read-all", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;
    const count = await markAllAsRead(userId);

    res.json({
      success: true,
      message: `${count} notifications marked as read`,
    });
  } catch (error: any) {
    res.status(500).json({ message: "Error marking all notifications as read", error: error.message });
  }
});

/**
 * DELETE /api/notifications/:id
 * Delete a notification
 */
router.delete("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;
    const success = await deleteNotification(req.params.id, userId);

    if (!success) {
      res.status(404).json({ message: "Notification not found" });
      return;
    }

    cache.deleteByPattern(`notifications:${userId}:*`);
      res.json({ success: true, message: "Notification deleted" });
  } catch (error: any) {
    res.status(500).json({ message: "Error deleting notification", error: error.message });
  }
});

/**
 * DELETE /api/notifications
 * Delete all notifications
 */
router.delete("/", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;
    const count = await deleteAllNotifications(userId);

    res.json({
      success: true,
      message: `${count} notifications deleted`,
    });
  } catch (error: any) {
    res.status(500).json({ message: "Error deleting all notifications", error: error.message });
  }
});

/**
 * GET /api/notifications/settings
 * Get notification settings
 */
router.get("/settings", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;
    const settings = await getNotificationSettings(userId);

    res.json({
      success: true,
      data: settings.settings,
    });
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching notification settings", error: error.message });
  }
});

/**
 * PUT /api/notifications/settings
 * Update notification settings
 */
router.put("/settings", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id;
    const settings = await updateNotificationSettings(userId, req.body);

    res.json({
      success: true,
      data: settings.settings,
    });
  } catch (error: any) {
    res.status(500).json({ message: "Error updating notification settings", error: error.message });
  }
});

export default router;
