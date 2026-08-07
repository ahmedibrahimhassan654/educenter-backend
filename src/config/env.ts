import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: process.env.PORT || 5000,
  mongodbUri: process.env.MONGODB_URI as string,
  supabaseUrl: process.env.SUPABASE_URL as string,
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY as string,
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY as string,
  supabaseJwksUrl: process.env.SUPABASE_JWKS_URL as string,
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
};

// Validate required environment variables
const requiredEnvVars = [
  "MONGODB_URI",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_JWKS_URL",
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Warning: Environment variable ${envVar} is not set`);
  }
}