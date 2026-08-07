/**
 * Migrate teacher verification documents from base64 data URIs stored in
 * MongoDB to Supabase Storage, replacing each with a public URL.
 *
 * Background: the upload UI silently fell back to base64 whenever the
 * "documents" bucket was missing, so records accumulated hundreds of KB each.
 *
 * Usage:
 *   npx tsx src/scripts/migrateVerificationDocs.ts --dry-run
 *   npx tsx src/scripts/migrateVerificationDocs.ts
 */
import "../config/env";
import mongoose from "mongoose";
import { config } from "../config/env";
import { User } from "../models/User";

const BUCKET = "documents";
const DRY_RUN = process.argv.includes("--dry-run");

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};

interface ParsedDataUri {
  mimeType: string;
  buffer: Buffer;
}

function parseDataUri(value: string): ParsedDataUri | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(value);
  if (!match) return null;

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function uploadToStorage(
  path: string,
  body: Buffer,
  mimeType: string
): Promise<string | null> {
  const response = await fetch(
    `${config.supabaseUrl}/storage/v1/object/${BUCKET}/${path}`,
    {
      method: "POST",
      headers: {
        apikey: config.supabaseSecretKey,
        Authorization: `Bearer ${config.supabaseSecretKey}`,
        "Content-Type": mimeType,
        "cache-control": "3600",
      },
      body: new Uint8Array(body),
    }
  );

  if (!response.ok) {
    console.error(`    upload failed (${response.status}):`, await response.text());
    return null;
  }

  return `${config.supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`;
}

async function main() {
  await mongoose.connect(config.mongodbUri);
  console.log(`Connected to MongoDB${DRY_RUN ? "  [DRY RUN]" : ""}\n`);

  const teachers = await User.find({
    "verificationData.documents": { $exists: true, $ne: [] },
  }).select("name email verificationData");

  console.log(`Found ${teachers.length} user(s) with documents\n`);

  let migratedDocs = 0;
  let skippedDocs = 0;
  let failedDocs = 0;
  let bytesFreed = 0;

  for (const teacher of teachers) {
    const documents = teacher.verificationData?.documents || [];
    console.log(`${teacher.email}  (${documents.length} document(s))`);

    const updated: string[] = [];
    let changed = false;

    for (let i = 0; i < documents.length; i++) {
      const current = documents[i];

      const parsed = parseDataUri(current);
      if (!parsed) {
        // Already a URL, leave it alone
        console.log(`  [${i}] already a URL, skipping`);
        updated.push(current);
        skippedDocs++;
        continue;
      }

      const ext = MIME_EXTENSIONS[parsed.mimeType] || "bin";
      const path = `verification/${teacher._id}/document-${i}-${Date.now()}.${ext}`;
      const kb = Math.round(current.length / 1024);

      if (DRY_RUN) {
        console.log(`  [${i}] would upload ${kb} KB (${parsed.mimeType}) -> ${path}`);
        updated.push(current);
        migratedDocs++;
        bytesFreed += current.length;
        continue;
      }

      const publicUrl = await uploadToStorage(path, parsed.buffer, parsed.mimeType);

      if (!publicUrl) {
        // Keep the original so no data is lost
        console.log(`  [${i}] FAILED, keeping base64`);
        updated.push(current);
        failedDocs++;
        continue;
      }

      console.log(`  [${i}] ${kb} KB -> ${publicUrl.split("/").pop()}`);
      updated.push(publicUrl);
      migratedDocs++;
      bytesFreed += current.length;
      changed = true;
    }

    if (changed && !DRY_RUN) {
      teacher.verificationData = {
        ...teacher.verificationData,
        documents: updated,
      };
      teacher.markModified("verificationData");
      await teacher.save();
      console.log(`  saved`);
    }

    console.log();
  }

  console.log("─".repeat(50));
  console.log(`migrated: ${migratedDocs}   skipped: ${skippedDocs}   failed: ${failedDocs}`);
  console.log(`freed from MongoDB: ~${Math.round(bytesFreed / 1024)} KB`);
  if (DRY_RUN) console.log("\nDRY RUN - nothing was written");

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Migration error:", error);
  await mongoose.disconnect();
  process.exit(1);
});
