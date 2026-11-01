import { randomUUID } from "node:crypto";
import { modelSignals } from "./assessor";
import { GENESIS, hashRecord } from "./audit";
import { assessDomain } from "./domains";
import { decide } from "./policy";
import { DEMO_NOW } from "./data";
import type { AuditRecord, LedgerEntry, ProposedAction } from "./types";

export const ENGINE_VERSION = "verdict-engine/1.0.0";

/** inputs → signals → decision → audit. */
export async function evaluate(input: ProposedAction, ledger: LedgerEntry[], prevHash = GENESIS): Promise<AuditRecord> {
  const domain = assessDomain(input, ledger); // deterministic facts from systems of record
  const model = await modelSignals(input, domain); // model reads the unstructured text
  const decision = decide(domain, model); // deterministic, traced policy
  // Demo clock: records are stamped on the fixed demo timeline, offset by real elapsed time.
  const ts = new Date(DEMO_NOW.getTime() + ledger.length * 60_000).toISOString();
  const unsigned = { id: randomUUID(), ts, input, domain, decision, engineVersion: ENGINE_VERSION, prevHash };
  return { ...unsigned, hash: hashRecord(unsigned) };
}
