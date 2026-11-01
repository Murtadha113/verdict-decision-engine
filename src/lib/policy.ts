// The decision policy. Deterministic, ordered, and fully traced: every rule records whether
// it fired and why, so a reviewer can replay any verdict by hand.

import type { Anomaly, Decision, DomainAssessment, Evidence, MissingInfo, ModelSignals, RuleTrace, Verdict } from "./types";

const REV_FACTOR = { reversible: 0.25, costly: 0.7, irreversible: 1 } as const;
export const THRESHOLDS = { minConfidence: 0.7, maxRisk: 70, askBelow: 0.5 } as const;

export function evidenceScore(ev: Evidence[]): number {
  const s = ev.reduce((acc, e) => acc + (e.stance === "for" ? e.weight : e.stance === "against" ? -e.weight : 0), 0);
  return 1 / (1 + Math.exp(-2.2 * s)); // 0 net evidence → 0.5
}

function mergeAnomalies(a: Anomaly[], b: Anomaly[]): Anomaly[] {
  const out = [...a];
  for (const x of b) if (!out.some((y) => y.kind === x.kind)) out.push(x);
  return out;
}

function mergeMissing(a: MissingInfo[], b: MissingInfo[]): MissingInfo[] {
  const out = [...a];
  for (const x of b) if (!out.some((y) => y.field === x.field)) out.push(x);
  return out;
}

export function decide(d: DomainAssessment, m: ModelSignals): Decision {
  const anomalies = mergeAnomalies(d.anomalies, m.anomalies);
  const missing = mergeMissing(d.missing, m.missing);

  // Confidence = deterministic evidence blended with the model's reading of the text.
  let confidence = 0.55 * evidenceScore(d.evidence) + 0.45 * m.legitimacy;
  if (m.claimsVsEvidence === "contradicts") confidence *= 0.6;
  else if (m.claimsVsEvidence === "unverifiable") confidence *= 0.9;
  confidence = Math.round(confidence * 100) / 100;

  const sevBump = anomalies.reduce((s, x) => s + (x.severity === "high" ? 25 : x.severity === "medium" ? 10 : 3), 0);
  const revBump = d.reversibility === "irreversible" ? 20 : d.reversibility === "costly" ? 8 : 0;
  const risk = Math.min(100, Math.round(d.baseRisk + sevBump + revBump));
  const expectedLoss = Math.round((1 - confidence) * d.costOfWrong * REV_FACTOR[d.reversibility] * 100) / 100;

  const rules: RuleTrace[] = [];
  let verdict: Verdict | null = null;
  let headline = "";
  let nextStep = "";

  const rule = (name: string, cond: boolean, detail: string, v: Verdict, h: string, next: string) => {
    const decided = verdict !== null;
    const fired = !decided && cond;
    rules.push({ rule: name, fired, detail: decided ? "skipped — earlier rule decided" : cond ? detail : "not triggered" });
    if (fired) {
      verdict = v;
      headline = h;
      nextStep = next;
    }
  };

  const high = (k: Anomaly["kind"][]) => anomalies.filter((a) => k.includes(a.kind) && a.severity === "high");
  const byRequester = missing.filter((x) => x.resolvableBy === "requester");
  const byTime = missing.filter((x) => x.resolvableBy === "time");
  const byAuthority = missing.filter((x) => x.resolvableBy === "authority");

  rule("R1 hard policy", d.policyViolations.length > 0, d.policyViolations.join("; "), "refuse", "Blocked by policy", d.policyViolations[0] ?? "");
  rule(
    "R2 manipulation",
    high(["prompt_injection", "social_engineering"]).length > 0,
    high(["prompt_injection", "social_engineering"]).map((a) => a.detail).join("; "),
    "refuse",
    "Request tries to steer the agent — refused",
    "Action refused. Item flagged to security review; underlying request routed to a human queue.",
  );
  rule("R3 human safety", high(["safety_risk"]).length > 0, high(["safety_risk"]).map((a) => a.detail).join("; "), "escalate", "Possible risk to a person — humans now", "Page the crisis team (SLA 15 min). Do not take automated action.");
  rule(
    "R4 authority",
    !d.authority.actorHas,
    `${d.authority.reason}. Requires: ${d.authority.required}`,
    "escalate",
    `Needs ${d.authority.required}`,
    `Escalate to ${d.authority.required} with this decision record attached.`,
  );
  rule(
    "R5 legal / integrity",
    high(["legal_threat", "data_mismatch", "velocity"]).length > 0 || byAuthority.length > 0,
    [...high(["legal_threat", "data_mismatch", "velocity"]).map((a) => a.detail), ...byAuthority.map((x) => x.why)].join("; "),
    byTime.length > 0 && high(["legal_threat", "velocity"]).length === 0 ? "defer" : "escalate",
    byTime.length > 0 && high(["legal_threat", "velocity"]).length === 0 ? "Facts don't line up yet — wait" : "Integrity signal — a human must look",
    byTime.length > 0 && high(["legal_threat", "velocity"]).length === 0 ? byTime[0].resolution : `Escalate: ${[...high(["legal_threat", "data_mismatch", "velocity"]), ...byAuthority].map((a) => ("kind" in a ? a.kind : a.field)).join(", ")}`,
  );
  rule("R6 ask requester", byRequester.length > 0, byRequester.map((x) => x.why).join("; "), "ask", "Missing information the requester can give", byRequester[0]?.resolution ?? "");
  rule("R7 wait for facts", byTime.length > 0, byTime.map((x) => x.why).join("; "), "defer", "Not yet — the facts will change soon", byTime[0]?.resolution ?? "");
  rule(
    "R8 autonomy budget",
    expectedLoss <= d.autonomyBudget && confidence >= THRESHOLDS.minConfidence && risk < THRESHOLDS.maxRisk,
    `expected loss $${expectedLoss} ≤ budget $${d.autonomyBudget}, confidence ${confidence} ≥ ${THRESHOLDS.minConfidence}, risk ${risk} < ${THRESHOLDS.maxRisk}`,
    "execute",
    "Safe to act autonomously",
    `Execute. Rollback path: ${d.rollback}`,
  );
  rule(
    "R9 unclear intent",
    confidence < THRESHOLDS.askBelow && !m.intentClear,
    `confidence ${confidence} and intent unclear`,
    "ask",
    "Too unsure what is being asked",
    "Ask the requester to restate what they need and why.",
  );
  rule(
    "R10 default",
    true,
    `expected loss $${expectedLoss} vs budget $${d.autonomyBudget}; confidence ${confidence}; risk ${risk}`,
    "escalate",
    "Outside the agent's autonomy budget",
    `Escalate with recommendation; expected loss $${expectedLoss} exceeds what the agent may carry alone ($${d.autonomyBudget}).`,
  );

  return {
    verdict: verdict!,
    headline,
    confidence,
    risk,
    expectedLoss,
    reversibility: d.reversibility,
    evidence: d.evidence,
    missing,
    anomalies,
    policyViolations: d.policyViolations,
    nextStep,
    effect: d.effect,
    rollback: d.rollback,
    rules,
    model: m,
  };
}
