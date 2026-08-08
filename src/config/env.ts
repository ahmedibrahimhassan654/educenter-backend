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
  groqApiKey: process.env.GROQ_API_KEY as string,
  groqBaseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
  groqChatModel: process.env.GROQ_CHAT_MODEL || "llama-3.3-70b-versatile",
  groqFastModel: process.env.GROQ_FAST_MODEL || "llama-3.1-8b-instant",
  groqWhisperModel: process.env.GROQ_WHISPER_MODEL || "whisper-large-v3",
  maxAiTokens: Number(process.env.MAX_AI_TOKENS || 4096),
  sessionRecordingsBucket: process.env.SESSION_RECORDINGS_BUCKET || "session-recordings",
};

// Validate required environment variables
const requiredEnvVars = [
  "MONGODB_URI",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_JWKS_URL",
  "GROQ_API_KEY",
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Warning: Environment variable ${envVar} is not set`);
  }
}