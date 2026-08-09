import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { User, IUser } from "./models/User";
import connectDB from "./config/db";

dotenv.config();

interface TestUser {
  email: string;
  password: string;
  name: string;
  phone: string;
  role: "TEACHER" | "STUDENT" | "PARENT" | "ADMIN";
}

const testUsers: TestUser[] = [
  {
    email: "ahmedibrahimhassan654@gmail.com",
    password: "admin123!",
    name: "أحمد إبراهيم حسن",
    phone: "+201000000001",
    role: "ADMIN",
  },
  {
    email: "teacher@test.com",
    password: "admin123!",
    name: "محمد الأحمد",
    phone: "+201000000002",
    role: "TEACHER",
  },
  {
    email: "student@test.com",
    password: "admin123!",
    name: "أحمد محمد",
    phone: "+201000000003",
    role: "STUDENT",
  },
  {
    email: "parent@test.com",
    password: "admin123!",
    name: "أم عبدالله",
    phone: "+201000000004",
    role: "PARENT",
  },
];

const BCRYPT_ROUNDS = 12;

const seedUsers = async () => {
  try {
    await connectDB();
    console.log("Connected to MongoDB...\n");

    // Delete all existing users first
    console.log("Deleting existing users...");
    await User.deleteMany({});
    console.log("  ✓ All existing users deleted\n");

    console.log("=".repeat(60));
    console.log("Seeding Users for EduCenter");
    console.log("=".repeat(60));
    console.log("Password for all users: admin123!");
    console.log("=".repeat(60) + "\n");

    for (const userData of testUsers) {
      console.log(`\nProcessing: ${userData.email} (${userData.role})`);
      console.log("-".repeat(40));

      // Check if user exists in MongoDB
      const existingUser = await User.findOne({ email: userData.email });

      if (existingUser) {
        console.log("  ✓ User exists in MongoDB");
      } else {
        // Create MongoDB user with password hash
        const passwordHash = await bcrypt.hash(userData.password, BCRYPT_ROUNDS);
        
        await User.create({
          name: userData.name,
          email: userData.email,
          phone: userData.phone,
          passwordHash,
          role: userData.role,
        });
        console.log("  ✓ User created in MongoDB with password hash");
      }
    }

    // Create parent-student relationship
    const parent = await User.findOne({ email: "parent@test.com" });
    const student = await User.findOne({ email: "student@test.com" });

    if (parent && student) {
      if (!parent.students.includes(student._id)) {
        parent.students.push(student._id);
        await parent.save();
        student.parentId = parent._id;
        await student.save();
        console.log("\n✓ Linked student to parent");
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("Seed completed!");
    console.log("=".repeat(60));
    console.log("\nTest Accounts:");
    console.log("-".repeat(60));
    testUsers.forEach((user, index) => {
      console.log(`${index + 1}. ${user.role}:`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Password: ${user.password}`);
      console.log("");
    });
    console.log("-".repeat(60));
    console.log("\nYou can now login with these accounts!\n");

    process.exit(0);
  } catch (error) {
    console.error("Error seeding users:", error);
    process.exit(1);
  }
};

seedUsers();