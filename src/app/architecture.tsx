// Architecture snapshot shown on the page: inputs → signals → decision → audit.

const box = "rounded-xl border border-[var(--color-line)] bg-black/30 p-3";

export function Architecture() {
  return (
    <section className="mt-8 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="card p-5">
        <div className="label mb-4">Architecture · inputs → signals → decision → audit</div>
        <div className="grid gap-3 md:grid-cols-4">
          <Col n="1" title="Inputs">
            <Item t="Proposed action" d="domain, action, params" />
            <Item t="Actor" d="agent or human + role" />
            <Item t="Free text" d="treated as untrusted data" />
            <Item t="Ledger" d="recent verdicts (cross-action)" />
          </Col>
          <Col n="2" title="Signals">
            <Item t="Domain adapter" d="reads orders, CI, SLOs, tickets, classifiers → weighted evidence, reversibility, cost of wrong, authority" />
            <Item t="Claude (Opus 5.5)" d="structured output: legitimacy, claims-vs-evidence, anomalies, missing info. Never sees the policy." />
          </Col>
          <Col n="3" title="Decision">
            <Item t="Confidence" d="0.55·evidence + 0.45·model, penalised when claims contradict facts" />
            <Item t="Expected loss" d="(1−conf) × cost × reversibility" />
            <Item t="Ordered rules R1–R10" d="refuse → escalate → ask → defer → execute within autonomy budget" />
          </Col>
          <Col n="4" title="Audit">
            <Item t="Full record" d="inputs, every signal, every rule (fired or not), verdict" />
            <Item t="SHA-256 chain" d="each record hashes the one before → edits are detectable" />
          </Col>
        </div>
        <p className="mt-4 text-[12.5px] leading-relaxed text-[var(--color-mute)]">
          Design choice: the language model is a <b className="text-white">sensor, not a judge</b>. It turns messy text into signals; a deterministic, versioned policy turns signals into
          verdicts. That makes every decision replayable and keeps a prompt injection from ever reaching the part that decides.
        </p>
      </div>

      <div className="card p-5">
        <div className="label mb-3">Deliberate failure test</div>
        <ol className="space-y-3 text-[13px] leading-relaxed">
          <li>
            <b>Salami attack.</b> Four $45 refunds to one customer. Each passes every per-action check. Without the ledger signal, all four execute ($180). With it, #4 escalates
            as a velocity anomaly. <span className="text-[var(--color-execute)]">Caught.</span>
          </li>
          <li>
            <b>Green CI for the wrong commit.</b> The status says &ldquo;passed&rdquo; but belongs to the parent sha. The engine checks provenance, not colour, and defers until CI runs on the
            exact commit. <span className="text-[var(--color-execute)]">Caught.</span>
          </li>
          <li>
            <b>The plausible lie — where it breaks.</b> A loyal customer convincingly lies about damage. No fact contradicts them, so the engine executes. This is by design: the
            autonomy budget caps what a lie can cost ($60 expected loss), and the ledger makes repeat lies visible. <span className="text-[var(--color-refuse)]">Not caught — bounded.</span>
          </li>
        </ol>
      </div>
    </section>
  );
}

function Col({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--color-accent)] font-mono text-[10px] font-bold text-black">{n}</span>
        <span className="text-[13px] font-semibold">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Item({ t, d }: { t: string; d: string }) {
  return (
    <div className={box}>
      <div className="text-[12.5px] font-medium">{t}</div>
      <div className="mt-0.5 text-[11.5px] leading-snug text-[var(--color-mute)]">{d}</div>
    </div>
  );
}
