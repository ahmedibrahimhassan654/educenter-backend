// One-time normalization script: convert short stage/grade names to canonical
// curriculum names (e.g. "ابتدائي" -> "المرحلة الابتدائية",
// "الأول الابتدائي" -> "الصف الأول الابتدائي").
// Run: npm run normalize:stages
import mongoose from "mongoose";
import "../config/env";

const ORDINALS = [
  "الأول",
  "الثاني",
  "الثالث",
  "الرابع",
  "الخامس",
  "السادس",
  "السابع",
  "الثامن",
  "التاسع",
  "العاشر",
];

const STAGE_MAP: Record<string, string> = {
  "ابتدائي": "المرحلة الابتدائية",
  "إعدادي": "المرحلة الإعدادية",
  "ثانوي": "المرحلة الثانوية",
  "الابتدائي": "المرحلة الابتدائية",
  "الإعدادي": "المرحلة الإعدادية",
  "الثانوي": "المرحلة الثانوية",
};

function normalizeStage(stage: string): string {
  const s = (stage || "").trim();
  if (!s || s.startsWith("المرحلة ")) return s;
  return STAGE_MAP[s] || s;
}

function normalizeGrade(grade: string): string {
  const g = (grade || "").trim();
  if (!g || g.startsWith("الصف ")) return g;

  const regex = new RegExp(
    `^(${ORDINALS.join("|")})\\s*(الابتدائي|الإعدادي|الثانوي)$`
  );
  const match = g.match(regex);
  if (match) {
    const stageWord = match[2];
    const type = stageWord === "الابتدائي" ? "الابتدائي" : stageWord === "الإعدادي" ? "الإعدادي" : "الثانوي";
    return `الصف ${match[1]} ${type}`;
  }
  return g;
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI as string, {
    serverSelectionTimeoutMS: 10000,
  });

  const db = mongoose.connection.db;
  if (!db) throw new Error("No DB connection");
  const users = db.collection("users");

  const all = await users.find({ role: "STUDENT" }).toArray();
  let updated = 0;
  let stageChanged = 0;
  let gradeChanged = 0;

  for (const user of all) {
    const patch: Record<string, unknown> = {};
    if (user.stage) {
      const ns = normalizeStage(String(user.stage));
      if (ns !== user.stage) {
        patch.stage = ns;
        stageChanged++;
      }
    }
    if (user.grade) {
      const ng = normalizeGrade(String(user.grade));
      if (ng !== user.grade) {
        patch.grade = ng;
        gradeChanged++;
      }
    }

    if (Array.isArray(user.academicHistory)) {
      const newHistory = user.academicHistory.map((entry: any) => {
        const e: any = { ...entry };
        if (e.stage) {
          const ns = normalizeStage(String(e.stage));
          if (ns !== e.stage) e.stage = ns;
        }
        if (e.grade) {
          const ng = normalizeGrade(String(e.grade));
          if (ng !== e.grade) e.grade = ng;
        }
        return e;
      });
      patch.academicHistory = newHistory;
    }

    if (Object.keys(patch).length > 0) {
      await users.updateOne({ _id: user._id }, { $set: patch });
      updated++;
    }
  }

  console.log(
    `Students scanned: ${all.length} | updated: ${updated} | stages changed: ${stageChanged} | grades changed: ${gradeChanged}`
  );

  await mongoose.disconnect();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });