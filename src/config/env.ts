import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: process.env.PORT || 5000,
  mongodbUri: process.env.MONGODB_URI as string,
  supabaseUrl: process.env.SUPABASE_URL as string,
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY as string,
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  jwtSecret: process.env.JWT_SECRET as string,
  jwtExpiry: process.env.JWT_EXPIRY || "7d",
  groqApiKey: process.env.GROQ_API_KEY as string,
  groqBaseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
  groqChatModel: process.env.GROQ_CHAT_MODEL || "llama-3.3-70b-versatile",
  groqFastModel: process.env.GROQ_FAST_MODEL || "llama-3.1-8b-instant",
  groqWhisperModel: process.env.GROQ_WHISPER_MODEL || "whisper-large-v3",
  maxAiTokens: Number(process.env.MAX_AI_TOKENS || 4096),
  sessionRecordingsBucket: process.env.SESSION_RECORDINGS_BUCKET || "session-recordings",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
};

// Validate required environment variables
const requiredEnvVars = [
  "MONGODB_URI",
  "JWT_SECRET",
  "GROQ_API_KEY",
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Warning: Environment variable ${envVar} is not set`);
  }
}