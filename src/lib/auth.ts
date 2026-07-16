/**
 * Credential verification (Node runtime — bcrypt + pg). Pure of request context
 * so it can be unit-tested against the test database. `authenticate` takes an
 * optional db client for that reason.
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db as appDb, type DB } from "../db/client";
import { users } from "../db/schema";
import type { SessionPayload } from "./session";

export async function authenticate(
  email: string,
  password: string,
  database: DB = appDb,
): Promise<SessionPayload | null> {
  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  if (!user) return null;

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  return { sub: user.id, email: user.email, name: user.name, role: user.role };
}
