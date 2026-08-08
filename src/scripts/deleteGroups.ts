import "../config/env";
import mongoose from "mongoose";
import { Group } from "../models/Group";

const deleteAllGroups = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log("Connected to MongoDB");

    const result = await Group.deleteMany({});
    console.log(`Deleted ${result.deletedCount} groups`);

    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
    process.exit(0);
  } catch (error) {
    console.error("Error deleting groups:", error);
    process.exit(1);
  }
};

deleteAllGroups();
