import express from "express";
import { getUserNotifications, markAsRead, markAllAsRead } from "../controllers/NotificationController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const notificationRouter = express.Router();

notificationRouter.get("/", authMiddleware, getUserNotifications);
notificationRouter.put("/read-all", authMiddleware, markAllAsRead);
notificationRouter.put("/:id/read", authMiddleware, markAsRead);

export default notificationRouter;
