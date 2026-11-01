import { NextResponse } from "next/server";
import { verifyChain } from "@/lib/audit";
import type { AuditRecord } from "@/lib/types";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.chain)) return NextResponse.json({ error: "chain[] required" }, { status: 400 });
  return NextResponse.json(verifyChain(body.chain as AuditRecord[]));
}
