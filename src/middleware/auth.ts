import { Request, Response, NextFunction } from "express";
import jwt, { GetPublicKeyOrSecret } from "jsonwebtoken";
import { JwksClient } from "jwks-rsa";
import { config } from "../config/env";
import { User, IUser } from "../models/User";

export interface AuthRequest extends Request {
  user?: IUser;
  claims?: jwt.JwtPayload;
}

const SUPABASE_URL = config.supabaseUrl;
const JWKS_URL =
  config.supabaseJwksUrl ||
  (SUPABASE_URL ? `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` : undefined);

// Legacy HS256 projects sign with a shared secret instead of JWKS
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

if (!JWKS_URL && !JWT_SECRET) {
  throw new Error(
    "Auth misconfigured: set SUPABASE_JWKS_URL (or SUPABASE_URL) for asymmetric tokens, or SUPABASE_JWT_SECRET for legacy HS256 tokens"
  );
}

const jwksClient = JWKS_URL
  ? new JwksClient({
      jwksUri: JWKS_URL,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 10 * 60 * 1000, // 10 minutes
      rateLimit: true,
      jwksRequestsPerMinute: 10,
      timeout: 10000,
    })
  : null;

// Resolve the signing key from the token header's `kid`
const getKey: GetPublicKeyOrSecret = (header, callback) => {
  // Symmetric algorithms use the shared secret, never the JWKS
  if (header.alg?.startsWith("HS")) {
    if (!JWT_SECRET) {
      return callback(new Error("HS256 token received but SUPABASE_JWT_SECRET is not set"));
    }
    return callback(null, JWT_SECRET);
  }

  if (!jwksClient) {
    return callback(new Error("Asymmetric token received but no JWKS URL is configured"));
  }

  if (!header.kid) {
    return callback(new Error("Token header is missing 'kid'"));
  }

  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key?.getPublicKey());
  });
};

const allowedAlgorithms: jwt.Algorithm[] = JWT_SECRET
  ? ["HS256"]
  : ["ES256", "RS256"];

function verifyToken(token: string): Promise<jwt.JwtPayload> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        algorithms: allowedAlgorithms,
        audience: "authenticated",
        issuer: SUPABASE_URL ? `${SUPABASE_URL}/auth/v1` : undefined,
      },
      (err, decoded) => {
        if (err) return reject(err);
        if (!decoded || typeof decoded === "string") {
          return reject(new Error("Unexpected token payload"));
        }
        resolve(decoded);
      }
    );
  });
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

    // Verify the signature, expiry, audience and issuer before trusting anything
    let decoded: jwt.JwtPayload;
    try {
      decoded = await verifyToken(token);
    } catch (error: any) {
      if (error?.name === "TokenExpiredError") {
        res.status(401).json({ message: "Token expired" });
        return;
      }
      console.error("JWT verification failed:", error?.message || error);
      res.status(401).json({ message: "Invalid token" });
      return;
    }

    if (!decoded.sub) {
      res.status(401).json({ message: "Invalid token" });
      return;
    }

    req.claims = decoded;

    // Find user by supabaseId.
    // verificationData.documents holds base64 data URIs (hundreds of KB each)
    // and this runs on every authenticated request, so never load them here.
    // Routes that need the documents query for them explicitly.
    const user = await User.findOne({ supabaseId: decoded.sub }).select(
      "-verificationData.documents"
    );

    if (!user) {
      // Link an existing account created before Supabase signup
      if (decoded.email) {
        const userByEmail = await User.findOne({
          email: decoded.email,
        }).select("-verificationData.documents");
        if (userByEmail) {
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
