/**
 * Cache Service
 *
 * Simple in-memory cache with TTL support. Can be swapped for Redis later
 * by implementing the same interface.
 *
 * Usage in routes:
 *
 *   import { cache } from "../services/cache";
 *
 *   // GET endpoint with caching:
 *   router.get("/endpoint", auth, async (req, res) => {
 *     const cacheKey = "myendpoint:param";
 *     const cached = cache.get(cacheKey);
 *     if (cached) {
 *       res.json(cached);
 *       return;
 *     }
 *     const data = await fetchFromDB();
 *     const response = { success: true, data };
 *     cache.set(cacheKey, response, 60); // Cache for 60 seconds
 *     res.json(response);
 *   });
 *
 *   // Invalidate on mutation:
 *   router.post("/endpoint", auth, async (req, res) => {
 *     await saveToDB();
 *     cache.deleteByPattern("myendpoint:*"); // Invalidate related caches
 *     res.json({ success: true });
 *   });
 *
 * Cache TTL Guidelines:
 * - Curriculum/Settings: 300-3600 seconds (rarely changes)
 * - User lists/stats: 30-60 seconds (moderate changes)
 * - Sessions/Groups: 30 seconds (frequent changes)
 * - Notifications: 15 seconds (real-time feel)
 * - Attendance: 60 seconds (moderate changes)
 */

interface CacheEntry {
  data: unknown;
  expiry: number;
}

class Cache {
  private store = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.data as T;
  }

  set(key: string, data: unknown, ttlSeconds: number): void {
    this.store.set(key, {
      data,
      expiry: Date.now() + ttlSeconds * 1000,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  deleteByPattern(pattern: string): void {
    const regex = new RegExp(pattern.replace(/\*/g, ".*"));
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  getStats() {
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? Math.round((this.hits / (this.hits + this.misses)) * 100)
        : 0,
    };
  }
}

export const cache = new Cache();

/**
 * Express middleware for caching GET responses.
 * Usage: router.get("/path", cacheMiddleware(60), handler)
 */
export function cacheMiddleware(ttlSeconds: number, keyPrefix?: string) {
  return (req: any, res: any, next: any) => {
    if (req.method !== "GET") return next();

    const cacheKey = keyPrefix
      ? `${keyPrefix}:${req.originalUrl}`
      : `cache:${req.originalUrl}`;

    const cached = cache.get(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    // Override res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = (data: any) => {
      cache.set(cacheKey, data, ttlSeconds);
      return originalJson(data);
    };

    next();
  };
}
