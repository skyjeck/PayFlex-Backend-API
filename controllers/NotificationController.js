import Notification from "../models/NotificationModel.js";

// Helper to create notifications internally from other controllers
export const createNotification = async (userId, title, message, type = "INFO", data = {}) => {
  try {
    const notification = await Notification.create({ userId, title, message, type, data });
    return notification;
  } catch (error) {
    console.error("Error creating notification:", error);
    return null;
  }
};

// GET /api/notifications
export const getUserNotifications = async (req, res) => {
  try {
    const userId = req.userId;
    const { page = 1, limit = 20, unreadOnly } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));

    const query = { userId };
    if (unreadOnly === 'true') {
      query.isRead = false;
    }

    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Notification.countDocuments(query)
    ]);

    const unreadCount = await Notification.countDocuments({ userId, isRead: false });

    return res.status(200).json({
      success: true,
      message: "Notifications retrieved successfully",
      data: {
        notifications,
        unreadCount,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return res.status(500).json({ success: false, message: "Error fetching notifications." });
  }
};

// PUT /api/notifications/:id/read
export const markAsRead = async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found." });
    }

    return res.status(200).json({ success: true, message: "Notification marked as read.", data: notification });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    return res.status(500).json({ success: false, message: "Error marking notification as read." });
  }
};

// PUT /api/notifications/read-all
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.userId;

    await Notification.updateMany(
      { userId, isRead: false },
      { isRead: true }
    );

    return res.status(200).json({ success: true, message: "All notifications marked as read." });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    return res.status(500).json({ success: false, message: "Error marking notifications as read." });
  }
};
