import { NextResponse } from "next/server";
import { pool } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness + DB connectivity check. */
export async function GET() {
  try {
    const result = await pool.query("SELECT 1 AS ok");
    return NextResponse.json({ status: "ok", db: result.rows[0]?.ok === 1 });
  } catch (err) {
    return NextResponse.json(
      { status: "error", error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
