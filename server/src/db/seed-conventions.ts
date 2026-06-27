/**
 * Demo source files for the conventions-extractor (L03).
 *
 * The demo repo `acme/payments-api` is not really cloned, so the extractor's
 * content source — `code_chunks` (the same table the real indexer writes file
 * content to) — is seeded here with a handful of realistic files. They carry a
 * few clear "house conventions" (async/await over `.then()`, public handlers
 * returning `Result<T, ApiError>`, a single Redis singleton) so the cheap-model
 * pass has real material to find, and every proposed candidate can be verified
 * against — and deep-linked into — actual code.
 */

export interface ConventionFixtureFile {
  path: string;
  content: string;
}

export const CONVENTION_FIXTURE_FILES: ConventionFixtureFile[] = [
  {
    path: 'src/lib/redis.ts',
    content: `import Redis from "ioredis";
import { config } from "../config";

// Single shared Redis connection for the whole service. Never construct a new
// Redis() anywhere else — import this singleton instead.
export const redis = new Redis(config.redisUrl);

export function ping(): Promise<string> {
  return redis.ping();
}
`,
  },
  {
    path: 'src/lib/result.ts',
    content: `// Typed result wrapper used by every public API handler.
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T, E = never>(value: T): Result<T, E> {
  return { ok: true, value };
}

export function err<E, T = never>(error: E): Result<T, E> {
  return { ok: false, error };
}
`,
  },
  {
    path: 'src/api/public/index.ts',
    content: `import { ok, err, type Result } from "../../lib/result";
import type { ApiError } from "../../lib/errors";
import type { Item } from "../../types";
import { listItems, findItem } from "./items";

// CONVENTION: every public route handler returns a typed Result<T, ApiError>.
// Callers branch on \`result.ok\` — handlers never throw across the boundary.
export async function getItems(): Promise<Result<Item[], ApiError>> {
  const items = await listItems();
  return ok(items);
}

export async function getItem(id: string): Promise<Result<Item, ApiError>> {
  const item = await findItem(id);
  if (!item) {
    return err({ code: "not_found", message: "Item not found" });
  }
  return ok(item);
}
`,
  },
  {
    path: 'src/api/users.ts',
    content: `import { db } from "../lib/db";
import { redis } from "../lib/redis";

// CONVENTION: async/await everywhere — no \`.then()\` chains. Sequential awaits
// read top-to-bottom and surface errors through normal try/catch.
export async function getUserWithPosts(id: string) {
  const cached = await redis.get(\`user:\${id}\`);
  if (cached) {
    return JSON.parse(cached);
  }

  const user = await db.users.find(id);
  const posts = await db.posts.findMany({ userId: id });
  const result = { ...user, posts };

  await redis.set(\`user:\${id}\`, JSON.stringify(result), "EX", 60);
  return result;
}
`,
  },
  {
    path: 'src/api/orders.ts',
    content: `import { ok, err, type Result } from "../lib/result";
import type { ApiError } from "../lib/errors";
import { db } from "../lib/db";
import { redis } from "../lib/redis";

// Public handler: returns Result<T, ApiError>, uses async/await + the redis
// singleton, and validates input before touching the database.
export async function createOrder(input: {
  userId: string;
  amount: number;
}): Promise<Result<{ id: string }, ApiError>> {
  if (input.amount <= 0) {
    return err({ code: "invalid_amount", message: "Amount must be positive" });
  }

  const user = await db.users.find(input.userId);
  if (!user) {
    return err({ code: "not_found", message: "User not found" });
  }

  const order = await db.orders.insert({ userId: input.userId, amount: input.amount });
  await redis.del(\`user:\${input.userId}\`);
  return ok({ id: order.id });
}
`,
  },
];
