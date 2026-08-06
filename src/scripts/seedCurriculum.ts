import dotenv from "dotenv";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { EducationalStage } from "../models/EducationalStage";
import connectDB from "../config/db";

dotenv.config();

interface TermData {
  name: string;
  code?: string;
  topics?: string[];
}

interface SubjectData {
  name: string;
  nameEn?: string;
  code?: string;
  terms: TermData[];
}

interface GradeData {
  name: string;
  nameEn?: string;
  level: number;
  subjects: SubjectData[];
}

interface StageData {
  name: string;
  nameEn?: string;
  key: "PRIMARY" | "PREPARATORY" | "SECONDARY";
  grades: GradeData[];
}

interface SeedData {
  stages: StageData[];
}

const seedCurriculum = async () => {
  try {
    await connectDB();
    console.log("=".repeat(60));
    console.log("Seeding Egyptian Curriculum Data");
    console.log("=".repeat(60));

    // Read seed data - go up two levels from src/scripts to reach seeds folder
    const seedFilePath = path.join(__dirname, "../../seeds/egyptianCurriculumData.json");
    
    if (!fs.existsSync(seedFilePath)) {
      console.error("❌ Seed file not found:", seedFilePath);
      process.exit(1);
    }

    const rawData = fs.readFileSync(seedFilePath, "utf-8");
    const seedData: SeedData = JSON.parse(rawData);

    console.log(`\n📚 Found ${seedData.stages.length} educational stages\n`);

    // Clear existing data
    console.log("🗑️  Clearing existing curriculum data...");
    await EducationalStage.deleteMany({});
    console.log("✅ Existing data cleared\n");

    // Insert new data
    let totalGrades = 0;
    let totalSubjects = 0;
    let totalTerms = 0;

    for (const stageData of seedData.stages) {
      console.log(`\n📌 Stage: ${stageData.name} (${stageData.nameEn})`);
      console.log(`   Key: ${stageData.key}`);
      console.log(`   Grades: ${stageData.grades.length}`);

      // Count stats
      for (const grade of stageData.grades) {
        totalGrades++;
        for (const subject of grade.subjects) {
          totalSubjects++;
          totalTerms += subject.terms.length;
        }
      }

      // Create stage document
      const stage = await EducationalStage.create({
        name: stageData.name,
        nameEn: stageData.nameEn,
        key: stageData.key,
        grades: stageData.grades.map(grade => ({
          name: grade.name,
          nameEn: grade.nameEn,
          level: grade.level,
          subjects: grade.subjects.map(subject => ({
            name: subject.name,
            nameEn: subject.nameEn,
            code: subject.code,
            terms: subject.terms.map(term => ({
              name: term.name,
              code: term.code,
              topics: term.topics || [],
            })),
          })),
        })),
      });

      console.log(`   ✅ Created with ID: ${stage._id}`);

      // Print grade details
      for (const grade of stageData.grades) {
        console.log(`      📖 ${grade.name} (${grade.nameEn}) - Level ${grade.level}`);
        console.log(`         Subjects: ${grade.subjects.length}`);
      }
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 Seed Summary:");
    console.log("=".repeat(60));
    console.log(`   Stages:  ${seedData.stages.length}`);
    console.log(`   Grades:  ${totalGrades}`);
    console.log(`   Subjects: ${totalSubjects}`);
    console.log(`   Terms:   ${totalTerms}`);
    console.log("=".repeat(60));
    console.log("\n✅ Egyptian curriculum seed completed successfully!\n");

    // Verify data
    console.log("🔍 Verifying data...");
    const stages = await EducationalStage.find();
    console.log(`   Found ${stages.length} stages in database`);
    
    for (const stage of stages) {
      console.log(`   - ${stage.name} (${stage.key}): ${stage.grades.length} grades`);
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding curriculum:", error);
    process.exit(1);
  }
};

seedCurriculum();
