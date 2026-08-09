import Redis from "ioredis";
import { config } from "../config/env";

interface CacheEntry {
  data: unknown;
  expiry: number;
}

class InMemoryCache {
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
    for (const key of Array.from(this.store.keys())) {
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

class RedisCache {
  private client: Redis | null = null;
  private fallback: InMemoryCache;
  private useFallback = false;
  private hits = 0;
  private misses = 0;

  constructor() {
    this.fallback = new InMemoryCache();

    try {
      this.client = new Redis(config.redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 500);
          return delay;
        },
      });

      this.client.on("connect", () => {
        console.log("✅ Redis connected");
        this.useFallback = false;
      });

      this.client.on("error", (err) => {
        if (!this.useFallback) {
          console.error("❌ Redis connection error:", err.message);
        }
        this.useFallback = true;
      });
    } catch {
      console.warn("⚠️ Redis not available, using in-memory fallback");
      this.useFallback = true;
      this.client = null;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (this.useFallback || !this.client) {
        return this.fallback.get<T>(key);
      }
      const value = await this.client.get(key);
      if (!value) {
        this.misses++;
        return null;
      }
      this.hits++;
      return JSON.parse(value) as T;
    } catch {
      this.misses++;
      return null;
    }
  }

  async set(key: string, data: unknown, ttlSeconds: number): Promise<void> {
    try {
      if (this.useFallback || !this.client) {
        this.fallback.set(key, data, ttlSeconds);
        return;
      }
      const serialized = JSON.stringify(data);
      await this.client.setex(key, ttlSeconds, serialized);
    } catch (err) {
      console.error("Redis set error:", err);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      if (this.useFallback || !this.client) {
        this.fallback.delete(key);
        return;
      }
      await this.client.del(key);
    } catch {
      // ignore
    }
  }

  async deleteByPattern(pattern: string): Promise<void> {
    try {
      if (this.useFallback || !this.client) {
        this.fallback.deleteByPattern(pattern);
        return;
      }
      let cursor = "0";
      const keysToDelete: string[] = [];

      do {
        const result = await this.client.scan(cursor, "MATCH", pattern, "COUNT", "100");
        cursor = result[0];
        keysToDelete.push(...result[1]);
      } while (cursor !== "0");

      if (keysToDelete.length > 0) {
        await this.client.del(...keysToDelete);
      }
    } catch {
      // ignore
    }
  }

  async clear(): Promise<void> {
    try {
      if (this.useFallback || !this.client) {
        this.fallback.clear();
        return;
      }
      await this.client.flushdb();
    } catch {
      // ignore
    }
  }

  getStats() {
    return {
      size: this.useFallback ? this.fallback.getStats().size : 0,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? Math.round((this.hits / (this.hits + this.misses)) * 100)
        : 0,
    };
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
    }
  }
}

export const cache = new RedisCache();

/**
 * Express middleware for caching GET responses.
 * Usage: router.get("/path", cacheMiddleware(60), handler)
 */
export function cacheMiddleware(ttlSeconds: number, keyPrefix?: string) {
  return async (req: any, res: any, next: any) => {
    if (req.method !== "GET") return next();

    const cacheKey = keyPrefix
      ? `${keyPrefix}:${req.originalUrl}`
      : `cache:${req.originalUrl}`;

    const cached = await cache.get(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = async (data: any) => {
      await cache.set(cacheKey, data, ttlSeconds);
      return originalJson(data);
    };

    next();
  };
}
