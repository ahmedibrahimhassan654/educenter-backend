/**
 * Bulk-optimize every stored lesson video to faststart MP4 so browsers start
 * playback immediately instead of waiting for the whole file to download.
 *
 * Processes videoUrl, recordedLiveVideoUrl and recordedVideoUrl for all
 * lessons. Skips values that are external links / proxy URLs. Keeps the old
 * object on failure so no data is lost.
 *
 * Usage:
 *   npx tsx src/scripts/optimizeAllLessonVideos.ts --dry-run
 *   npx tsx src/scripts/optimizeAllLessonVideos.ts
 */
import "../config/env";
import mongoose from "mongoose";
import { config } from "../config/env";
import { Lesson } from "../models/Lesson";
import { remuxVideoToFaststart } from "../services/videoProcessor";
import {
  toStorageVideoPath,
  fetchStorageObject,
  uploadFile,
  deleteFile,
  LESSON_VIDEOS_BUCKET,
} from "../services/storageService";

const DRY_RUN = process.argv.includes("--dry-run");
const FIELDS = ["videoUrl", "recordedLiveVideoUrl", "recordedVideoUrl"] as const;

async function main() {
  await mongoose.connect(config.mongodbUri);
  console.log(`Connected to MongoDB${DRY_RUN ? "  [DRY RUN]" : ""}\n`);

  const lessons = await Lesson.find().select(
    "groupId teacherId title videoUrl recordedLiveVideoUrl recordedVideoUrl"
  );

  console.log(`Found ${lessons.length} lesson(s)\n`);

  let optimized = 0;
  let skipped = 0;
  let failed = 0;

  for (const lesson of lessons) {
    let changed = false;

    for (const field of FIELDS) {
      const stored = (lesson as any)[field] as string | undefined;
      if (!stored) continue;

      const videoPath = toStorageVideoPath(stored);
      if (!videoPath) {
        console.log(`  [${lesson._id}][${field}] external link, skipping`);
        skipped++;
        continue;
      }

      const alreadyFast = videoPath.endsWith("-optimized.mp4");
      console.log(
        `  [${lesson._id}][${field}] ${alreadyFast ? "already optimized" : videoPath}`
      );
      if (alreadyFast) {
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`    would remux -> ${videoPath}`);
        optimized++;
        continue;
      }

      try {
        const upstream = await fetchStorageObject(
          LESSON_VIDEOS_BUCKET,
          videoPath.replace(`${LESSON_VIDEOS_BUCKET}/`, "")
        );
        if (!upstream.ok || !upstream.body) {
          console.error(`    download failed (${upstream.status}), skipping`);
          failed++;
          continue;
        }
        const buffer = Buffer.from(await upstream.arrayBuffer());

        const optimizedBuffer = await remuxVideoToFaststart(buffer);
        if (optimizedBuffer.length === 0) {
          console.error(`    remux produced empty output, skipping`);
          failed++;
          continue;
        }

        const userId = String(lesson.teacherId);
        const newPath = `lesson-videos/lessons/${userId}-${Date.now()}-optimized.mp4`;
        const uploaded = await uploadFile(newPath, optimizedBuffer, "video/mp4");
        if (!uploaded) {
          console.error(`    upload failed, keeping original`);
          failed++;
          continue;
        }

        (lesson as any)[field] = newPath;
        changed = true;
        optimized++;
        console.log(`    ${videoPath} -> ${newPath}`);

        await deleteFile(videoPath);
      } catch (error: any) {
        console.error(`    error: ${error.message}`);
        failed++;
      }
    }

    if (changed) {
      await lesson.save();
      console.log(`  saved ${lesson._id}\n`);
    }
  }

  console.log("─".repeat(50));
  console.log(`optimized: ${optimized}   skipped: ${skipped}   failed: ${failed}`);
  if (DRY_RUN) console.log("\nDRY RUN - nothing was written");

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Optimization error:", error);
  await mongoose.disconnect();
  process.exit(1);
});