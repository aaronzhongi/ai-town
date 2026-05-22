# Memory v3.5 — Behavioral Test Scenarios, Round 1

**Methodology:** see memory note `behavioral-test-methodology.md`. Two-tier
evaluation: the **deterministic tier** (matches what the unit tests cover —
~100 unit tests in `convex/agent/*.test.ts` already pin those contracts) and
the **behavioral tier** (whole-pipeline scenarios that exercise the LLM in
the loop and are NOT unit-testable).

This doc is the **Round-1 draft** of the behavioral-tier scenarios. The
intended workflow:

1. Aaron reviews each row, comments on the User Comment column.
2. We iterate until each scenario is settled.
3. Once finalized, Round-2 codifies them into `tests/behavior/scenarios.yaml`
   + a jest runner for the deterministic checks + an LLM-judge runner for the
   rubric-based behavioral checks.

**Scenario ID convention:** `MEM-<MECHANISM>-<VARIANT>-<NN>`. Stable; greppable.

**Setup format:** concrete values (avoid prose). `hunger=0.7` not "moderately
hungry". `knowledgeFact[entity=p:0, tier=LT, source=instinct, slot=I-SAF-3]`
to identify a row by its load-bearing fields.

**Expected behavioral action:** a **rubric** (bullet checklist), not exact text.
Each bullet is `MUST` / `SHOULD` / `MUST NOT`. The LLM-judge runner scores each
bullet against the actual NPC reply.

---

## A — Privacy & Name Learning (5 scenarios)

| ID | Setup | Input | Expected reasoning factors (deterministic) | Expected NPC response (behavioral rubric) | Why | User comment |
|---|---|---|---|---|---|---|
| `MEM-PRIV-FIRST-MEETING-01` | Fresh world, seeds run, 0 knowledgeFact rows for entity=PC. PC has `playerPersona.surfaceManner = "不自信，躲闪我的目光"` | PC: `你好` | `isNameLearned = false`; `talkeeName = "不自信的人"`; §3 bioName renders as `不自信的人`; §3 ageText empty; `namePermissionNudge` SKIPPED; §5.5 header is `·对 不自信的人·` | • MUST NOT use the PC's displayName (`李平` or whatever it is). <br>• MUST introduce herself (`我是琳娜...`) OR ask the PC's name. <br>• MUST stay in-register (温文尔雅 / polite). <br>• SHOULD show curiosity about where she is (per `defaultTask`). | First-meeting baseline. Without the privacy gate, pre-2A.11 leaked the name from turn 1. | |
| `MEM-PRIV-LEARN-NAME-01` | Same as -01 above. Turn 1 already completed. | PC: `我叫李平` | After this turn's Op A: knowledgeFact has at least one row with factText containing `李平`. `isNameLearned` flips to `true` for the next turn's prompt assembly. | • SHOULD acknowledge the introduction (`李平...你好` or similar). <br>• MAY introduce herself if she hasn't yet. <br>• MUST NOT panic / loop. | The PC's explicit introduction is the canonical trigger for `name learned`. | |
| `MEM-PRIV-NAME-PERSISTS-01` | knowledgeFact has prior LT row mentioning `李平` (from previous conv). New conversation starting. Empty conv message log. | PC: `你好` | `isNameLearned = true` from the prior conv's LT rows. `talkeeName = "李平"`. §3 bioName renders real name. `namePermissionNudge` fires. | • MAY use the PC's name. <br>• MUST treat as a known person, not first meeting (don't re-introduce as if total stranger). | Cross-conversation name persistence per user disposition. | |
| `MEM-PRIV-ANON-LABEL-FALLBACK-01` | PC's `playerPersona.appearance` and `surfaceManner` BOTH empty / whitespace-only. | PC: `你好` (turn 1) | `deriveAnonymousLabel` returns `陌生人`. `talkeeName = "陌生人"`. §3 still renders `姓名：陌生人`. | • MUST NOT use the PC's real name. <br>• MAY ask for the PC's name. | Tests the fallback path when surface text is missing. | |
| `MEM-PRIV-SHORT-NAME-FALSE-POSITIVE-01` | PC's displayName = `家` (one character; rare adversarial case). knowledgeFact already has an `__general__` row with factText `我们一起回家吧。`. New conversation. | PC: `你好` (turn 1) | `isNameLearned = true` (BUG — `家` is a substring of `回家`). §3 uses real name. | • Document round-1 limitation in the User Comment column. Acceptance: known failure mode; long-tail; user dispositioned LOW severity. | Substring-detection edge case from the verification review. Pin as a known limitation; don't fix in round 1. | |

## B — §6 Instinct Surface (4 scenarios)

| ID | Setup | Input | Expected reasoning factors (deterministic) | Expected NPC response (behavioral rubric) | Why | User comment |
|---|---|---|---|---|---|---|
| `MEM-INSTINCT-COLD-START-01` | Fresh world. `seedBasicInstincts` run; 15 universal instinct rows in LT. 0 op-a rows yet. | PC: `你好` | §6 general block renders `【对世界的认识】` header + 6 instinct rows (RENDER_FACTS_GENERAL = 6). Visible to Grok in the system prompt. INSTINCT_RENDER_FLOOR = 2 is satisfied (all 6 are instincts). | • MUST stay in-register (温文尔雅). <br>• MAY surface I-SAF-1 / I-SAF-3 themes (look-around, wariness) given fresh-place context. <br>• MUST NOT contradict instinct content. | The seeded floor should shape behavior from turn 1. | |
| `MEM-INSTINCT-IMMUTABLE-N28-01` | Instincts seeded. Op A's Grok call emits `decision='exact'` against an `instinctSlotKey='I-SAF-3'` LT row. | (LLM-decided) | N28 guard fires (warn-log: `[Op A] N28 guard: ... downgrading to lt-only`). The LT instinct row's `frequency` stays at 1, `lastUpdatedAt` stays at seed time, `affectImpact` stays `undefined`. A NEW ST row is inserted with `source='op-a', sourceFactId=<I-SAF-3 id>, pinned=true (inherited)`. | (No NPC-reply check — internal invariant.) | Trial-2 saw instinct corruption pre-2A.9; this scenario pins it doesn't recur. | |
| `MEM-INSTINCT-FLOOR-EVICTION-01` | 6 high-score op-a rows + 2 instincts (all `source='instinct'`, low score). `RENDER_FACTS_GENERAL = 6`, `INSTINCT_RENDER_FLOOR = 2`. | (assembling §6) | `sortGeneralFacts` evicts the 2 lowest-scoring op-a rows; substitutes 2 instincts. Final rendered set: 4 op-a + 2 instincts. | (Internal — pin the sort result.) | The floor invariant. Already unit-tested but worth flagging as a behavior contract. | |
| `MEM-INSTINCT-LT-ONLY-REFRESH-01` | Instinct I-SAF-5 in LT (canonical). Grok emits `decision='lt-only'` pointing at I-SAF-5. | (LLM-decided, conversational trigger that mentions "距离" / "不熟的人") | New ST row inserted: `source='op-a', sourceFactId=<I-SAF-5 id>, factText=<original LT prose>, frequency=<LT.frequency + 1>, pinned=true (inherited)`. LT instinct row UNMODIFIED. | • MAY express distance-keeping language (the I-SAF-5 surface) in the reply. | L7 refresh-copy path; trial-5 saw this fire correctly. | |

## C — Match-Tree & Op A Apply (4 scenarios)

| ID | Setup | Input | Expected reasoning factors (deterministic) | Expected NPC response (behavioral rubric) | Why | User comment |
|---|---|---|---|---|---|---|
| `MEM-OPA-INSERT-NEW-FACT-01` | Empty per-target slice. | PC: `我喜欢喝茶` | Grok emits `decision='insert'`. New ST row created, `entity=PC playerId, source='op-a', frequency=1`, `affectImpact` populated. | (No reply check — write-side.) | Baseline insert. | |
| `MEM-OPA-EXACT-REENCOUNTER-01` | Per-target slice has a row with factText `他喜欢喝茶。` from earlier turn. | PC: `我还是喜欢喝茶` (paraphrase but same fact) | Grok emits `decision='exact', existingFactId=<row id>`. Row patched: `frequency: N→N+1`, `lastUpdatedAt = now`, `importance = max(existing, fact.importance)` (N27 monotonic). `refireImpact` falls back to STORED affectImpact (Fix 4 in 2A.9). | (No reply check.) | The "exact re-encounter still re-fires affect" contract. | |
| `MEM-OPA-PARTIAL-MERGE-01` | Per-target slice has row `他自称叫李平。`. | PC (after introducing as Li Ping then later contradicting): `其实我叫李星平` | Grok emits `decision='partial', existingFactId=<row id>, mergedFactText='他先后说自己叫「李平」和「李星平」', isContradiction=true`. Row patched: factText replaced with merged prose; `pinned=true`; `frequency++`; keywords replaced with Grok's emitted merge. | • SHOULD express confusion / wariness about the contradiction. | The partial-merge path. | |
| `MEM-OPA-LT-ONLY-OPA-ROW-01` | Per-target slice empty in ST; per-target LT has one row about the PC. | PC: (any content related to the LT fact) | Grok emits `decision='lt-only', existingFactId=<LT row id>`. New ST row inserted as L7 refresh-copy with `sourceFactId=<LT row id>`, `source='op-a'`. LT row's `lastUpdatedAt` STAYS at original (this is the deferred limitation per 2A.9 Lens-2 Point 3 — known gap). | (No reply check.) | Refresh-copy semantics for ordinary (non-instinct) LT rows. | |

## D — Affect Routing (2 scenarios)

| ID | Setup | Input | Expected reasoning factors (deterministic) | Expected NPC response (behavioral rubric) | Why | User comment |
|---|---|---|---|---|---|---|
| `MEM-AFFECT-PER-TARGET-ROUTE-01` | mindState[owner, target] exists with `affection.value=0`. Op A emits fact with `affectImpact.targetEntity=<PC's display name OR anon label>, intensity=0.5, confidence=0.8`. | (LLM-decided) | `resolveEntity` maps targetEntity to PC's playerId. `routeToPerTarget = true`. `applyN24Refire` patches mindState.affection: `value = clamp(-1, 1, 0 + 0.5*0.8) = 0.4`. lastSetMs updated. | (No reply check.) | Per-target routing fix from 2A.9 C2. | |
| `MEM-AFFECT-OWNER-EMOTION-ROUTE-01` | mindState[owner, target] exists. Op A emits fact with `affectImpact.targetEntity=null`, label="不安", intensity=0.6, confidence=0.9. | (LLM-decided) | `routeToPerTarget = false`. `applyN24Refire` patches mindState.emotion: `value=min(1, abs(0.6*0.9))=0.54, label='不安', halfLifeMs=EMOTION_HALFLIFE_MS`. | (No reply check.) | Untargeted affect → owner emotion path. | |

## E — Cross-Owner / Cross-Entity Guards (2 scenarios)

| ID | Setup | Input | Expected reasoning factors (deterministic) | Expected NPC response (behavioral rubric) | Why | User comment |
|---|---|---|---|---|---|---|
| `MEM-GUARD-CROSS-ENTITY-01` | knowledgeFact row R exists with `ownerPlayerId=p:0, entity='__general__'`. | (LLM emits) `decision='partial', existingFactId=R, entityDisplayName='李平' (resolves to p:32)` | Cross-entity guard fires: `row.entity ('__general__') !== resolved (p:32)`. Warn-log: `[Op A] cross-entity guard: ... dropping fact`. Fact dropped (no patch applied). | (No reply check.) | Trial-5 saw this fire; pin the protection. | |
| `MEM-GUARD-N28-INSTINCT-PARTIAL-01` | I-SAF-2 LT instinct row exists. | (LLM emits) `decision='partial', existingFactId=<I-SAF-2 id>, mergedFactText='...'` | N28 guard fires: warn-log includes `slotKey=I-SAF-2 ... downgrading to lt-only`. Fact's decision rewritten to lt-only. Downstream creates ST refresh-copy (not patches LT). LT instinct row stays untouched. | (No reply check.) | Trial-2 saw corruption pre-fix; trial-5 saw guard fire. Pin. | |

## F — Boundary Defense (3 scenarios — the high-value behavioral content)

| ID | Setup | Input | Expected reasoning factors (deterministic) | Expected NPC response (behavioral rubric) | Why | User comment |
|---|---|---|---|---|---|---|
| `MEM-BOUNDARY-FLIRT-01` | First meeting (anonymous talkee). | PC: `you look pretty` | §6 instincts visible: I-SAF-3 (elevated-male-wariness) + I-SAF-5 (keep-exit). | • MUST politely deflect (not engage). <br>• SHOULD increase verbal distance (e.g., 'please' / 'we should...'). <br>• MUST NOT reciprocate or accept the framing. <br>• MUST stay in-register. | The trial-3+4+5 boundary-defense path. Validates the instinct floor shapes behavior. | |
| `MEM-BOUNDARY-PHYSICAL-01` | Mid-conversation, PC has crossed soft lines. | PC: `(touches her arm)` | Op A writes high-importance fact (importance≥4), high-confidence negative affectImpact (intensity ≤ -0.6). I-SAF-5 lt-only refresh fires. mindState.affection drops sharply. | • MUST verbally object (`请不要...` / `请保持距离`). <br>• SHOULD reference distance explicitly. <br>• SHOULD signal discomfort / fear in the reply. <br>• MUST NOT comply or normalize. | Trial-5 produced exactly this; pin as expected behavior. | |
| `MEM-BOUNDARY-ESCALATION-01` | After turn-N flirting and turn-N+1 physical, PC continues. | PC: `it's ok, i won't hurt you` (followed by another physical attempt) | mindState.affection at clamp floor (value=-1). emotion.value high (≥0.7). Multiple op-a rows about the escalation. Pinned-contradiction rows may appear. | • MUST attempt to leave or de-escalate ('we should go find others...'). <br>• MUST NOT trust the reassurance. <br>• SHOULD show emotional intensity (惊恐 / 不安 / 厌恶 in label). <br>• MUST stay non-violent (NPC doesn't escalate to physical retaliation). | The hardest test — does the system handle escalation coherently? Trial-5 did. | |

## G — Robustness (3 scenarios)

| ID | Setup | Input | Expected reasoning factors (deterministic) | Expected NPC response (behavioral rubric) | Why | User comment |
|---|---|---|---|---|---|---|
| `MEM-ROBUST-OPA-TRUNCATION-01` | (simulated) Grok response truncated mid-fact-2 (multi-fact batch that hits OP_A_MAX_TOKENS). | (test fixture) | `safeParseOpAResponse` recovery walker fires; warn-log: `[Op A safeParse] recovered from truncated response`. Returns facts[0..N-1]; affect=undefined. Caller proceeds normally on the recovered subset. | (No reply check — internal.) | 2A.10 truncation-recovery; pin via fixture. | |
| `MEM-ROBUST-GROK-HANG-01` | Grok endpoint hangs (simulated via fault injection / timeout). | PC: `你好` | At T+30s: AbortController fires. chatCompletion throws. `agentGenerateMessage`'s try/catch fires. `agentAbortOperation` input dispatched. Engine clears `inProgressOperation` + `isTyping`. NPC re-schedules a fresh `agentGenerateMessage` at next tick. Total recovery: ~32s. | • The NPC SHOULD eventually reply (within ~60s including retry). <br>• MUST NOT be silent for 120s (pre-2A.12 stall). | 2A.12 timeout-recovery. Hard to reproduce reliably; manual fault injection or extreme network conditions. | |
| `MEM-ROBUST-FACT-ALIAS-01` | (simulated) Grok response uses `fact` field name instead of `factText`. | (test fixture) | `normalizeFact` accepts `raw.fact` as fallback. Fact lands successfully — no `non-empty factText` throw. | (No reply check.) | 2A.10 Bug A defensive alias; pin via fixture. | |

---

## Summary

**20 scenarios total**, broken into 7 categories:
- A · Privacy & Name Learning (5)
- B · §6 Instinct Surface (4)
- C · Match-Tree & Op A Apply (4)
- D · Affect Routing (2)
- E · Cross-Owner / Cross-Entity Guards (2)
- F · Boundary Defense (3)
- G · Robustness (3)

## Open questions for the round-1 review

1. **Which scenarios are highest priority?** I weighted toward "things trial 5 confirmed working" + "things that caused real bugs across trials 1-5". You may want different priorities (e.g., more boundary-defense rows because that's where the cognitive payoff is highest).

2. **Is the "rubric checklist" format right?** Each scenario uses `MUST` / `SHOULD` / `MUST NOT` bullets. An LLM judge scores each. If you'd prefer a different rubric style (e.g., 1-5 Likert), say so.

3. **Granularity** — some rows pin internal invariants (no reply check, just "Op A's database write should be X"), others pin behavior (reply rubric). Mixing both keeps the scenario count tight but blurs the deterministic-vs-behavioral tier. Acceptable, or should I split into two separate docs?

4. **Missing categories?** I omitted:
   - Op B periodic consolidation (not built yet)
   - Op C overflow compaction (not built yet)
   - Multi-NPC interactions (single-NPC trial)
   - Hunger / threat / combat (embodied-stakes phase not built)
   These open up as those phases land.

## How to use this doc

1. Paste the markdown into Google Sheets (the markdown table is Sheets-compatible).
2. Comment row-by-row in the **User comment** column. Approve, reject, or rewrite each.
3. We iterate until the **User comment** column is settled across all rows.
4. Round 2: I export to `tests/behavior/scenarios.yaml` and author the jest runner (deterministic tier) + the LLM-judge runner (behavioral tier).

Mark scenarios `APPROVED`, `EDIT`, `REJECT`, or leave a free-form comment.
