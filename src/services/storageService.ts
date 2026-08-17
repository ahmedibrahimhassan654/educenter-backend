import { config } from "../config/env";

export const DOCUMENTS_BUCKET = "documents";
export const AVATARS_BUCKET = "avatars";
export const GROUP_VIDEOS_BUCKET = "group-videos";

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

  const index = stored.indexOf(PUBLIC_PREFIX);
  if (index === -1) return null;

  const afterPrefix = stored.slice(index + PUBLIC_PREFIX.length);
  const [bucket, ...rest] = afterPrefix.split("/");

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

  try {
    const response = await fetch(
      `${config.supabaseUrl}/storage/v1/object/sign/${DOCUMENTS_BUCKET}/${path}`,
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
  return DOCUMENTS_BUCKET;
}

function stripBucketPrefix(filePath: string): string {
  return filePath
    .replace(/^avatars\//, "")
    .replace(/^group-videos\//, "")
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
