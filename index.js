import express from "express";
import http from "http";
import { Server } from "socket.io";
import bodyParser from "body-parser";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import morgan from 'morgan';
import { connectDB } from "./config/dbcon.js";
import { UserRouter } from "./routes/UserRoute.js";
import adminRouter from "./routes/AdminRoute.js";
import walletRouter from "./routes/WalletRoute.js";
import transferRouter from "./routes/TransferRoute.js";
import serviceRouter from "./routes/ServiceRoute.js";
import FxSwapRouter from "./routes/FxSwapRoute.js";
import { initFxRateBroadcaster } from "./controllers/FxSocketsService.js";
import webhookRouter from "./routes/WebHookRoute.js";
import historyRouter from "./routes/HistoryRoute.js";
import notificationRouter from "./routes/NotificationRoute.js";

const app = express();
app.use(morgan('dev'));
const PORT = process.env.PORT || 3000;

// 1. Create HTTP Server for Express & Socket.io
const server = http.createServer(app);

// 2. Initialize Socket.io Server
const io = new Server(server, {
  cors: {
    origin: "*", // Adjust CORS origins for production as needed
    methods: ["GET", "POST"],
  },
});

// 3. Register io instance with Express & Start Broadcaster
app.set("io", io);
initFxRateBroadcaster(io);

// 4. Handle Socket Connections
io.on("connection", (socket) => {
  console.log("⚡ Client connected to Socket.io:", socket.id);

  // Users can join their private room using their userId
  socket.on("join", (userId) => {
    if (userId) {
      socket.join(userId);
      console.log(`👤 User ${userId} joined room`);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
  });
});

// Database connection & Standard Middlewares
connectDB();
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.get("/", (req, res) => {
  res.send("Welcome to the PayFlex API!");
});

// API Endpoints
app.use("/api/users", UserRouter);
app.use("/api/admin", adminRouter);
app.use("/api/wallet", walletRouter);
app.use("/api/transfers", transferRouter);
app.use("/api/services", serviceRouter);
app.use("/api/swap-fx", FxSwapRouter);
app.use("/api/webhooks", webhookRouter);
app.use("/api/history", historyRouter);
app.use("/api/notifications", notificationRouter);

// 5. IMPORTANT: Listen using `server.listen`, NOT `app.listen`
server.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});