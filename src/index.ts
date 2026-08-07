// Must be first: populates process.env before any module reads it at import time
import "./config/env";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import connectDB from "./config/db";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import groupRoutes from "./routes/groups";
import sessionRoutes from "./routes/sessions";
import attendanceRoutes from "./routes/attendance";
import curriculumRoutes from "./routes/curriculum";
import adminCurriculumRoutes from "./routes/adminCurriculum";
import emailRoutes from "./routes/emails";
import notificationRoutes from "./routes/notifications";
import verificationRoutes from "./routes/verification";
import { errorHandler } from "./middleware/errorHandler";

const app = express();
const PORT = process.env.PORT || 5000;

// Disable ETags: a 304 Not Modified sends an empty body, which breaks
// clients that expect JSON on every request
app.set("etag", false);

// Allowed origins: configured frontend URL, plus any localhost port in development
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const isDevelopment = process.env.NODE_ENV !== "production";
const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// Middleware
app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients (curl, server-to-server) with no Origin header
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (isDevelopment && localhostPattern.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
  })
);
app.use(helmet());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const status = res.statusCode;
    const statusText = status >= 400 ? "FAILED" : "SUCCESS";
    const timestamp = new Date().toISOString();

    console.log(
      `[${timestamp}] ${req.method} ${req.originalUrl} | Controller: ${req.baseUrl || "N/A"} | Status: ${status} | ${statusText} | ${duration}ms`
    );
  });

  next();
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/curriculum", curriculumRoutes);
app.use("/api/notifications", notificationRoutes);

// Admin routes
app.use("/api/admin/curriculum", adminCurriculumRoutes);
app.use("/api/emails", emailRoutes);

// Verification routes
app.use("/api/verification", verificationRoutes);

// Error handler
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();