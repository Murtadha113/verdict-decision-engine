# Submission notes

## AI tools used
- **Claude Opus 5.5** (via the Anthropic TypeScript SDK) runs inside the product as the signal-extraction stage. It uses structured outputs (Zod schema) at `effort: low`, with server-side refusal fallbacks enabled.
- **Claude Code** was used as a pair programmer to build the codebase.

## Key decisions
- **The model never decides.** It returns signals. A deterministic, ordered policy (R1–R10) decides, so every verdict is replayable and injection-resistant.
- **Expected loss over thresholds.** `(1 − confidence) × cost of being wrong × reversibility factor` is compared against a per-domain autonomy budget. A cheap, reversible action can go ahead on moderate confidence. An irreversible, expensive one cannot, however confident the model is.
- **Who can fix missing info decides the verdict:** the requester (ask), time (defer) or authority (escalate).
- **Cross-action ledger:** the engine sees recent verdicts, which is what catches salami attacks.
- **Hash-chained audit:** each record stores the SHA-256 of the record before it, so tampering is detectable.
- **Fixed demo clock** (Friday 16:40 UTC, inside a change freeze) keeps every scenario reproducible.

## Intentionally out of scope
- **Persistence.** In this demo the audit chain lives in the browser (localStorage + JSON export) and the ledger is passed in per request. In production both would live in an append-only server-side store, because a client-held ledger can be omitted by a malicious caller.
- **Real systems of record.** The data is synthetic but realistic. The domain adapters are the integration seam.
- **Learning budgets.** Autonomy budgets are static numbers here. The thesis argues they should be earned from track record.
- **Authentication of the actor.** The actor's role is taken as given.
