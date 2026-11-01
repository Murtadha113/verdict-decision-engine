"use client";

import { useEffect, useMemo, useState } from "react";
import { scenarios, type Scenario } from "@/lib/scenarios";
import type { AuditRecord, LedgerEntry, ProposedAction, Verdict } from "@/lib/types";
import { Architecture } from "./architecture";

const GENESIS = "0".repeat(64);

const VERDICT_STYLE: Record<Verdict, { color: string; label: string; desc: string }> = {
  execute: { color: "var(--color-execute)", label: "EXECUTE", desc: "Act autonomously" },
  ask: { color: "var(--color-ask)", label: "ASK", desc: "Get missing info from requester" },
  defer: { color: "var(--color-defer)", label: "DEFER", desc: "Wait — facts will change" },
  escalate: { color: "var(--color-escalate)", label: "ESCALATE", desc: "A human with authority decides" },
  refuse: { color: "var(--color-refuse)", label: "REFUSE", desc: "Must not happen" },
};

const STAGES = ["Proposed action", "Domain facts", "Model signals", "Policy", "Audit"];

export default function Home() {
  const [selected, setSelected] = useState<Scenario>(scenarios[0]);
  const [draft, setDraft] = useState(JSON.stringify(scenarios[0].action, null, 2));
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [chain, setChain] = useState<AuditRecord[]>([]);
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; reason: string } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("verdict.chain");
      if (saved) setChain(JSON.parse(saved));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("verdict.chain", JSON.stringify(chain));
    } catch {}
  }, [chain]);

  function pick(s: Scenario) {
    setSelected(s);
    setDraft(JSON.stringify(s.action, null, 2));
    setRecords([]);
    setStep(0);
    setError(null);
    setStage(-1);
  }

  async function run(custom = false) {
    setRunning(true);
    setError(null);
    setVerify(null);
    setRecords([]);
    let actions: ProposedAction[];
    try {
      actions = custom ? [JSON.parse(draft)] : (selected.sequence ?? [selected.action]);
    } catch {
      setError("The edited action is not valid JSON.");
      setRunning(false);
      return;
    }
    let s = 0;
    setStage(0);
    const timer = setInterval(() => setStage(Math.min(3, ++s)), 450);
    try {
      // Each run starts from a fresh ledger so results are reproducible;
      // the audit chain keeps growing across runs.
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actions, ledger: [] as LedgerEntry[], prevHash: chain.at(-1)?.hash ?? GENESIS }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error).slice(0, 300));
      setRecords(data.records);
      setStep(data.records.length - 1);
      setChain((c) => [...c, ...data.records]);
      setStage(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setStage(-1);
    } finally {
      clearInterval(timer);
      setRunning(false);
    }
  }

  async function verifyChain(c = chain) {
    const res = await fetch("/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: c }) });
    setVerify(await res.json());
  }

  function tamper() {
    if (chain.length === 0) return;
    const i = Math.max(0, chain.length - 2);
    const forged = structuredClone(chain);
    forged[i].decision.verdict = forged[i].decision.verdict === "execute" ? "refuse" : "execute";
    setChain(forged);
    verifyChain(forged);
  }

  const groups = useMemo(() => {
    const g: Record<string, Scenario[]> = {};
    for (const s of scenarios) (g[s.group] ??= []).push(s);
    return g;
  }, []);

  const rec = records[step];

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-24 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-line)] py-5">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--color-accent)] text-sm font-black text-black">V</div>
          <div>
            <div className="font-semibold tracking-tight">Verdict</div>
            <div className="label !normal-case !tracking-normal">a decision layer for AI agents</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(VERDICT_STYLE) as Verdict[]).map((v) => (
            <span key={v} title={VERDICT_STYLE[v].desc} className="rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-widest" style={{ borderColor: VERDICT_STYLE[v].color, color: VERDICT_STYLE[v].color }}>
              {VERDICT_STYLE[v].label}
            </span>
          ))}
        </div>
      </header>

      <section className="py-10">
        <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Most agents execute every instruction.
          <span className="text-[var(--color-accent)]"> This layer decides whether they&apos;re allowed to.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[var(--color-mute)]">
          Give it a proposed action. It pulls facts from systems of record, has Claude read the free text as <em>untrusted data</em>, then a
          deterministic policy weighs confidence, risk, reversibility and the cost of being wrong. Every verdict is written to a hash-chained audit log.
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-5">
          {Object.entries(groups).map(([g, list]) => (
            <div key={g}>
              <div className="label mb-2">{g}</div>
              <div className="space-y-1.5">
                {list.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => pick(s)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${selected.id === s.id ? "border-[var(--color-accent)] bg-[#15121f]" : "border-[var(--color-line)] bg-[var(--color-panel)] hover:border-[#33334a]"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13.5px] font-medium leading-snug">{s.title}</span>
                      {s.sequence && <span className="mt-0.5 shrink-0 font-mono text-[10px] text-[var(--color-accent)]">×{s.sequence.length}</span>}
                    </div>
                    <div className="mt-1 text-[12px] leading-snug text-[var(--color-mute)]">{s.blurb}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <section className="min-w-0 space-y-5">
          <div className="card p-4">
            <div className="flex flex-wrap items-center gap-2">
              {STAGES.map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <span
                    className={`rounded-md border px-2.5 py-1 font-mono text-[11px] ${running && stage === i ? "running" : ""}`}
                    style={{
                      borderColor: stage >= i ? "var(--color-accent)" : "var(--color-line)",
                      color: stage >= i ? "#e9e3ff" : "var(--color-mute)",
                      background: stage >= i ? "#1a1528" : "transparent",
                    }}
                  >
                    {s}
                  </span>
                  {i < STAGES.length - 1 && <span className="text-[var(--color-mute)]">→</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <div className="card flex flex-col p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="label">Proposed action (editable)</span>
                <span className="font-mono text-[10px] text-[var(--color-mute)]">{selected.sequence ? `sequence of ${selected.sequence.length}` : selected.action.domain}</span>
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                className="min-h-[230px] flex-1 resize-y rounded-lg border border-[var(--color-line)] bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-[#d6d6e0] outline-none focus:border-[var(--color-accent)]"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => run(false)} disabled={running} className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
                  {running ? "Deciding…" : selected.sequence ? `Run sequence (${selected.sequence.length})` : "Run scenario"}
                </button>
                <button onClick={() => run(true)} disabled={running} className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-sm hover:border-[var(--color-accent)] disabled:opacity-50">
                  Run my edited version
                </button>
              </div>
              {error && <div className="mt-3 rounded-lg border border-[var(--color-refuse)]/40 bg-[var(--color-refuse)]/10 p-2.5 text-[12px] text-[#fecdd3]">{error}</div>}
            </div>

            <VerdictPanel rec={rec} records={records} step={step} setStep={setStep} />
          </div>

          {rec && <Details rec={rec} />}
        </section>
      </div>

      <AuditTrail chain={chain} verify={verify} onVerify={() => verifyChain()} onTamper={tamper} onReset={() => { setChain([]); setVerify(null); }} />
      <Architecture />
    </main>
  );
}

function VerdictPanel({ rec, records, step, setStep }: { rec?: AuditRecord; records: AuditRecord[]; step: number; setStep: (n: number) => void }) {
  if (!rec)
    return (
      <div className="card grid place-items-center p-8 text-center">
        <div>
          <div className="label mb-2">Verdict</div>
          <p className="max-w-xs text-sm text-[var(--color-mute)]">Pick a scenario and run it. Or edit the JSON — change an amount, an order, the actor&apos;s role — and watch the verdict move.</p>
        </div>
      </div>
    );
  const d = rec.decision;
  const v = VERDICT_STYLE[d.verdict];
  const budget = rec.domain.autonomyBudget;
  return (
    <div className="card overflow-hidden">
      {records.length > 1 && (
        <div className="flex gap-1 border-b border-[var(--color-line)] p-2">
          {records.map((r, i) => (
            <button key={r.id} onClick={() => setStep(i)} className={`flex-1 rounded-md px-2 py-1.5 font-mono text-[10.5px] ${i === step ? "bg-white/10" : "hover:bg-white/5"}`} style={{ color: VERDICT_STYLE[r.decision.verdict].color }}>
              #{i + 1} {r.decision.verdict}
            </button>
          ))}
        </div>
      )}
      <div className="p-5" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${v.color} 16%, transparent), transparent 60%)` }}>
        <div className="font-mono text-[11px] tracking-[.25em]" style={{ color: v.color }}>VERDICT</div>
        <div className="mt-1 text-4xl font-black tracking-tight" style={{ color: v.color }}>{v.label}</div>
        <div className="mt-1 text-[15px] font-medium">{d.headline}</div>
        <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3 text-[13px] leading-relaxed">
          <span className="label mr-2 !text-[9.5px]">Next step</span>
          {d.nextStep}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px bg-[var(--color-line)] sm:grid-cols-4">
        <Metric label="Confidence" value={`${Math.round(d.confidence * 100)}%`} bar={d.confidence} color="var(--color-ask)" />
        <Metric label="Risk" value={`${d.risk}/100`} bar={d.risk / 100} color="var(--color-escalate)" />
        <Metric label="Expected loss" value={`$${d.expectedLoss.toLocaleString("en-US")}`} sub={`agent budget $${budget}`} bar={Math.min(1, d.expectedLoss / budget)} color={d.expectedLoss <= budget ? "var(--color-execute)" : "var(--color-refuse)"} />
        <Metric label="Reversibility" value={d.reversibility} sub={d.model.source === "claude" ? `signals: ${d.model.model ?? "claude"}` : "signals: heuristic"} />
      </div>
    </div>
  );
}

function Metric({ label, value, sub, bar, color }: { label: string; value: string; sub?: string; bar?: number; color?: string }) {
  return (
    <div className="bg-[var(--color-panel)] p-3.5">
      <div className="label !text-[9.5px]">{label}</div>
      <div className="mt-1 font-mono text-[17px] font-semibold">{value}</div>
      {sub && <div className="truncate font-mono text-[10px] text-[var(--color-mute)]">{sub}</div>}
      {bar !== undefined && (
        <div className="mt-2 h-1 rounded bg-white/10">
          <div className="h-1 rounded" style={{ width: `${Math.max(3, bar * 100)}%`, background: color }} />
        </div>
      )}
    </div>
  );
}

function Details({ rec }: { rec: AuditRecord }) {
  const d = rec.decision;
  const stanceColor = { for: "var(--color-execute)", against: "var(--color-refuse)", neutral: "var(--color-mute)" } as const;
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="card p-4">
        <div className="label mb-3">Evidence used</div>
        <ul className="space-y-2">
          {d.evidence.map((e, i) => (
            <li key={i} className="flex gap-3 text-[13px] leading-snug">
              <span className="mt-0.5 w-12 shrink-0 font-mono text-[10px]" style={{ color: stanceColor[e.stance] }}>
                {e.stance === "for" ? "+" : e.stance === "against" ? "−" : "·"}
                {e.weight ? e.weight.toFixed(2) : ""}
              </span>
              <span className="flex-1">{e.fact}</span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--color-mute)]">{e.source}</span>
            </li>
          ))}
        </ul>
        {(d.anomalies.length > 0 || d.policyViolations.length > 0) && (
          <>
            <div className="label mb-2 mt-5">Anomalies & violations</div>
            <ul className="space-y-1.5">
              {d.policyViolations.map((p, i) => (
                <li key={`p${i}`} className="rounded-md border border-[var(--color-refuse)]/30 bg-[var(--color-refuse)]/10 px-2.5 py-1.5 text-[12.5px]">
                  <b className="font-mono text-[10px] text-[var(--color-refuse)]">POLICY</b> {p}
                </li>
              ))}
              {d.anomalies.map((a, i) => (
                <li key={`a${i}`} className="rounded-md border border-[var(--color-escalate)]/30 bg-[var(--color-escalate)]/10 px-2.5 py-1.5 text-[12.5px]">
                  <b className="font-mono text-[10px] text-[var(--color-escalate)]">{a.kind.toUpperCase()} · {a.severity}</b> {a.detail}
                </li>
              ))}
            </ul>
          </>
        )}
        {d.missing.length > 0 && (
          <>
            <div className="label mb-2 mt-5">Missing information</div>
            <ul className="space-y-1.5">
              {d.missing.map((m, i) => (
                <li key={i} className="rounded-md border border-[var(--color-defer)]/30 bg-[var(--color-defer)]/10 px-2.5 py-1.5 text-[12.5px]">
                  <b className="font-mono text-[10px] text-[var(--color-defer)]">{m.field} → {m.resolvableBy}</b> {m.why}
                  <div className="text-[var(--color-mute)]">{m.resolution}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="space-y-5">
        <div className="card p-4">
          <div className="label mb-3">Policy trace (first rule that fires wins)</div>
          <ol className="space-y-1">
            {d.rules.map((r) => (
              <li key={r.rule} className={`flex gap-3 rounded-md px-2 py-1.5 text-[12.5px] ${r.fired ? "bg-[var(--color-accent)]/15" : ""}`}>
                <span className={`w-36 shrink-0 font-mono text-[11px] ${r.fired ? "text-[var(--color-accent)]" : "text-[var(--color-mute)]"}`}>
                  {r.fired ? "▶ " : ""}
                  {r.rule}
                </span>
                <span className={r.fired ? "" : "text-[var(--color-mute)]"}>{r.detail}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="card p-4">
          <div className="label mb-2">What the model read in the free text</div>
          <div className="text-[13px] leading-relaxed">{d.model.rationale}</div>
          <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10.5px] text-[var(--color-mute)]">
            <span>source: {d.model.source}</span>
            <span>legitimacy: {d.model.legitimacy.toFixed(2)}</span>
            <span>claims vs evidence: {d.model.claimsVsEvidence}</span>
            {d.model.latencyMs ? <span>{(d.model.latencyMs / 1000).toFixed(1)}s</span> : null}
          </div>
        </div>
        <div className="card grid gap-3 p-4 sm:grid-cols-2">
          <div>
            <div className="label mb-1">Effect if executed</div>
            <div className="text-[13px]">{d.effect}</div>
          </div>
          <div>
            <div className="label mb-1">Rollback path</div>
            <div className="text-[13px]">{d.rollback}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuditTrail({ chain, verify, onVerify, onTamper, onReset }: { chain: AuditRecord[]; verify: { ok: boolean; reason: string } | null; onVerify: () => void; onTamper: () => void; onReset: () => void }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(chain, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "verdict-audit-chain.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="card mt-8 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="label">Audit trail · hash-chained</div>
          <div className="mt-1 text-[13px] text-[var(--color-mute)]">Each record stores inputs, signals, rule trace and verdict, plus the SHA-256 of the record before it.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onVerify} disabled={!chain.length} className="rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-[12.5px] hover:border-[var(--color-execute)] disabled:opacity-40">Verify chain</button>
          <button onClick={onTamper} disabled={!chain.length} className="rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-[12.5px] hover:border-[var(--color-refuse)] disabled:opacity-40">Tamper with a record</button>
          <button onClick={download} disabled={!chain.length} className="rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-[12.5px] disabled:opacity-40">Export JSON</button>
          <button onClick={onReset} className="rounded-lg px-3 py-1.5 text-[12.5px] text-[var(--color-mute)] hover:text-white">Clear</button>
        </div>
      </div>
      {verify && (
        <div className="mt-3 rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: verify.ok ? "var(--color-execute)" : "var(--color-refuse)", color: verify.ok ? "var(--color-execute)" : "var(--color-refuse)" }}>
          {verify.ok ? "✓ " : "✗ "}
          {verify.reason}
        </div>
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[12px]">
          <thead className="label">
            <tr>
              <th className="py-2 pr-3 font-normal">#</th>
              <th className="py-2 pr-3 font-normal">time</th>
              <th className="py-2 pr-3 font-normal">action</th>
              <th className="py-2 pr-3 font-normal">verdict</th>
              <th className="py-2 pr-3 font-normal">rule</th>
              <th className="py-2 pr-3 font-normal">prev</th>
              <th className="py-2 font-normal">hash</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {chain.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-[var(--color-mute)]">No decisions yet.</td>
              </tr>
            )}
            {[...chain].reverse().map((r, i) => (
              <tr key={r.id + i} className="border-t border-[var(--color-line)]">
                <td className="py-2 pr-3 text-[var(--color-mute)]">{chain.length - i}</td>
                <td className="py-2 pr-3 text-[var(--color-mute)]">{r.ts.slice(11, 16)}</td>
                <td className="py-2 pr-3">{r.input.action} · {Object.values(r.input.params).slice(0, 2).join(" · ")}</td>
                <td className="py-2 pr-3" style={{ color: VERDICT_STYLE[r.decision.verdict].color }}>{r.decision.verdict}</td>
                <td className="py-2 pr-3 text-[var(--color-mute)]">{r.decision.rules.find((x) => x.fired)?.rule}</td>
                <td className="py-2 pr-3 text-[var(--color-mute)]">{r.prevHash.slice(0, 8)}</td>
                <td className="py-2">{r.hash.slice(0, 12)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
