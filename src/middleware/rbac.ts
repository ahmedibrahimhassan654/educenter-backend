import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";

export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        message: "Forbidden: You don't have permission to access this resource",
      });
      return;
    }

    next();
  };
};