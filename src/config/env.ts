import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: process.env.PORT || 5000,
  mongodbUri: process.env.MONGODB_URI as string,
  supabaseUrl: process.env.SUPABASE_URL as string,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY as string,
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET as string,
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
};

// Validate required environment variables
const requiredEnvVars = [
  "MONGODB_URI",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_JWT_SECRET",
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Warning: Environment variable ${envVar} is not set`);
  }
}