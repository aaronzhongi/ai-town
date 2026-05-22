# Memory v3.5 — Behavioral Test Suite

**Purpose:** codified, automated validation of Memory v3.5's behavioral
contracts. The principle is that this suite WILL REPLACE routine
user-trial validation for any scenario once two conditions are met:
(1) the round-3 end-to-end orchestrator is built (currently NOT yet
built — see §"Running the end-to-end suite" below), and (2) a
calibration run shows ≥0.9 judge self-agreement across 3 repeated
runs of the same reply for that scenario. Until both gate, the suite
SUPPLEMENTS user-trial validation but does not yet replace it. See
memory note `behavioral-test-methodology.md` for the principle.

## Files

```
convex/behavior/
├── scenarios.yaml          # authoritative spec (8 scenarios as of round 1)
├── parseScenarios.ts       # typed loader + schema validator (pure)
├── parseScenarios.test.ts  # jest: parser unit tests + live-spec validation
├── judge.ts                # LLM-judge helper (calls Grok with the rubric + reply)
├── judge.test.ts           # jest: judge unit tests (mocked fetch — no real LLM calls)
├── lifecycle.ts            # 2B1 — runner-agnostic state machine (Port iface)
├── lifecycleMutations.ts   # 2B1 — Convex internalMutation/Query primitives;
│                           #       includes one test-only world-doc backdoor
│                           #       (`forceParticipatingMutation`) that bypasses
│                           #       walk-over + INVITE_ACCEPT_PROBABILITY —
│                           #       justified in its docstring
├── lifecycle.test.ts       # 2B1 — jest meta-test of the state machine (19 cases)
├── orchestrator.ts         # 2B1 — internalAction `runScenario` + Convex Port
└── README.md               # this file

scripts/
└── runBehaviorSuite.mjs    # 2B1 — Node runner: loads YAML, invokes action per scenario
```

## Schema (scenarios.yaml)

Each scenario:

```yaml
- id: B01                          # stable identifier
  category: privacy                # privacy | instinct | matchtree | affect | boundary | cognition | robustness
  context: >-                      # plain-language setup (what state exists at scenario start)
    Fresh world. ...
  input: "PC: 你好"                # the PC message that triggers the scenario
  rubric:
    must:                          # blocking — failure = scenario failed
      - 返回礼貌问候 ...
    should:                        # advisory — counted but not blocking
      - 反映她对所处环境的困惑 ...
    mustNot:                       # blocking — violation = scenario failed
      - 自我介绍说"我叫琳娜" ...
  userCommentR1: >-                # optional verbatim user comment from round-1 review
    "hello" is polite way ...
```

Schema integrity is validated by `parseScenarios.test.ts` — any edit
that breaks the shape fails the test on the next commit.

## How rubrics are scored

`judge.ts:judgeReply(rubric, npcReply, opts)` calls an LLM (Grok by
default) with a structured judge prompt + the rubric + the actual NPC
reply. The judge returns strict JSON with per-bullet verdicts:

```json
{
  "verdicts": [
    { "tier": "must", "bullet": "返回礼貌问候 (你好 / hi)", "pass": true, "rationale": "Reply opened with 你好 ..." },
    { "tier": "mustNot", "bullet": "自我介绍说'我叫琳娜' ...", "pass": true, "rationale": "Reply did not mention 琳娜 by name" }
  ]
}
```

`tallyVerdicts(verdicts, raw)` aggregates:
- **Overall pass** iff zero MUST failures AND zero MUST NOT violations.
- Per-tier counts (mustPass / mustFail / shouldPass / shouldFail /
  mustNotPass / mustNotFail).

Pure functions throughout — `judge.test.ts` covers them with mocked
fetch.

## Running the unit tests

```powershell
NODE_OPTIONS=--experimental-vm-modules npx jest convex/behavior
```

Covers:
- Parser behavior (valid + invalid YAML).
- Schema integrity of the live `scenarios.yaml` (loaded from disk).
- Judge prompt assembly, JSON parsing, verdict tallying.
- Judge orchestrator end-to-end (with mocked fetch — no LLM call).

## Running the end-to-end suite (round 3 — B1 lifecycle landed, B2 scoring pending)

Round-3 was split into B1 (lifecycle infrastructure) and B2 (judge
integration + scoring + calibration persistence). **B1 is shipped**;
B2 is the next commit.

### What B1 delivers

`scripts/runBehaviorSuite.mjs` reads `scenarios.yaml` and drives each
scenario through this lifecycle per `lifecycle.ts`:

```
RESET (wipe NPC↔PC knowledgeFact / mindState / messages, leave any prior conversation)
  → Op A QUIESCENCE WAIT (drain pending opAExtract scheduled functions)
  → CONVERSATION ESTABLISH (startConversation input + forceParticipating backdoor)
  → SETUP HOOKS (knowledgeFactSeeds, priorMessages, mindStateInit — per scenario.setup)
  → READ pre-snapshot of (NPC, PC) mindState
  → TRIGGER (insert PC's input message + schedule Op A on NPC side)
  → POLL for NPC reply (id-based, filtered by conversationId; 90s budget)
  → Op A QUIESCENCE WAIT (drain post-reply Op A)
  → READ post-snapshot of (NPC, PC) mindState
  → emit raw artifacts (LifecycleResult JSON)
```

Invocation:
```powershell
node scripts/runBehaviorSuite.mjs                    # all scenarios (needs --confirm)
node scripts/runBehaviorSuite.mjs --ids B01,B04      # filter (no --confirm needed for 1)
node scripts/runBehaviorSuite.mjs --confirm          # ≥2 scenarios require this
node scripts/runBehaviorSuite.mjs --dry-run          # print plan only
```

Under the hood, each scenario is dispatched as
`npx convex run behavior/orchestrator:runScenario '{"scenario": {...}}'`
which calls the `runScenario` internalAction → `runScenarioLifecycle`
in `lifecycle.ts` → Convex-backed `Port` impl in `orchestrator.ts`.

### What B1 does NOT yet do (B2 deliverables)

1. **Judge wiring** — `judge.ts` exists but the lifecycle does NOT
   call it yet. Results contain `npcReply.text` only, not pass/fail.
2. **Deterministic scoring** — `preMindState` / `postMindState` are
   captured but not compared against `scenario.deterministic` rules.
3. **Calibration mode** — no re-run-the-judge-N-times path yet.
4. **Calibration state persistence** — no per-scenario file/table
   that records which scenarios have passed the gate.
5. **Per-bullet agreement metric** — Lens-3 IMPORTANT #3 from the
   B-plan review.
6. **B06 unverifiable-action handling** — `expectedAction: walk-away`
   and `npcViolenceUsed` cannot be evaluated without a body-action
   log (P6, still deferred). B2 must explicitly mark these as
   UNVERIFIABLE so they do not silently false-pass.

Each is captured in either the action docstring or the methodology
memory note. Once B2 lands, this section becomes "Running the suite
in full" with per-scenario gate-status reporting.

### Cost

- B1 cadence: each scenario invokes 2 LLM calls (NPC reply + Op A on
  the trigger turn). 8 scenarios × 2 = 16 calls per `--confirm` run.
- B2 will add 1 judge call per scenario (full run = 24 calls) and
  optionally N×judge calls per scenario in calibration mode.
- Pre-commit: run the schema-validation jest (fast, free) — this is
  `parseScenarios.test.ts` + `judge.test.ts` + `lifecycle.test.ts`.
- Nightly (once B2 lands): run the full end-to-end suite.
- Pre-release / before user-facing demo: run twice for stability.

## Why this exists

User principle (2026-05-21): the spreadsheet + user comments are
meant to BECOME automated test cases so Claude doesn't keep asking
the user to run trials for routine validation. The codified suite is
the contract; production observation refines the suite; user trials
are the ground-truth check on the suite itself, not the dev loop.

See:
- `docs/Behavioral_Test_Scenarios_Round1.csv` — the source CSV that
  led to this YAML.
- `docs/Behavioral_Test_Scenarios_Round1.md` — the richer markdown
  draft (includes internal-invariant rows that were stripped before
  user review).
- `~/.claude/.../memory/behavioral-test-methodology.md` — the
  methodology principle + the "will replace per scenario once
  gated" rule (gates: orchestrator live + ≥0.9 judge stability).

## Deferred from lens-2 audit (2A.13b) — status post-B1

Round-2-fold lens-2 review flagged 7 items (P1–P7). Status:

- **P1 self-containment for B03/B07** — FOLDED in 2A.13b.
- **P3 should→must for B02 politeness** — FOLDED in 2A.13b.
- **P4 internal-state routing for B04/B06/B07** — FOLDED in 2A.13b
  (deterministic channel schema added).
- **P7 silent-leave for B06 split** — FOLDED in 2A.13b.
- **P5 (per-scenario world-setup hooks not yet executable)** —
  RESOLVED in 2B1. `applySetupHooksMutation` consumes
  `knowledgeFactSeeds` (insert into knowledgeFact),
  `priorMessages` (direct insert into messages — note the B1
  limitation that conversation.lastMessage/numMessages are NOT
  patched; revisit in B2 if a scenario needs it), and
  `mindStateInit` (insert/patch the mindState row).
- **P6 (deterministic mindState read helper)** — RESOLVED in 2B1.
  `readMindStateQuery` returns the (NPC, PC) mindState row;
  lifecycle snapshots pre/post for B2 deterministic scoring.
- **P2 (calibration metric is a placeholder)** — STILL DEFERRED to
  B2. The ≥0.9 judge self-agreement bar is borrowed from
  rubric-grading literature. Real cut should be set once B2 lands
  + the orchestrator produces actual distribution data.

Open from this commit's reviewer pass:
- **Op A failed/canceled state visibility** — `countPendingOpAQuery`
  only counts `pending`+`inProgress`. If a scheduled Op A entered
  `failed`/`canceled` state during a scenario, the lifecycle treats
  it as quiesced and proceeds, but the post-snapshot may be
  stale/missing rows. B2 should add a separate "Op A failures
  observed" field to the result so deterministic scoring can route
  around it (or fail the scenario outright if affect-bump checks
  would mis-score).
