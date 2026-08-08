import winston from "winston";

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: logFormat,
  defaultMeta: { service: "educenter-api" },
  transports: [
    new winston.transports.File({
      filename: "logs/security.log",
      level: "warn",
      maxsize: 5242880,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      maxsize: 5242880,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: "logs/combined.log",
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    })
  );
}

export const securityLogger = {
  authFailure: (message: string, meta?: Record<string, unknown>) => {
    logger.warn(message, { type: "AUTH_FAILURE", ...meta });
  },
  suspiciousActivity: (message: string, meta?: Record<string, unknown>) => {
    logger.warn(message, { type: "SUSPICIOUS_ACTIVITY", ...meta });
  },
  rateLimitExceeded: (message: string, meta?: Record<string, unknown>) => {
    logger.warn(message, { type: "RATE_LIMIT_EXCEEDED", ...meta });
  },
  xssAttempt: (message: string, meta?: Record<string, unknown>) => {
    logger.warn(message, { type: "XSS_ATTEMPT", ...meta });
  },
  csrfFailure: (message: string, meta?: Record<string, unknown>) => {
    logger.warn(message, { type: "CSRF_FAILURE", ...meta });
  },
  permissionDenied: (message: string, meta?: Record<string, unknown>) => {
    logger.warn(message, { type: "PERMISSION_DENIED", ...meta });
  },
};

export default logger;
