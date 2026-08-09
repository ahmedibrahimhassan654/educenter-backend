import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { config } from "../config/env";
import { User, IUser } from "../models/User";

export interface AuthRequest extends Request {
  user?: IUser;
  claims?: JwtPayload;
}

if (!config.jwtSecret) {
  throw new Error("Auth misconfigured: JWT_SECRET is required");
}

function verifyToken(token: string): Promise<JwtPayload> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      config.jwtSecret,
      {
        algorithms: ["HS256"],
      },
      (err, decoded) => {
        if (err) {
          console.error('🔐 JWT verify error:', err.name, err.message);
          return reject(err);
        }
        if (!decoded || typeof decoded === "string") {
          return reject(new Error("Unexpected token payload"));
        }
        console.log('🔐 Token decoded, sub:', (decoded as JwtPayload).sub);
        resolve(decoded as JwtPayload);
      }
    );
  });
}

export const auth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  console.log('🔐 Auth middleware hit:', req.method, req.originalUrl);
  try {
    // Check Authorization header first
    const authHeader = req.headers.authorization;
    
    // Also check cookie
    const cookieToken = req.cookies?.educenter_token;
    
    const token = authHeader?.startsWith("Bearer ") 
      ? authHeader.split(" ")[1] 
      : cookieToken;

    if (!token) {
      console.log('🔐 No token found in header or cookie');
      res.status(401).json({ message: "No token provided" });
      return;
    }

    console.log('🔐 Token source:', authHeader ? 'header' : 'cookie');

    let decoded: JwtPayload;
    try {
      decoded = await verifyToken(token);
    } catch (error: any) {
      if (error?.name === "TokenExpiredError") {
        console.error("JWT verification failed: token expired");
        res.status(401).json({ message: "Token expired" });
        return;
      }
      console.error("JWT verification failed:", error?.name || error?.message || error);
      res.status(401).json({ message: "Invalid token" });
      return;
    }

    if (!decoded.sub) {
      console.error("JWT verification failed: token missing sub claim", decoded);
      res.status(401).json({ message: "Invalid token" });
      return;
    }

    req.claims = decoded;

    const user = await User.findById(decoded.sub).select(
      "-verificationData.documents -passwordHash"
    );

    if (!user) {
      console.warn("Authenticated token validated, but no MongoDB user found", {
        userId: decoded.sub,
      });
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