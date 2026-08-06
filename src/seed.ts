import dotenv from "dotenv";
import mongoose from "mongoose";
import { User } from "./models/User";
import connectDB from "./config/db";

dotenv.config();

const seedAdmin = async () => {
  try {
    await connectDB();

    const adminEmail = "ahmedibrahimhassan654@gmail.com";

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: adminEmail });
    if (existingAdmin) {
      console.log("Admin user already exists");
      console.log("Email:", adminEmail);
      console.log("Role:", existingAdmin.role);
      process.exit(0);
    }

    // Create admin user
    // Note: The actual auth is handled by Supabase, this creates the MongoDB profile
    const admin = await User.create({
      supabaseId: "admin-" + Date.now(), // This should be replaced with actual Supabase ID after signup
      name: "Ahmed Ibrahim Hassan",
      email: adminEmail,
      phone: "+201000000000",
      role: "ADMIN",
      subscriptionStatus: true,
    });

    console.log("Admin user created successfully!");
    console.log("Email:", adminEmail);
    console.log("Role:", admin.role);
    console.log("\nIMPORTANT: You need to:");
    console.log("1. Sign up with this email in Supabase Auth");
    console.log("2. Update the supabaseId in MongoDB with the actual Supabase user ID");

    process.exit(0);
  } catch (error) {
    console.error("Error seeding admin:", error);
    process.exit(1);
  }
};

seedAdmin();