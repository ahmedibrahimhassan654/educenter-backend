import { Request, Response, NextFunction } from "express";

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.error("Error:", err.message);

  if (err.name === "ValidationError") {
    res.status(400).json({ message: "Validation Error", error: err.message });
    return;
  }

  if (err.name === "CastError") {
    res.status(400).json({ message: "Invalid ID format" });
    return;
  }

  if (err.name === "MongoServerError" && (err as any).code === 11000) {
    res.status(409).json({ message: "Duplicate key error" });
    return;
  }

  res.status(500).json({
    message: "Internal Server Error",
    error:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Something went wrong",
  });
};