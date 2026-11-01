import { NextResponse } from "next/server";
import { z } from "zod";
import { GENESIS } from "@/lib/audit";
import { subjectFor } from "@/lib/domains";
import { evaluate } from "@/lib/engine";
import type { LedgerEntry, ProposedAction } from "@/lib/types";

export const maxDuration = 60;

const Action = z.object({
  domain: z.enum(["refund", "deploy", "triage", "moderation"]),
  action: z.string().max(80),
  params: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()])),
  actor: z.object({ id: z.string().max(80), role: z.string().max(40), kind: z.enum(["agent", "human"]) }),
  text: z.string().max(4000).optional(),
});

const Body = z.object({
  actions: z.array(Action).min(1).max(6),
  ledger: z.array(z.any()).max(200).default([]),
  prevHash: z.string().regex(/^[0-9a-f]{64}$/).default(GENESIS),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });

  // A sequence is evaluated in order; each verdict lands in the ledger the next one sees.
  const ledger = [...(parsed.data.ledger as LedgerEntry[])];
  let prev = parsed.data.prevHash;
  const records = [];
  for (const a of parsed.data.actions as ProposedAction[]) {
    const rec = await evaluate(a, ledger, prev);
    records.push(rec);
    ledger.push({
      ts: rec.ts,
      domain: a.domain,
      action: a.action,
      actorId: a.actor.id,
      subject: subjectFor(a),
      amount: typeof a.params.amount === "number" ? a.params.amount : undefined,
      verdict: rec.decision.verdict,
    });
    prev = rec.hash;
  }
  return NextResponse.json({ records, ledger });
}
