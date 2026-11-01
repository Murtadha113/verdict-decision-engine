# Where decision layers go next: a two-year thesis

**The decision layer will split away from the agent, the same way auth split away from the app.**

Today every agent framework ships its own "guardrails": prompts that say *be careful*, inside the same model that is doing the work. That is like letting the app check its own passwords. Within two years I expect the decision about whether an action may happen to live in a separate, shared service. Many agents will call it, and it will be owned by the people who carry the risk: finance, security, legal. It will not be owned by the people who build the agent.

Three things follow from that.

**1. Autonomy becomes a budget.** "Can the agent do X?" is the wrong question. The useful question is how much expected loss this agent may carry alone, in this domain, today. Budgets will be denominated in money, tied to identities, and earned. An agent with 500 clean decisions gets a bigger budget, and one bad week shrinks it. Trust becomes a ledger.

**2. Models become sensors, and policy stays code.** The winning pattern is a language model that turns messy reality into calibrated signals, plus a deterministic policy that can be versioned, diffed, tested and replayed. Regulators and auditors will ask "why did it do that?". The only acceptable answer is a record that a human can replay, not a chain of thought.

**3. The hard problems move between actions.** Single-action checks are close to solved. The attacks that work are salami-sliced: many harmless steps that add up to harm, and many agents that each stay under a threshold. Decision layers will need memory across actions, actors and organisations. In the end, that means a shared reputation network for agents.

**What stays unsolved:** the plausible lie. A layer can only weigh the evidence it can see. The honest goal is not zero error. It is bounded, visible, attributable error.
