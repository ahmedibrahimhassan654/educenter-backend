import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User, IUser } from "../models/User";

export interface AuthRequest extends Request {
  user?: IUser;
}

export const auth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ message: "No token provided" });
      return;
    }

    const token = authHeader.split(" ")[1];

    // Verify Supabase JWT token
    const decoded = jwt.verify(
      token,
      process.env.SUPABASE_JWT_SECRET as string
    ) as jwt.JwtPayload;

    if (!decoded || !decoded.sub) {
      res.status(401).json({ message: "Invalid token" });
      return;
    }

    // Find user by supabaseId
    const user = await User.findOne({ supabaseId: decoded.sub });

    if (!user) {
      res.status(401).json({ message: "User not found" });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(401).json({ message: "Invalid or expired token" });
  }
};