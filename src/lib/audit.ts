// Tamper-evident audit trail: every record carries the hash of the previous one,
// so editing or deleting any past decision breaks every hash after it.

import { createHash } from "node:crypto";
import type { AuditRecord } from "./types";

export const GENESIS = "0".repeat(64);

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function hashRecord(r: Omit<AuditRecord, "hash">): string {
  return createHash("sha256").update(canonical(r)).digest("hex");
}

export function verifyChain(chain: AuditRecord[]): { ok: boolean; brokenAt: number | null; reason: string } {
  let prev = GENESIS;
  for (let i = 0; i < chain.length; i++) {
    const { hash, ...rest } = chain[i];
    if (rest.prevHash !== prev) return { ok: false, brokenAt: i, reason: `Record #${i + 1} does not link to the previous record` };
    if (hashRecord(rest) !== hash) return { ok: false, brokenAt: i, reason: `Record #${i + 1} was modified after it was written` };
    prev = hash;
  }
  return { ok: true, brokenAt: null, reason: `All ${chain.length} records verified` };
}
