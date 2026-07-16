/**
 * Long-poll support via Postgres LISTEN/NOTIFY. A single dedicated connection
 * LISTENs on `escalations_changed` (fired by a trigger) and fans notifications
 * out to in-process waiters. Long-poll handlers await the next change (or a
 * timeout) and the client immediately reconnects — no flood of polling requests.
 * Viable because we deploy on a persistent container (Railway), not serverless.
 */
import { Client } from "pg";
import { EventEmitter } from "node:events";
import { config } from "../config";

const CHANNEL = "escalations_changed";

const globalForNotify = globalThis as unknown as {
  __notifyEmitter?: EventEmitter;
  __notifyStarting?: Promise<EventEmitter>;
};

async function ensureListener(): Promise<EventEmitter> {
  if (globalForNotify.__notifyEmitter) return globalForNotify.__notifyEmitter;
  if (globalForNotify.__notifyStarting) return globalForNotify.__notifyStarting;

  globalForNotify.__notifyStarting = (async () => {
    const client = new Client({ connectionString: config.DATABASE_URL });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0); // many concurrent long-poll waiters
    client.on("notification", (msg) => emitter.emit("change", msg.payload ?? null));
    const reset = () => {
      globalForNotify.__notifyEmitter = undefined;
      globalForNotify.__notifyStarting = undefined;
      client.end().catch(() => {});
    };
    client.on("error", reset);
    client.on("end", reset);
    globalForNotify.__notifyEmitter = emitter;
    return emitter;
  })();

  return globalForNotify.__notifyStarting;
}

/** Resolves with the change payload when an escalation changes, or null on timeout. */
export async function waitForEscalationChange(timeoutMs = 25_000): Promise<string | null> {
  const emitter = await ensureListener();
  return new Promise((resolve) => {
    const onChange = (payload: string | null) => {
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      emitter.off("change", onChange);
      resolve(null);
    }, timeoutMs);
    emitter.once("change", onChange);
  });
}
