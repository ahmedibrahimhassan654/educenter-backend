import "../config/env";
import mongoose from "mongoose";
import { Settings } from "../models/Settings";

const seedSettings = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log("Connected to MongoDB");

    const existing = await Settings.findOne();
    if (existing) {
      console.log("Settings already exist:", existing);
    } else {
      const settings = await Settings.create({
        defaultPricePerLecture: 50,
        maxStudentsPerGroup: 20,
        platformFeePercentage: 15,
      });
      console.log("Created default settings:", settings);
    }

    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
    process.exit(0);
  } catch (error) {
    console.error("Error seeding settings:", error);
    process.exit(1);
  }
};

seedSettings();
