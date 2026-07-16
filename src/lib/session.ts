/**
 * Stateless session as a signed JWT (jose). Edge-safe: no pg, no bcrypt here, so
 * it can be used from middleware. The token carries the user's id + role, which
 * is the authorization anchor for the whole app.
 */
import { SignJWT, jwtVerify } from "jose";
import { config } from "../config";
import type { Role } from "./rbac";

export const SESSION_COOKIE = "session";

export type SessionPayload = {
  sub: string; // user id
  email: string;
  name: string | null;
  role: Role;
};

const secret = new TextEncoder().encode(config.AUTH_SECRET);

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    email: payload.email,
    name: payload.name,
    role: payload.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${config.SESSION_TTL_HOURS}h`)
    .sign(secret);
}

export async function verifySession(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (!payload.sub || !payload.role) return null;
    return {
      sub: String(payload.sub),
      email: String(payload.email ?? ""),
      name: (payload.name as string | null) ?? null,
      role: payload.role as Role,
    };
  } catch {
    return null;
  }
}
