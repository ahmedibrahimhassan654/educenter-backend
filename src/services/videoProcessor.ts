import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import ffmpegStatic from "ffmpeg-static";
import { config } from "../config/env";
import { transcribeAudio } from "./aiService";

function getFfmpegPath(): string {
  if (ffmpegStatic) {
    return ffmpegStatic;
  }
  return "ffmpeg";
}

export function extractAudioFromVideo(
  videoBuffer: Buffer,
  outputFormat: string = "mp3"
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tempDir = os.tmpdir();
    const inputPath = path.join(tempDir, `video-input-${Date.now()}`);
    const outputPath = path.join(tempDir, `audio-output-${Date.now()}.${outputFormat}`);

    fs.writeFileSync(inputPath, videoBuffer);

    const ffmpegPath = getFfmpegPath();
    const ffmpeg = spawn(ffmpegPath, [
      "-i",
      inputPath,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-ab",
      "128k",
      "-ar",
      "44100",
      "-y",
      outputPath,
    ]);

    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      try {
        fs.unlinkSync(inputPath);
      } catch {
        // ignore cleanup errors
      }

      if (code !== 0) {
        try {
          fs.unlinkSync(outputPath);
        } catch {
          // ignore
        }
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const audioBuffer = fs.readFileSync(outputPath);
        fs.unlinkSync(outputPath);
        resolve(audioBuffer);
      } catch (err: any) {
        reject(new Error(`Failed to read output file: ${err.message}`));
      }
    });

    ffmpeg.on("error", (err) => {
      try {
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
      } catch {
        // ignore
      }
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

export async function downloadVideoFromSupabase(
  storagePath: string
): Promise<Buffer> {
  await import("./storageService.js");
  // Accept either a bare path or one prefixed with the bucket name.
  const cleanPath = storagePath.replace(/^session-recordings\//, "");
  const url = `${config.supabaseUrl}/storage/v1/object/${config.sessionRecordingsBucket}/${cleanPath}`;

  const response = await fetch(url, {
    headers: {
      apikey: config.supabaseSecretKey,
      Authorization: `Bearer ${config.supabaseSecretKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function processVideoToTranscript(
  videoBuffer: Buffer,
  filename: string = "video.mp4"
): Promise<{ transcript: string; duration?: number }> {
  const audioBuffer = await extractAudioFromVideo(videoBuffer);
  const transcript = await transcribeAudio(
    audioBuffer,
    `${path.parse(filename).name}.mp3`
  );

  return {
    transcript: transcript.trim(),
  };
}

/**
 * Remux a video buffer to MP4 with the moov atom at the front (faststart)
 * using a stream copy (no re-encode — fast and lossless). Browsers need the
 * moov atom before they can start playing, so without faststart large
 * recordings buffer until the whole file has downloaded.
 */
export function remuxVideoToFaststart(
  inputBuffer: Buffer,
  outputFormat: string = "mp4"
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tempDir = os.tmpdir();
    const inputPath = path.join(
      tempDir,
      `video-input-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const outputPath = path.join(
      tempDir,
      `video-output-${Date.now()}-${Math.random().toString(36).slice(2)}.${outputFormat}`
    );
    fs.writeFileSync(inputPath, inputBuffer);

    const ffmpegPath = getFfmpegPath();
    const ffmpeg = spawn(ffmpegPath, [
      "-i",
      inputPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "-y",
      outputPath,
    ]);

    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      try {
        fs.unlinkSync(inputPath);
      } catch {
        // ignore cleanup errors
      }

      if (code !== 0) {
        try {
          fs.unlinkSync(outputPath);
        } catch {
          // ignore
        }
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-300)}`));
        return;
      }

      try {
        const buffer = fs.readFileSync(outputPath);
        fs.unlinkSync(outputPath);
        resolve(buffer);
      } catch (err: any) {
        reject(new Error(`Failed to read output file: ${err.message}`));
      }
    });

    ffmpeg.on("error", (err) => {
      try {
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
      } catch {
        // ignore
      }
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

export async function processSupabaseVideoToTranscript(
  storagePath: string
): Promise<{ transcript: string; duration?: number }> {
  const videoBuffer = await downloadVideoFromSupabase(storagePath);
  const filename = path.basename(storagePath);
  return processVideoToTranscript(videoBuffer, filename);
}
