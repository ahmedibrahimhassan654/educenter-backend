import { config } from "../config/env";

export const DOCUMENTS_BUCKET = "documents";
export const AVATARS_BUCKET = "avatars";
export const GROUP_VIDEOS_BUCKET = "group-videos";
export const LESSON_VIDEOS_BUCKET = "lesson-videos";
export const SESSION_RECORDINGS_BUCKET =
  config.sessionRecordingsBucket || "session-recordings";

// Long enough for an admin to review a submission, short enough that a leaked
// link stops working quickly.
export const SIGNED_URL_TTL_SECONDS = Number(
  process.env.SIGNED_URL_TTL_SECONDS || 15 * 60
);

const PUBLIC_PREFIX = "/storage/v1/object/public/";

/**
 * Convert whatever is stored on a user record into a bucket-relative path.
 *
 * Records created before the bucket was made private hold full public URLs,
 * so both shapes have to be supported.
 */
export function toStoragePath(stored: string): string | null {
  if (!stored) return null;

  // Already a plain path
  if (!stored.startsWith("http")) {
    return stored.replace(/^\/+/, "").replace(`${DOCUMENTS_BUCKET}/`, "");
  }

  const publicIndex = stored.indexOf(PUBLIC_PREFIX);
  const signMarker = "/storage/v1/object/sign/documents/";
  const signIndex = stored.indexOf(signMarker);

  let bucket: string;
  let rest: string[];

  if (publicIndex !== -1) {
    const afterPrefix = stored.slice(publicIndex + PUBLIC_PREFIX.length);
    [bucket, ...rest] = afterPrefix.split("/");
  } else if (signIndex !== -1) {
    bucket = DOCUMENTS_BUCKET;
    rest = stored.slice(signIndex + signMarker.length).split("/");
  } else {
    return null;
  }

  if (bucket !== DOCUMENTS_BUCKET || rest.length === 0) return null;

  return rest.join("/").split("?")[0];
}

/**
 * Create a time-limited download URL for a private object.
 * Returns null when the object cannot be signed (missing or renamed).
 */
export async function createSignedUrl(
  storedPathOrUrl: string,
  expiresIn: number = SIGNED_URL_TTL_SECONDS
): Promise<string | null> {
  const path = toStoragePath(storedPathOrUrl);
  if (!path) return null;

  return signObject(DOCUMENTS_BUCKET, path, expiresIn);
}

/**
 * Sign an object in a given bucket and return an absolute download URL.
 * Returns null when signing fails so callers can fall back to a proxy.
 */
async function signObject(
  bucket: string,
  path: string,
  expiresIn: number
): Promise<string | null> {
  try {
    const response = await fetch(
      `${config.supabaseUrl}/storage/v1/object/sign/${bucket}/${path}`,
      {
        method: "POST",
        headers: {
          apikey: config.supabaseSecretKey,
          Authorization: `Bearer ${config.supabaseSecretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn }),
      }
    );

    if (!response.ok) {
      console.error(
        `Failed to sign ${path} (${response.status}):`,
        await response.text()
      );
      return null;
    }

    const data: any = await response.json();
    if (!data?.signedURL) return null;

    // The API returns a relative URL such as "/object/sign/..."
    return `${config.supabaseUrl}/storage/v1${data.signedURL}`;
  } catch (error) {
    console.error("Error creating signed URL:", error);
    return null;
  }
}

/** Sign a list of stored documents, preserving order. */
export async function createSignedUrls(
  stored: string[],
  expiresIn: number = SIGNED_URL_TTL_SECONDS
): Promise<Array<{ url: string | null; path: string | null }>> {
  return Promise.all(
    stored.map(async (item) => ({
      path: toStoragePath(item),
      url: await createSignedUrl(item, expiresIn),
    }))
  );
}

function bucketFor(filePath: string): string {
  if (filePath.startsWith("avatars/")) return AVATARS_BUCKET;
  if (filePath.startsWith("group-videos/")) return GROUP_VIDEOS_BUCKET;
  if (filePath.startsWith("lesson-videos/")) return LESSON_VIDEOS_BUCKET;
  if (filePath.startsWith("session-recordings/")) return SESSION_RECORDINGS_BUCKET;
  return DOCUMENTS_BUCKET;
}

function stripBucketPrefix(filePath: string): string {
  return filePath
    .replace(/^avatars\//, "")
    .replace(/^group-videos\//, "")
    .replace(/^lesson-videos\//, "")
    .replace(/^session-recordings\//, "")
    .replace(/^documents\//, "");
}

/**
 * Upload a file to Supabase Storage
 */
export async function uploadFile(
  filePath: string,
  buffer: Buffer,
  contentType: string
): Promise<boolean> {
  try {
    const bucket = bucketFor(filePath);
    const path = stripBucketPrefix(filePath);
    
    const response = await fetch(
      `${config.supabaseUrl}/storage/v1/object/${bucket}/${path}`,
      {
        method: "POST",
        headers: {
          apikey: config.supabaseSecretKey,
          Authorization: `Bearer ${config.supabaseSecretKey}`,
          "Content-Type": contentType,
        },
        body: buffer,
      }
    );

    if (!response.ok) {
      console.error(`Failed to upload ${filePath} (${response.status}):`, await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error uploading file:", error);
    return false;
  }
}

/**
 * Delete a file from Supabase Storage
 */
export async function deleteFile(filePath: string): Promise<boolean> {
  try {
    const bucket = bucketFor(filePath);
    const path = stripBucketPrefix(filePath);
    
    const response = await fetch(
      `${config.supabaseUrl}/storage/v1/object/${bucket}/${path}`,
      {
        method: "DELETE",
        headers: {
          apikey: config.supabaseSecretKey,
          Authorization: `Bearer ${config.supabaseSecretKey}`,
        },
      }
    );

    return response.ok;
  } catch (error) {
    console.error("Error deleting file:", error);
    return false;
  }
}

/**
 * Get public URL for a file in Supabase Storage
 */
export function getPublicUrl(filePath: string): string {
  const bucket = bucketFor(filePath);
  const path = stripBucketPrefix(filePath);
  return `${config.supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * Ensure a storage bucket is public so objects inside it are readable via
 * their public URLs without authentication. Group description videos live in
 * the `group-videos` bucket and are meant to be publicly browsable, while
 * lesson/session content stays in private buckets served through the
 * authenticated proxy routes. Non-fatal: returns false when Supabase is
 * unreachable so callers can decide how to handle it.
 */
export async function setBucketPublic(bucket: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${config.supabaseUrl}/storage/v1/bucket/${bucket}`,
      {
        method: "PATCH",
        headers: {
          apikey: config.supabaseSecretKey,
          Authorization: `Bearer ${config.supabaseSecretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ public: true }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      // 404 means the bucket doesn't exist yet (never uploaded to) — fine.
      if (response.status !== 404) {
        console.error(
          `Failed to make ${bucket} public (${response.status}):`,
          text
        );
      }
      return response.status === 404 ? true : false;
    }

    return true;
  } catch (error) {
    console.error(`Error making ${bucket} public:`, error);
    return false;
  }
}

/**
 * True when a lesson's stored video value is a private lesson-videos path.
 */
export function isStorageVideoPath(value: string): boolean {
  return typeof value === "string" && value.startsWith("lesson-videos/");
}

/**
 * Normalize any accepted lesson-video shape (plain path, public URL, signed
 * URL) into a clean bucket-relative path. Returns null for external links and
 * proxy URLs so callers can keep those untouched.
 */
export function toStorageVideoPath(value: string): string | null {
  if (!value) return null;

  if (value.startsWith("lesson-videos/")) {
    return value.replace(/^\/+/, "");
  }

  const storageMatch = value.match(
    /\/storage\/v1\/object\/(public|sign)\/lesson-videos\/([^?#]+)/
  );
  if (storageMatch) {
    return `lesson-videos/${storageMatch[2].replace(/^\/+/, "")}`;
  }

  return null;
}

/**
 * True when the value is this platform's video proxy URL for a lesson.
 * Used to detect that the stored videoUrl was handed back unchanged by the UI.
 */
export function isProxyVideoUrl(
  value: string,
  lessonId?: string
): boolean {
  if (!value || !value.includes("/api/groups/")) return false;
  const match = value.match(/\/api\/groups\/[^/]+\/lessons\/([^/]+)\/video/);
  if (!match) return false;
  return lessonId ? match[1] === lessonId : true;
}

/**
 * Open a streaming response to a private Supabase Storage object using the
 * service key. Returns the raw Response so callers can pipe it to the client,
 * optionally forwarding the HTTP Range header for video seeking.
 */
export async function fetchStorageObject(
  bucket: string,
  path: string,
  range?: string
): Promise<Response> {
  const headers: Record<string, string> = {
    apikey: config.supabaseSecretKey,
    Authorization: `Bearer ${config.supabaseSecretKey}`,
  };
  if (range) headers["Range"] = range;

  return fetch(
    `${config.supabaseUrl}/storage/v1/object/${bucket}/${path.replace(/^\/+/, "")}`,
    { headers }
  );
}

/**
 * Normalize any accepted session-recording shape (plain path, public URL,
 * signed URL) into a clean bucket-relative path. Returns null otherwise.
 */
export function toStorageSessionPath(value: string): string | null {
  if (!value) return null;

  if (value.startsWith("session-recordings/")) {
    return value.replace(/^\/+/, "");
  }

  const storageMatch = value.match(
    /\/storage\/v1\/object\/(public|sign)\/session-recordings\/([^?#]+)/
  );
  if (storageMatch) {
    return `session-recordings/${storageMatch[2].replace(/^\/+/, "")}`;
  }

  return null;
}

/**
 * Normalize a group description video (plain path or public group-videos URL)
 * into a clean bucket-relative path. Returns null for external links.
 */
export function toStorageGroupVideoPath(value: string): string | null {
  if (!value) return null;

  if (value.startsWith("group-videos/")) {
    return value.replace(/^\/+/, "");
  }

  const storageMatch = value.match(
    /\/storage\/v1\/object\/(public|sign)\/group-videos\/([^?#]+)/
  );
  if (storageMatch) {
    return `group-videos/${storageMatch[2].replace(/^\/+/, "")}`;
  }

  return null;
}

/**
 * Create a signed upload URL so the browser can upload a file directly to
 * Supabase Storage (no backend buffering). Signed upload URLs are valid for
 * 2 hours and bypass RLS. `objectPath` is relative to the bucket (the bucket
 * name is already part of the REST path). Returns the upload URL, its token
 * and the path.
 */
export async function createSignedUploadUrl(
  bucket: string,
  objectPath: string
): Promise<{ uploadUrl: string; token: string; path: string } | null> {
  try {
    const response = await fetch(
      `${config.supabaseUrl}/storage/v1/object/upload/sign/${bucket}/${objectPath.replace(
        /^\/+/,
        ""
      )}`,
      {
        method: "POST",
        headers: {
          apikey: config.supabaseSecretKey,
          Authorization: `Bearer ${config.supabaseSecretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      console.error(
        `Failed to create signed upload URL (${response.status}):`,
        await response.text()
      );
      return null;
    }

    const data: any = await response.json();
    if (!data?.url) return null;

    // data.url is relative to the storage base (e.g. /object/upload/sign/...).
    const uploadUrl = `${config.supabaseUrl}/storage/v1${data.url}`;
    const token =
      data.token || new URL(uploadUrl).searchParams.get("token");
    if (!token) return null;

    return { uploadUrl, token, path: objectPath };
  } catch (error) {
    console.error("Error creating signed upload URL:", error);
    return null;
  }
}
