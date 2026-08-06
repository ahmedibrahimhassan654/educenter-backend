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

    // Decode the JWT token without verification first to get the sub
    const decoded = jwt.decode(token) as jwt.JwtPayload;

    if (!decoded || !decoded.sub) {
      res.status(401).json({ message: "Invalid token" });
      return;
    }

    // Find user by supabaseId
    const user = await User.findOne({ supabaseId: decoded.sub });

    if (!user) {
      // Try to find by email if supabaseId doesn't match
      if (decoded.email) {
        const userByEmail = await User.findOne({ email: decoded.email });
        if (userByEmail) {
          // Update the supabaseId
          userByEmail.supabaseId = decoded.sub;
          await userByEmail.save();
          req.user = userByEmail;
          next();
          return;
        }
      }
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