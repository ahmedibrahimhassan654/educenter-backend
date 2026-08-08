import mongoose from "mongoose";

const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI as string, {
      maxPoolSize: 50,
      minPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    console.log(`Connection pool size: 50`);
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
};

export default connectDB;