/**
 * The ONLY module that reads `process.env`. Everything else imports `config`.
 * Env is validated with zod at load time so a misconfigured deployment fails fast
 * and loudly instead of misbehaving at runtime.
 */
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // Postgres connection string (required).
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((s) => s.startsWith("postgres"), "must be a postgres:// URL"),

  // Separate DB used by the integration/concurrency tests (optional at runtime).
  TEST_DATABASE_URL: z.string().optional(),

  // Session JWT signing secret.
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),

  // LLM (only needed once the agent runs, so optional here).
  GEMINI_API_KEY: z.string().optional().default(""),
  // gemini-flash-latest tracks the current flash model (avoids the "deprecated
  // for new users" trap). Override per key/quota if needed.
  GEMINI_MODEL: z.string().min(1).default("gemini-flash-latest"),

  // Policy thresholds. Kept as a string for money so it can be parsed to Decimal.
  AUTO_REFUND_MAX: z.string().default("50.00"),
  CANCEL_AUTO_WINDOW_HOURS: z.coerce.number().nonnegative().default(24),
  REPLACEMENT_WINDOW_DAYS: z.coerce.number().int().positive().default(30),
});

export type Config = z.infer<typeof EnvSchema> & {
  isProd: boolean;
  isTest: boolean;
};

/**
 * Validate an env object and return typed config. Exported (rather than only run
 * at import) so it can be unit-tested with explicit inputs.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const data = parsed.data;
  return {
    ...data,
    isProd: data.NODE_ENV === "production",
    isTest: data.NODE_ENV === "test",
  };
}

export const config = loadConfig();
