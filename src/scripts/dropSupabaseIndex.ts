import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

async function dropIndex() {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI!);
    const db = conn.connection.db;
    if (db) {
      await db.collection("users").dropIndex("supabaseId_1").catch(() => {});
      console.log("Index dropped");
    } else {
      console.log("Database connection not established");
    }
    await conn.disconnect();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

dropIndex();