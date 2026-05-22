# Memory v3.5 — Behavioral Test Suite

**Purpose:** codified, automated validation of Memory v3.5's behavioral
contracts. Once a scenario is in this suite, Claude is responsible for
running the suite + fixing regressions WITHOUT requiring a user trial
for that specific behavior. User trials are reserved for novel
scenarios, exploration, and end-to-end pre-release smoke tests — NOT
routine validation. See memory note `behavioral-test-methodology.md`.

## Files

```
convex/behavior/
├── scenarios.yaml          # authoritative spec (8 scenarios as of round 1)
├── parseScenarios.ts       # typed loader + schema validator (pure)
├── parseScenarios.test.ts  # jest: parser unit tests + live-spec validation
├── judge.ts                # LLM-judge helper (calls Grok with the rubric + reply)
├── judge.test.ts           # jest: judge unit tests (mocked fetch — no real LLM calls)
└── README.md               # this file
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

## Running the end-to-end suite (round 3 — NOT yet built)

The orchestrator that drives each scenario against a live Convex
deployment is the **next-step deliverable** (separate commit). It will:

1. For each scenario in scenarios.yaml:
   1. Reset the world to the scenario's initial state (per-scenario
      setup hooks TBD — e.g., wipe + seed + send pre-conversation
      messages from context prose).
   2. Send the scenario's `input` as a PC message via writeMessage.
   3. Wait for the NPC reply (poll the messages table for a new
      message from the NPC player).
   4. Call `judgeReply(scenario.rubric, npcReply)`.
   5. Record pass/fail per scenario.
2. Aggregate results + report.

Why this is non-trivial:
- Per-scenario world setup requires precise control of `mindState`,
  `knowledgeFact`, and conversation state. Some scenarios depend on
  prior conversations (e.g. B03 "name persists"). These setup hooks
  need to be expressed alongside each scenario's data.
- Async polling for the NPC reply — the engine processes input on its
  own tick cadence. Need a timeout + heartbeat strategy.
- Cost: each scenario invokes 2 LLM calls (NPC reply + judge). 8
  scenarios × 2 = 16 calls per run. At $0.X per call this is fine
  for nightly but not per-commit.

Recommended cadence once built:
- Pre-commit: run the schema-validation jest (fast, free).
- Nightly: run the full end-to-end suite.
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
  methodology principle + the "REPLACES user-trial" rule.
