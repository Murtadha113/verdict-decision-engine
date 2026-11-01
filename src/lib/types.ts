// Core vocabulary of the decision layer.
// The engine never "does" anything itself: it receives a proposed action,
// turns it into signals, and returns one of five verdicts with a full audit record.

export type Verdict = "execute" | "ask" | "defer" | "escalate" | "refuse";

export type Domain = "refund" | "deploy" | "triage" | "moderation";

export type Reversibility = "reversible" | "costly" | "irreversible";

export interface ProposedAction {
  domain: Domain;
  /** Machine-readable action, e.g. "refund.issue", "deploy.release". */
  action: string;
  params: Record<string, string | number | boolean>;
  /** Who (or which agent) is asking for this action. */
  actor: { id: string; role: string; kind: "agent" | "human" };
  /** Free text that came with the request (customer message, commit msg, post body…). */
  text?: string;
}

export interface Evidence {
  source: string; // where the fact came from (e.g. "orders.db", "ci.status")
  fact: string;
  /** Does this fact support doing the action? */
  stance: "for" | "against" | "neutral";
  /** 0..1, how much this should move confidence. */
  weight: number;
}

export interface MissingInfo {
  field: string;
  why: string;
  /** Who can resolve it: the requester (→ ask), the passage of time (→ defer), or someone with authority (→ escalate). */
  resolvableBy: "requester" | "time" | "authority";
  /** For "time": what we wait for. For "requester": the exact question to ask. */
  resolution: string;
}

export interface Anomaly {
  kind:
    | "prompt_injection"
    | "social_engineering"
    | "legal_threat"
    | "safety_risk"
    | "velocity"
    | "data_mismatch"
    | "other";
  detail: string;
  severity: "low" | "medium" | "high";
}

export interface DomainAssessment {
  evidence: Evidence[];
  missing: MissingInfo[];
  anomalies: Anomaly[];
  policyViolations: string[];
  reversibility: Reversibility;
  /** USD-equivalent cost if this action turns out to be wrong. */
  costOfWrong: number;
  /** 0..100 inherent risk of the action class + context. */
  baseRisk: number;
  authority: { required: string; actorHas: boolean; reason: string };
  /** Max expected loss (USD) this domain lets an agent take on by itself. */
  autonomyBudget: number;
  /** Human-readable description of the effect if executed. */
  effect: string;
  rollback: string;
}

/** What the language model contributes. It reads the unstructured text; it does NOT decide. */
export interface ModelSignals {
  source: "claude" | "heuristic";
  model?: string;
  intentClear: boolean;
  /** 0..1, how likely the request is legitimate and correct given text + evidence. */
  legitimacy: number;
  claimsVsEvidence: "consistent" | "partially_consistent" | "contradicts" | "unverifiable";
  anomalies: Anomaly[];
  missing: MissingInfo[];
  rationale: string;
  latencyMs?: number;
}

export interface RuleTrace {
  rule: string;
  fired: boolean;
  detail: string;
}

export interface Decision {
  verdict: Verdict;
  headline: string;
  confidence: number; // 0..1
  risk: number; // 0..100
  expectedLoss: number; // USD
  reversibility: Reversibility;
  evidence: Evidence[];
  missing: MissingInfo[];
  anomalies: Anomaly[];
  policyViolations: string[];
  /** For ask: the question. For defer: the re-check condition. For escalate: who + why. */
  nextStep: string;
  effect: string;
  rollback: string;
  rules: RuleTrace[];
  model: ModelSignals;
}

export interface AuditRecord {
  id: string;
  ts: string;
  input: ProposedAction;
  domain: DomainAssessment;
  decision: Decision;
  engineVersion: string;
  prevHash: string;
  hash: string;
}

/** Recently executed actions, used for cross-action signals (velocity / salami attacks). */
export interface LedgerEntry {
  ts: string;
  domain: Domain;
  action: string;
  actorId: string;
  subject: string; // e.g. customer id, service name
  amount?: number;
  verdict: Verdict;
}
