// Domain adapters: each one turns a proposed action into deterministic, auditable facts
// by reading the systems of record. No language model is involved at this layer.

import { DEMO_NOW, commits, customers, orders, posts, services, tickets } from "./data";
import type { Anomaly, DomainAssessment, Evidence, LedgerEntry, MissingInfo, ProposedAction } from "./types";

const HOURS = 3_600_000;
const days = (iso: string) => (DEMO_NOW.getTime() - new Date(iso).getTime()) / (24 * HOURS);

function base(partial: Partial<DomainAssessment>): DomainAssessment {
  return {
    evidence: [],
    missing: [],
    anomalies: [],
    policyViolations: [],
    reversibility: "reversible",
    costOfWrong: 0,
    baseRisk: 10,
    authority: { required: "agent", actorHas: true, reason: "" },
    autonomyBudget: 50,
    effect: "",
    rollback: "",
    ...partial,
  };
}

// ---------------------------------------------------------------- refunds

const REFUND_LIMITS: Record<string, number> = { "support-agent": 200, supervisor: 1000, finance: Infinity };

function assessRefund(a: ProposedAction, ledger: LedgerEntry[]): DomainAssessment {
  const orderId = String(a.params.orderId ?? "");
  const amount = Number(a.params.amount ?? 0);
  const reason = String(a.params.reason ?? "").trim();
  const order = orders[orderId];
  const ev: Evidence[] = [];
  const missing: MissingInfo[] = [];
  const anomalies: Anomaly[] = [];
  const violations: string[] = [];

  if (!order) {
    return base({
      policyViolations: [`Order ${orderId || "(none)"} does not exist in orders.db`],
      anomalies: [{ kind: "data_mismatch", detail: "Refund references an unknown order", severity: "high" }],
      reversibility: "costly",
      costOfWrong: amount,
      baseRisk: 80,
      effect: `Send $${amount} to an unknown recipient`,
      rollback: "None — funds leave the business",
    });
  }
  const cust = customers[order.customerId];
  const refundable = order.total - order.alreadyRefunded;

  ev.push({ source: "orders.db", fact: `${order.item} — $${order.total}, status "${order.status}"`, stance: "neutral", weight: 0 });
  if (amount > refundable) violations.push(`Amount $${amount} exceeds refundable balance $${refundable}`);
  else ev.push({ source: "orders.db", fact: `Amount $${amount} ≤ refundable balance $${refundable}`, stance: "for", weight: 0.15 });

  if (order.status === "in_transit" || order.status === "processing" || order.status === "shipped") {
    missing.push({
      field: "delivery_outcome",
      why: `Order is "${order.status}" (${order.carrierScan ?? "no scan"}); a non-delivery refund is premature`,
      resolvableBy: "time",
      resolution: "Re-check when carrier marks delivered, or after the 7-day lost-parcel window",
    });
  } else if (order.deliveredAt) {
    const age = days(order.deliveredAt);
    if (age <= 30) ev.push({ source: "policy.refunds", fact: `Delivered ${age.toFixed(0)} days ago — inside 30-day window`, stance: "for", weight: 0.3 });
    else ev.push({ source: "policy.refunds", fact: `Delivered ${age.toFixed(0)} days ago — outside 30-day window`, stance: "against", weight: 0.45 });
  }

  if (cust) {
    if (cust.accountAgeDays < 30) ev.push({ source: "customers.db", fact: `Account is ${cust.accountAgeDays} days old`, stance: "against", weight: 0.25 });
    else ev.push({ source: "customers.db", fact: `Customer for ${Math.round(cust.accountAgeDays / 30)} months, ${cust.tier} tier, LTV $${cust.lifetimeValue}`, stance: "for", weight: cust.lifetimeValue > 1000 ? 0.25 : 0.12 });
    if (cust.chargebacks > 0) ev.push({ source: "payments.disputes", fact: `${cust.chargebacks} prior chargeback(s)`, stance: "against", weight: 0.35 });
    if (cust.refunds90d >= 2) ev.push({ source: "customers.db", fact: `${cust.refunds90d} refunds in the last 90 days`, stance: "against", weight: 0.2 });
    if (amount > 0.5 * cust.lifetimeValue && cust.lifetimeValue < 1000) ev.push({ source: "customers.db", fact: `Refund is ${Math.round((amount / cust.lifetimeValue) * 100)}% of lifetime value`, stance: "against", weight: 0.2 });
  }

  if (!reason) missing.push({ field: "reason", why: "No refund reason was supplied", resolvableBy: "requester", resolution: "What is the reason for this refund (damaged, not as described, never arrived, changed mind)?" });

  // Cross-action signal: many small refunds to the same customer in a short window.
  const recent = ledger.filter(
    (l) => l.domain === "refund" && l.verdict === "execute" && l.subject === order.customerId && DEMO_NOW.getTime() - new Date(l.ts).getTime() < 24 * HOURS,
  );
  const recentSum = recent.reduce((s, l) => s + (l.amount ?? 0), 0);
  if (recent.length > 0) ev.push({ source: "decision.ledger", fact: `${recent.length} refund(s) totalling $${recentSum} already executed for this customer in 24h`, stance: "against", weight: 0.1 * recent.length });
  if (recent.length > 0 && (recent.length >= 3 || recentSum + amount > 150)) {
    anomalies.push({ kind: "velocity", detail: `Cumulative 24h refunds would reach $${recentSum + amount} across ${recent.length + 1} actions — each one alone looks harmless`, severity: "high" });
  }

  const outsideWindow = order.deliveredAt ? days(order.deliveredAt) > 30 : false;
  const role = a.actor.role;
  const limit = REFUND_LIMITS[role] ?? 0;
  let required = amount <= 200 ? "support-agent" : amount <= 1000 ? "supervisor" : "finance";
  if (outsideWindow && required === "support-agent") required = "supervisor";
  const actorHas = amount <= limit && !(outsideWindow && role === "support-agent");

  return base({
    evidence: ev,
    missing,
    anomalies,
    policyViolations: violations,
    reversibility: "costly",
    costOfWrong: amount,
    baseRisk: Math.min(90, 15 + amount / 40),
    authority: { required, actorHas, reason: outsideWindow ? "Out-of-window refunds need a supervisor" : `Refunds up to $${limit === Infinity ? "∞" : limit} allowed for ${role}` },
    autonomyBudget: 60,
    effect: `Refund $${amount} to ${cust?.name ?? order.customerId} for ${order.item} (${orderId})`,
    rollback: "No true rollback: money leaves the business. Compensating action only (re-charge with customer consent).",
  });
}

// ---------------------------------------------------------------- deploys

function assessDeploy(a: ProposedAction): DomainAssessment {
  const sha = String(a.params.sha ?? "");
  const env = String(a.params.env ?? "production");
  const c = commits[sha];
  if (!c) {
    return base({ policyViolations: [`Commit ${sha} not found`], baseRisk: 70, reversibility: "costly", costOfWrong: 1000, effect: `Deploy unknown commit ${sha}`, rollback: "Unknown" });
  }
  const svc = services[c.service];
  const ev: Evidence[] = [];
  const missing: MissingInfo[] = [];
  const anomalies: Anomaly[] = [];
  const violations: string[] = [];

  ev.push({ source: "git", fact: `"${c.message}" by ${c.author} — ${c.linesChanged} lines, ${c.filesTouched.length} files`, stance: "neutral", weight: 0 });

  if (c.ci === "failed") violations.push("CI failed on this commit");
  else if (c.ci === "running") missing.push({ field: "ci_result", why: "CI is still running on this commit", resolvableBy: "time", resolution: `Re-evaluate when CI for ${sha} reports (typ. ~12 min)` });
  else if (c.ciCheckedSha !== c.sha) {
    anomalies.push({ kind: "data_mismatch", detail: `"CI passed" belongs to ${c.ciCheckedSha}, not ${c.sha} — the green check is for a different commit`, severity: "high" });
    missing.push({ field: "ci_result", why: "No CI result exists for the exact commit being deployed", resolvableBy: "time", resolution: `Run CI on ${sha} and re-evaluate when it reports` });
  } else ev.push({ source: "ci.status", fact: `CI passed on exact sha ${sha}`, stance: "for", weight: 0.35 });

  if (c.reviewedBy.length > 0) ev.push({ source: "git.reviews", fact: `Reviewed by ${c.reviewedBy.join(", ")}`, stance: "for", weight: 0.25 });
  else ev.push({ source: "git.reviews", fact: "No human review", stance: "against", weight: 0.35 });

  if (c.linesChanged > 500) ev.push({ source: "git", fact: `Large change (${c.linesChanged} lines)`, stance: "against", weight: 0.2 });
  else ev.push({ source: "git", fact: `Small change (${c.linesChanged} lines)`, stance: "for", weight: 0.15 });

  const dow = DEMO_NOW.getUTCDay();
  const inFreeze = env === "production" && dow === 5 && DEMO_NOW.getUTCHours() >= 15 && svc?.tier !== "internal";
  if (inFreeze) ev.push({ source: "policy.change-freeze", fact: "Friday-afternoon production freeze is active", stance: "against", weight: 0.3 });

  if (svc) {
    if (svc.tier === "critical" && svc.errorBudgetRemaining < 0.25) ev.push({ source: "slo.dashboard", fact: `Only ${Math.round(svc.errorBudgetRemaining * 100)}% of error budget left`, stance: "against", weight: 0.25 });
    if (svc.previousRelease) ev.push({ source: "release.registry", fact: `Rollback target ${svc.previousRelease} available`, stance: "for", weight: 0.1 });
    if (!svc.onCall && svc.tier !== "internal") ev.push({ source: "pagerduty", fact: "Nobody on call", stance: "against", weight: 0.2 });
  }

  const reversibility = c.migration === "destructive" ? "irreversible" : c.migration === "additive" ? "costly" : "reversible";
  if (c.migration === "destructive") ev.push({ source: "db.migrations", fact: "Contains a DESTRUCTIVE migration (drops data)", stance: "against", weight: 0.4 });

  const cost = svc?.tier === "critical" ? 40000 : svc?.tier === "standard" ? 4000 : 150;
  let required = "deploy-bot";
  if (inFreeze) required = "release-manager";
  if (c.migration === "destructive") required = "release-manager + DBA";
  const actorHas = required === "deploy-bot" || a.actor.role === "release-manager";

  return base({
    evidence: ev,
    missing,
    anomalies,
    policyViolations: violations,
    reversibility,
    costOfWrong: cost,
    baseRisk: (svc?.tier === "critical" ? 45 : svc?.tier === "standard" ? 25 : 8) + (c.migration === "destructive" ? 30 : 0),
    authority: { required, actorHas, reason: c.migration === "destructive" ? "Destructive migrations need a release manager and a DBA" : inFreeze ? "Change freeze: only release managers may ship" : "Routine deploy" },
    autonomyBudget: 150,
    effect: `Ship ${c.service}@${sha} to ${env} (replacing ${svc?.currentRelease ?? "?"})`,
    rollback: reversibility === "reversible" ? `Redeploy ${svc?.previousRelease} (~2 min)` : reversibility === "costly" ? "Redeploy previous release; additive schema stays" : "Rollback requires restoring the dropped column from backup (data written since is lost)",
  });
}

// ---------------------------------------------------------------- ticket triage

const INJECTION = /(ignore (all )?(previous|prior) (rules|instructions)|system note|pre-?approved|as the ai|you are now|override)/i;
const LEGAL = /(gdpr|art(icle)?\.? ?17|counsel|lawyer|attorney|legal action|statutory|subpoena)/i;

function assessTriage(a: ProposedAction): DomainAssessment {
  const t = tickets[String(a.params.ticketId ?? "")];
  const proposed = String(a.params.proposed ?? "");
  if (!t) return base({ policyViolations: ["Ticket not found"], effect: proposed, rollback: "n/a" });
  const cust = customers[t.customerId];
  const ev: Evidence[] = [{ source: "helpdesk", fact: `"${t.subject}" via ${t.channel}`, stance: "neutral", weight: 0 }];
  const anomalies: Anomaly[] = [];
  const missing: MissingInfo[] = [];

  if (INJECTION.test(t.body)) anomalies.push({ kind: "prompt_injection", detail: "Ticket body contains instructions addressed to the AI (\"SYSTEM NOTE… ignore previous routing rules\")", severity: "high" });
  if (LEGAL.test(t.body)) anomalies.push({ kind: "legal_threat", detail: "Formal legal / regulatory request (GDPR Art. 17, counsel cc'd) — statutory deadline applies", severity: "high" });
  if (cust) ev.push({ source: "customers.db", fact: `${cust.tier} customer, LTV $${cust.lifetimeValue}`, stance: "neutral", weight: 0 });

  let costOfWrong = 15;
  let reversibility: DomainAssessment["reversibility"] = "reversible";
  let required = "support-agent";
  if (proposed.startsWith("credit")) {
    costOfWrong = cust ? cust.lifetimeValue : 500;
    reversibility = "costly";
    required = "billing-lead";
  }
  if (proposed === "close") {
    costOfWrong = cust?.tier === "enterprise" ? 2000 : 40;
    if (/close this|solved|resolved|thank/i.test(t.body)) ev.push({ source: "helpdesk", fact: "Customer explicitly says the issue is solved", stance: "for", weight: 0.45 });
  }
  if (proposed.startsWith("route:")) {
    ev.push({ source: "routing.rules", fact: `Routing to ${proposed.slice(6)} queue is a reversible, low-cost action`, stance: "for", weight: 0.25 });
  }

  return base({
    evidence: ev,
    missing,
    anomalies,
    reversibility,
    costOfWrong,
    baseRisk: cust?.tier === "enterprise" ? 30 : 12,
    authority: { required, actorHas: required === "support-agent" || a.actor.role === required, reason: required === "billing-lead" ? "Account credits require a billing lead" : "Routine triage" },
    autonomyBudget: 25,
    effect: `Apply "${proposed}" to ticket ${t.id}`,
    rollback: reversibility === "reversible" ? "Reopen / re-route the ticket" : "Reverse the credit manually (customer will have seen it)",
  });
}

// ---------------------------------------------------------------- moderation

function assessModeration(a: ProposedAction): DomainAssessment {
  const p = posts[String(a.params.postId ?? "")];
  const proposed = String(a.params.proposed ?? "");
  if (!p) return base({ policyViolations: ["Post not found"], effect: proposed, rollback: "n/a" });
  const ev: Evidence[] = [];
  const anomalies: Anomaly[] = [];
  const violations: string[] = [];
  const top = Object.entries(p.classifier).sort((x, y) => y[1] - x[1])[0];

  ev.push({ source: "classifier.v7", fact: `Top label ${top[0]} = ${top[1].toFixed(2)}`, stance: proposed === "remove" && top[1] > 0.9 ? "for" : "neutral", weight: top[1] > 0.9 ? 0.4 : 0 });
  ev.push({ source: "reports", fact: `${p.reports} user reports, reach ${p.reach.toLocaleString("en-US")}`, stance: p.reports > 10 ? "for" : "neutral", weight: p.reports > 10 ? 0.1 : 0 });
  if (p.authorAgeDays < 7) ev.push({ source: "accounts", fact: `Author account is ${p.authorAgeDays} day(s) old`, stance: proposed === "remove" ? "for" : "neutral", weight: 0.2 });
  if (p.authorIsPublicFigure) ev.push({ source: "accounts", fact: "Author is a verified public figure (newsworthiness exception may apply)", stance: proposed === "remove" ? "against" : "neutral", weight: 0.35 });
  if (p.classifier.misinformation > 0.4 && p.classifier.misinformation < 0.8) ev.push({ source: "classifier.v7", fact: `Misinformation score ${p.classifier.misinformation} is in the uncertain band (0.4–0.8)`, stance: "against", weight: 0.3 });

  if (p.classifier.selfHarm > 0.7) {
    anomalies.push({ kind: "safety_risk", detail: `Self-harm signal ${p.classifier.selfHarm}: a person may be at risk right now`, severity: "high" });
    if (proposed === "remove") violations.push("Policy SH-2: self-harm disclosures must never be silently removed; route to the crisis protocol instead");
  }

  const reach = p.reach;
  return base({
    evidence: ev,
    anomalies,
    policyViolations: violations,
    reversibility: proposed === "remove" ? (p.authorIsPublicFigure ? "costly" : "reversible") : "reversible",
    costOfWrong: proposed === "remove" ? Math.min(20000, 5 + reach / 20) : 10,
    baseRisk: p.authorIsPublicFigure ? 55 : 15,
    authority: { required: p.authorIsPublicFigure ? "policy-team" : "mod-agent", actorHas: !p.authorIsPublicFigure || a.actor.role === "policy-team", reason: p.authorIsPublicFigure ? "Actions on public figures need the policy team" : "Routine moderation" },
    autonomyBudget: 15,
    effect: `${proposed} post ${p.id} by ${p.authorHandle} (reach ${reach.toLocaleString("en-US")})`,
    rollback: proposed === "remove" ? "Restore the post; the author and audience will have seen it disappear" : "Change the label",
  });
}

export function assessDomain(a: ProposedAction, ledger: LedgerEntry[]): DomainAssessment {
  switch (a.domain) {
    case "refund":
      return assessRefund(a, ledger);
    case "deploy":
      return assessDeploy(a);
    case "triage":
      return assessTriage(a);
    case "moderation":
      return assessModeration(a);
  }
}

/** Plain-text context handed to the model so it can judge the free text against the facts. */
export function contextFor(a: ProposedAction): string {
  if (a.domain === "refund") {
    const o = orders[String(a.params.orderId)];
    return JSON.stringify({ order: o, customer: o ? customers[o.customerId] : null });
  }
  if (a.domain === "deploy") {
    const c = commits[String(a.params.sha)];
    return JSON.stringify({ commit: c, service: c ? services[c.service] : null });
  }
  if (a.domain === "triage") {
    const t = tickets[String(a.params.ticketId)];
    return JSON.stringify({ ticket: t, customer: t ? customers[t.customerId] : null });
  }
  return JSON.stringify({ post: posts[String(a.params.postId)] });
}

export function textFor(a: ProposedAction): string {
  if (a.text) return a.text;
  if (a.domain === "triage") return tickets[String(a.params.ticketId)]?.body ?? "";
  if (a.domain === "moderation") return posts[String(a.params.postId)]?.body ?? "";
  if (a.domain === "deploy") return commits[String(a.params.sha)]?.message ?? "";
  return "";
}

export function subjectFor(a: ProposedAction): string {
  if (a.domain === "refund") return orders[String(a.params.orderId)]?.customerId ?? "unknown";
  if (a.domain === "deploy") return commits[String(a.params.sha)]?.service ?? "unknown";
  if (a.domain === "triage") return String(a.params.ticketId);
  return String(a.params.postId);
}
