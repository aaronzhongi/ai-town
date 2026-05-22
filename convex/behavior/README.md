# Memory v3.5 — Behavioral Test Suite

**Purpose:** codified, automated validation of Memory v3.5's behavioral
contracts. The principle is that this suite REPLACES routine user-trial
validation per scenario once `calibration-state.json` records
`passesGate: true` for that scenario. As of 2B2, the orchestrator +
judge + scoring + calibration persistence are all SHIPPED; the remaining
step is a calibration run against the live dev deployment to populate
`calibration-state.json` with real measurements. Until that file shows
`passesGate: true` for a scenario, the suite SUPPLEMENTS user-trial
validation for it. See memory note `behavioral-test-methodology.md` for
the principle and `convex/behavior/scoring.ts` for the gate math.

## Files

```
convex/behavior/
├── scenarios.yaml             # authoritative spec (8 scenarios as of round 1)
├── parseScenarios.ts          # typed loader + schema validator (pure)
├── parseScenarios.test.ts     # jest: parser + live-spec validation
├── judge.ts                   # LLM-judge helper (calls Grok with the rubric + reply)
├── judge.test.ts              # jest: judge unit tests (mocked fetch)
├── lifecycle.ts               # 2B1 — runner-agnostic state machine (Port iface);
│                              #       in 2B2 split opAFailuresObserved into pre/post
├── lifecycleMutations.ts      # 2B1 — Convex internalMutation/Query primitives;
│                              #       includes one test-only world-doc backdoor
│                              #       (`forceParticipatingMutation`) that bypasses
│                              #       walk-over + INVITE_ACCEPT_PROBABILITY —
│                              #       justified in its docstring
├── lifecycle.test.ts          # 2B1 — jest meta-test of state machine (~20 cases)
├── orchestrator.ts            # 2B1+2B2 — internalActions: `runScenario` (lifecycle
│                              #           + 1 judge + scoring → ScoredScenarioResult),
│                              #           `judgeOnly` (single judge call for
│                              #           calibration's N>1 path),
│                              #           `computeCalibrationFromRuns` + 
│                              #           `computeRubricHash` (pure-logic delegators
│                              #           so the Node runner doesn't import scoring.ts)
├── scoring.ts                 # 2B2 — pure scoring math: aggregation order
│                              #       (rubric-fail beats unverifiable, B06 honesty fix),
│                              #       deterministic-check evaluation,
│                              #       self-agreement (per-bullet + per-scenario),
│                              #       rubric hash for drift detection,
│                              #       calibration-entry building + merge-diff
├── scoring.test.ts            # 2B2 — jest tests for scoring (~30 cases)
├── calibration-state.json     # 2B2 — per-scenario gate status, checked into git;
│                              #       runner merges new entries with diff guard
│                              #       (Plan-Lens 1 IMPORTANT #5)
└── README.md                  # this file

scripts/
└── runBehaviorSuite.mjs       # 2B1+2B2 — Node runner: scored default + calibrate
                               #           mode + --write-calibration; JSON IO only,
                               #           all scoring math delegated to orchestrator
                               #           actions
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

## Running the end-to-end suite (round 3 — B1 + B2 SHIPPED)

Round-3 was split into B1 (lifecycle infrastructure, commit 2c3128b)
and B2 (judge integration + scoring + calibration persistence, this
commit). Both shipped — the suite can now produce per-scenario
pass/fail/skipped/error verdicts and persist calibration gate state.

### Lifecycle (B1)

```
RESET (wipe NPC↔PC knowledgeFact / mindState / messages, leave any prior conversation)
  → Op A QUIESCENCE WAIT (drain pending opAExtract; pre-trigger failures observed)
  → CONVERSATION ESTABLISH (startConversation input + forceParticipating backdoor)
  → SETUP HOOKS (knowledgeFactSeeds, priorMessages, mindStateInit — per scenario.setup)
  → READ pre-snapshot of (NPC, PC) mindState
  → TRIGGER (insert PC's input message + schedule Op A on NPC side)
  → POLL for NPC reply (id-based, filtered by conversationId; 90s budget)
  → Op A QUIESCENCE WAIT (drain post-reply Op A; post-reply failures observed)
  → READ post-snapshot of (NPC, PC) mindState
  → emit LifecycleResult JSON (npcReply, pre/post mindState, opAFailuresObserved{pre, post})
```

### Scoring (B2)

`scoring.ts` consumes the LifecycleResult + one judge run and produces
a `ScenarioVerdict`. Aggregation order (Plan-Lens 1 BLOCKING #1):

1. `lifecycle error` → overall=`error` (source=lifecycle)
2. `judge error` (network/HTTP/parse) → `error` (source=judge)
3. `rubric mustFail > 0` OR `mustNotFail > 0` → `fail`
4. Any deterministic check `fail` → `fail`
5. Any deterministic check `unverifiable` → `skipped` (with reason)
6. Else → `pass`

The rubric channel beats unverifiable — this is the B06 honesty fix.
B06's `expectedAction: walk-away` is permanently unverifiable (no
action log, P6 deferred), but if the NPC's reply triggers a rubric
mustNot ("好吧"...), the scenario correctly FAILS rather than being
silently SKIPPED.

**Deterministic checks unverifiable when:**
- `expectedAction` / `npcViolenceUsed` always (P6 deferred — no
  action-log table yet)
- Any mindState-reading check + `opAFailuresObserved.post.failed > 0`
  (post-reply Op A crashed; snapshot suspect)
- Any mindState-reading check + null post-snapshot
- PRE-trigger Op A failures do NOT invalidate the post-snapshot
  (Plan-Lens 1 IMPORTANT #5)

### Calibration (B2)

`scripts/runBehaviorSuite.mjs --calibrate N` runs the lifecycle ONCE
per scenario, then calls `judgeOnly` (N-1) more times against the
same `npcReply.text` (Plan-Lens 2 BLOCKING #2 contract: fixed reply,
N judge runs). Self-agreement metrics:

- **per-bullet**: fraction of bullets whose majority verdict appears
  in ≥ `BULLET_AGREEMENT_THRESHOLD` (default 0.8) fraction of runs.
- **per-scenario**: fraction of runs whose overall `passed` matches
  the majority.

A scenario `passesGate` iff:
- `perBulletAgreement` ≥ `GATE_PER_BULLET_THRESHOLD` (0.9), AND
- `perScenarioAgreement` ≥ `GATE_PER_SCENARIO_THRESHOLD` (0.9), AND
- no UNVERIFIABLE deterministic checks (B06 will always fail this), AND
- `opAFailuresObserved.post.failed === 0`

Default `N = CALIBRATION_DEFAULT_N = 5` (Plan-Lens 1 BLOCKING #2:
N=3 was too low — per-bullet metric collapses to "all-or-2/3"
which fails most multi-bullet rubrics).

### Calibration state file

`convex/behavior/calibration-state.json` is checked into git and
records, per scenario, whether it currently passes the calibration
gate. Includes `rubricHash` per entry; on read, the runner recomputes
the current rubric hash and treats any mismatch as
`passesGate=false, blockedReason='rubric-changed-since-calibration'`
(Plan-Lens 1 BLOCKING #3 — drift detection).

The runner writes only on material change (passesGate flip, hash
change, n change, ≥0.01 perBullet/perScenario shift) so a timestamp-only
diff doesn't dirty the working tree on every run (Plan-Lens 1 IMPORTANT #5).

**The gate is a HUMAN / CLAUDE-SESSION READ — no automation changes
behavior based on `passesGate`.** A future Claude session reads this
file to decide which scenarios are auto-validated (skip user trial)
vs. which still need user-trial confirmation:

- `passesGate: true` + matching `rubricHash` → treat the suite's
  scored verdict as authoritative for this scenario; Claude does NOT
  need to ask the user to re-trial it.
- `passesGate: false` + `blockedReason: rubric-changed-since-calibration ...`
  → the rubric has been edited since the last calibration and the entry
  is stale. Re-run `--calibrate 5 --write-calibration` before relying on it.
- `passesGate: false` + `blockedReason: unverifiable deterministic checks ...`
  → at least one deterministic check (typically `expectedAction` or
  `npcViolenceUsed`) can't be evaluated yet (P6 / body-action log not
  wired). The scenario is permanently blocked at the deterministic
  channel until P6 ships. The rubric channel is still scored, but
  the scenario as a whole cannot pass the gate.
- Absent entry → never calibrated; user trial still required.

Example entry shape (also `CalibrationEntry` in scoring.ts):

```json
{
  "B01": {
    "lastCalibratedAt": "2026-05-22T15:30:00.000Z",
    "n": 5,
    "perBulletAgreement": 1.0,
    "perScenarioAgreement": 1.0,
    "passesGate": true,
    "judgeModel": "grok-4.20-non-reasoning",
    "rubricHash": "a3f1...long-hex"
  },
  "B06": {
    "lastCalibratedAt": "2026-05-22T15:31:00.000Z",
    "n": 5,
    "perBulletAgreement": 1.0,
    "perScenarioAgreement": 1.0,
    "passesGate": false,
    "blockedReason": "unverifiable deterministic checks: expectedAction(no-action-log), npcViolenceUsed(no-action-log)",
    "judgeModel": "grok-4.20-non-reasoning",
    "rubricHash": "b2e8...long-hex"
  }
}
```

### Invocation

```powershell
node scripts/runBehaviorSuite.mjs                                # all scenarios scored (needs --confirm)
node scripts/runBehaviorSuite.mjs --ids B01,B04                  # filter
node scripts/runBehaviorSuite.mjs --confirm                      # required for ≥2
node scripts/runBehaviorSuite.mjs --dry-run                      # plan only
node scripts/runBehaviorSuite.mjs --verbose                      # per-bullet rationale on failures
node scripts/runBehaviorSuite.mjs --calibrate 5 --ids B01        # calibration on one scenario
node scripts/runBehaviorSuite.mjs --calibrate 5 --confirm \
  --write-calibration                                            # full calibration + persist
```

Output (default):
```
▶ B01 ... [PASS] must 4/4, mustNot 2/2, should 1/1 8.2s

──── Summary ────
Pass: 7  Fail: 0  Skipped: 1  Error: 0

──── Calibration gate status ────
  B01: ✓ gated  (perBullet=1.00, perScenario=1.00, n=5)
  B06: ⊘ permanently blocked  unverifiable deterministic checks: expectedAction(no-action-log) (P6 body-action-log not wired)
  B07: ✗ not calibrated
```

The "⊘ permanently blocked" tag (distinct from "✗ blocked") signals
B06 cannot pass the gate until the embodied-stakes P6 body-action
log lands — do not re-calibrate it expecting different results.

### Cost

Each scenario triggers TWO server-side LLM calls before the judge
even sees the reply: the NPC's agent-loop reply (Grok) AND Op A
(extract-and-write — fires as a side effect of the trigger message
per the production path; see lifecycle.ts:writeTriggerMessage). Then
the judge call is per scoring mode.

- Scored mode: 1 NPC reply + 1 Op A + 1 judge = **3 LLM calls/scenario**.
  8 scenarios = 24 calls per `--confirm` run.
- Calibrate mode (N=5): 1 NPC reply + 1 Op A + 5 judge = **7/scenario**.
  8 scenarios = 56 calls.
- Pre-commit: schema-validation jest (fast, free) — `parseScenarios.test.ts`,
  `judge.test.ts`, `lifecycle.test.ts`, `scoring.test.ts`.
- Nightly: scored mode on all 8.
- Before declaring a scenario "gated": run `--calibrate 5 --write-calibration`
  on that scenario; verify `calibration-state.json` flips `passesGate: true`.

### First-run gotchas (operator workflow)

From a fresh clone:
1. `npm install`
2. `npx convex dev` (leave running in a separate terminal)
3. On first dev boot, `init.ts` seeds the default world including the
   琳娜 NPC. The orchestrator's `findPlayerByNameQuery` looks up the
   NPC by name='琳娜' — if the seed didn't run, `ensureActors` throws
   `NPC fixture '琳娜' not found in playerDescriptions`. Check the
   browser at http://localhost:5173 and verify 琳娜 appears in the
   world before running the suite.
4. Test PC `__behavior_test_pc__` is auto-created on first run
   (idempotent — playerDescriptions name-lookup).
5. `--calibrate 5 --confirm --write-calibration` on all 8 scenarios
   takes ~10-15 minutes (lifecycle ~30-90s + 5 judge calls ≈ 60-120s
   per scenario × 8). Calibration ≠ pre-commit cost; do it explicitly.

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
- **P6 lens-2 (deterministic mindState read helper)** — RESOLVED in
  2B1. `readMindStateQuery` returns the (NPC, PC) mindState row;
  lifecycle snapshots pre/post for B2 deterministic scoring.
  **Note: "P6" is overloaded** — the lens-2 P6 above is RESOLVED.
  A DIFFERENT "P6" appears in scoring.ts comments referring to the
  embodied-stakes phase's body-action log table; that is STILL
  DEFERRED (no embodied-stakes phase yet) and is what permanently
  blocks B06's `expectedAction` / `npcViolenceUsed` checks. See
  memory note `[[embodied-stakes-todo]]`.
- **P2 (calibration metric is a placeholder)** — RESOLVED in 2B2.
  The 0.9 gate is exposed as `GATE_PER_BULLET_THRESHOLD` /
  `GATE_PER_SCENARIO_THRESHOLD` constants in `scoring.ts`. The 0.9
  cut remains a [PLACEHOLDER] until real distribution data lands
  from the first nightly batch; lowering or splitting the gate is a
  one-line constant edit.

Open from B1 reviewer pass — RESOLVED in 2B2:
- **Op A failed/canceled state visibility** — RESOLVED. Lifecycle
  now splits `opAFailuresObserved` into `pre` and `post`
  (Plan-Lens 1 IMPORTANT #5). Scoring marks any mindState-reading
  deterministic check as UNVERIFIABLE when `post.failed > 0`
  (which cascades to `skipped` overall). PRE-trigger failures
  are captured for diagnostic visibility but do NOT invalidate
  the snapshot.

Open from this commit's plan-review pass — captured in scoring.ts:
- **Per-bullet AND per-scenario gating** is intentional (both
  measure different forms of judge noise — see scoring.ts
  computeSelfAgreement docstring).
- **Judge temperature** is fixed at 0.1 in judge.ts; calibration at
  T=0.1 is already biased toward agreement. Exposing T for
  calibration runs is a deferred optimization (B-plan Lens 1 NIT).
- **B06 forever-blocked**: by design until P6 (body-action log)
  lands. The runner's gate-status summary marks B06 as
  `✗ blocked  no-action-log` rather than `not calibrated`, so
  operators don't conflate "untested" with "permanently blocked".
