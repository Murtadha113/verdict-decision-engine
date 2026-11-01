// Runs every scenario through the engine and checks the verdict against the expected one.
// Works offline (heuristic signals) or with ANTHROPIC_API_KEY set (Claude signals).
import { evaluate } from "../src/lib/engine";
import { subjectFor } from "../src/lib/domains";
import { scenarios } from "../src/lib/scenarios";
import type { LedgerEntry } from "../src/lib/types";

async function main() {
let pass = 0;
for (const s of scenarios) {
  const ledger: LedgerEntry[] = [];
  let verdict = "";
  for (const a of s.sequence ?? [s.action]) {
    const r = await evaluate(a, ledger);
    ledger.push({ ts: r.ts, domain: a.domain, action: a.action, actorId: a.actor.id, subject: subjectFor(a), amount: typeof a.params.amount === "number" ? a.params.amount : undefined, verdict: r.decision.verdict });
    verdict = r.decision.verdict;
    if (s.sequence) process.stdout.write(`    step ${ledger.length}: ${verdict} (conf ${r.decision.confidence})\n`);
    else process.stdout.write(`    conf ${r.decision.confidence} risk ${r.decision.risk} E[loss] $${r.decision.expectedLoss} via ${r.decision.rules.find((x) => x.fired)?.rule}\n`);
  }
  const ok = verdict === s.expect;
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${s.id.padEnd(20)} expected ${s.expect.padEnd(8)} got ${verdict}`);
}
console.log(`\n${pass}/${scenarios.length} scenarios match expected verdicts`);
process.exit(pass === scenarios.length ? 0 : 1);
}
main();
