import dotenv from "dotenv";
import mongoose from "mongoose";
import { User, IUser } from "./models/User";
import connectDB from "./config/db";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

interface SupabaseUser {
  email: string;
  password: string;
  name: string;
  phone: string;
  role: string;
}

const testUsers: SupabaseUser[] = [
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

async function getSupabaseUserId(email: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return null;

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
      headers: {
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        apikey: SUPABASE_SECRET_KEY,
      },
    });

    if (response.ok) {
      const data = await response.json() as { users: { id: string }[] };
      if (data.users && data.users.length > 0) {
        return data.users[0].id;
      }
    }
  } catch (error) {
    // User doesn't exist
  }
  return null;
}

async function createSupabaseUser(user: SupabaseUser): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.log("  ⚠ Supabase credentials not provided.");
    return null;
  }

  try {
    // First check if user already exists
    const existingId = await getSupabaseUserId(user.email);
    if (existingId) {
      console.log("  ✓ User already exists in Supabase Auth");
      return existingId;
    }

    // Create new user
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        apikey: SUPABASE_SECRET_KEY,
      },
      body: JSON.stringify({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: {
          name: user.name,
          phone: user.phone,
          role: user.role,
        },
      }),
    });

    if (response.ok) {
      const data = await response.json() as { id: string };
      console.log("  ✓ User created in Supabase Auth");
      return data.id;
    } else {
      const error = await response.json() as { msg?: string; message?: string };
      console.log("  ⚠ Error:", error.msg || error.message || "Unknown error");
      return null;
    }
  } catch (error) {
    console.log("  ⚠ Connection error:", error);
    return null;
  }
}

const seedUsers = async () => {
  try {
    await connectDB();
    console.log("Connected to MongoDB...\n");

    console.log("=".repeat(60));
    console.log("Seeding Users for EduCenter");
    console.log("=".repeat(60));
    console.log("Password for all users: admin123!");
    console.log("=".repeat(60) + "\n");

    for (const userData of testUsers) {
      console.log(`\nProcessing: ${userData.email} (${userData.role})`);
      console.log("-".repeat(40));

      // Create/verify Supabase Auth user
      console.log("  Checking Supabase Auth...");
      const supabaseId = await createSupabaseUser(userData);

      // Check if user exists in MongoDB
      const existingUser = await User.findOne({ email: userData.email });
      
      if (existingUser) {
        console.log("  ✓ User exists in MongoDB");
        // Only update supabaseId if it's a placeholder (starts with 'seed-' or 'admin-seed-')
        if (supabaseId && (existingUser.supabaseId.startsWith('seed-') || existingUser.supabaseId.startsWith('admin-seed-') || existingUser.supabaseId.startsWith('teacher-seed-') || existingUser.supabaseId.startsWith('student-seed-') || existingUser.supabaseId.startsWith('parent-seed-'))) {
          try {
            existingUser.supabaseId = supabaseId;
            await existingUser.save();
            console.log("  ✓ Updated supabaseId in MongoDB");
          } catch (err) {
            console.log("  ⚠ Could not update supabaseId (may already exist)");
          }
        }
      } else {
        // Create MongoDB user
        await User.create({
          supabaseId: supabaseId || `seed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: userData.name,
          email: userData.email,
          phone: userData.phone,
          role: userData.role as IUser["role"],
          subscriptionStatus: true,
        });
        console.log("  ✓ User created in MongoDB");
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
