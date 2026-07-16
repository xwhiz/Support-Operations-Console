"use client";

import { useEffect, useRef } from "react";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Long-poll loop: repeatedly hits /api/escalations/updates (which resolves on an
 * escalation change or a ~25s timeout) and invokes `onChange` each time so the
 * caller can refetch. Keeps two reviewers' views consistent without polling floods.
 */
export function useEscalationUpdates(onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    let active = true;
    (async () => {
      while (active) {
        try {
          const res = await fetch("/api/escalations/updates", { cache: "no-store" });
          if (!active) break;
          if (res.ok) cb.current();
          else await sleep(3000); // auth/others: back off
        } catch {
          if (!active) break;
          await sleep(2000);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);
}
