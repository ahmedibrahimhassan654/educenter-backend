// Must be first: populates process.env before any module reads it at import time
import "./config/env";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import mongoSanitize from "express-mongo-sanitize";
import hpp from "hpp";
import connectDB from "./config/db";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import groupRoutes from "./routes/groups";
import teacherRoutes from "./routes/teachers";
import sessionRoutes from "./routes/sessions";
import attendanceRoutes from "./routes/attendance";
import curriculumRoutes from "./routes/curriculum";
import adminCurriculumRoutes from "./routes/adminCurriculum";
import emailRoutes from "./routes/emails";
import notificationRoutes from "./routes/notifications";
import verificationRoutes from "./routes/verification";
import aiRoutes from "./routes/ai";
import settingsRoutes from "./routes/settings";
import familyRoutes from "./routes/family";
import { cache } from "./services/cache";
import { auth } from "./middleware/auth";
import { requireRole } from "./middleware/rbac";
import { errorHandler } from "./middleware/errorHandler";
import { securityLogger } from "./utils/securityLogger";

const app = express();
const PORT = process.env.PORT || 5000;

// Disable ETags: a 304 Not Modified sends an empty body, which breaks
// clients that expect JSON on every request
app.set("etag", false);

// Trust the first hop so req.protocol reflects https behind Vercel/proxies.
app.set("trust proxy", 1);

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
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Accept"],
  })
);
app.use(
  helmet({
    contentSecurityPolicy: isDevelopment ? false : undefined,
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    noSniff: true,
    xssFilter: true,
  })
);
app.use(compression()); // Compress all responses
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Security: sanitize inputs against NoSQL injection and parameter pollution
app.use(mongoSanitize());
app.use(hpp());

// Database connection middleware (critical for serverless / cold starts)
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
});

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

// Cache stats (admin only)
app.get("/api/admin/cache-stats", auth, requireRole("ADMIN"), (req: any, res: any) => {
  res.json(cache.getStats());
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/teachers", teacherRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/curriculum", curriculumRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/family", familyRoutes);

// Admin routes
app.use("/api/admin/curriculum", adminCurriculumRoutes);
app.use("/api/admin/settings", settingsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/emails", emailRoutes);

// Verification routes
app.use("/api/verification", verificationRoutes);

// AI routes
app.use("/api/ai", aiRoutes);

// Error handler
app.use(errorHandler);

// Start server (only for local development)
if (!process.env.VERCEL) {
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
}

export default app;
