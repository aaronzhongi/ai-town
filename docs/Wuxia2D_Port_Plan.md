# 射雕 2D — AI Tavern → ai-town Port & Battle Plan (v4)

**Status:** v4 — **CONSENSUS-APPROVED, ready for implementation.** R1
REQUEST CHANGES → R2 all APPROVE (v2); v3 folded the user
**defeat/death/coercion** scope change; R3 = world-lore APPROVE,
jynew/ai-town/existing-extension REQUEST CHANGES; v4 folded every R3
must-fix → **R4 all 4 lenses APPROVE**. Audit trail §11. Awaiting user
go-ahead.

**One-line:** Bring the jynew "AI Tavern" AI-dialog + layered-memory + 射雕
lore *home* to ai-town's low-art 2D TS/Convex engine, and re-implement
jynew's turn-based wuxia battle natively in TS — a workable small 2D
wuxia-RPG with AI-driven NPCs and faithful combat.

**User decisions locked (2026-05-18) — not relitigated:**
1. Battle = wuxia-faithful (port jynew battle *data* + the speced INV-8
   design; re-implement, don't copy C#).
2. World = small 射雕 town (the canon-backed roster — see §0.3 fix R3-1).
3. Memory = port jynew Phase 3 layered memory (no embeddings) into TS.

---

## 0. The core insight (a *homecoming*, not a fresh port)

jynew's AI Tavern Phase 1 was authored as a C# re-port of an ai-town-style
agent FSM. ai-town's `convex/aiTown/agent.ts` + `conversation.ts` is a
self-consistent, native implementation of that same FSM. **Provenance
note (ai-town-lens MUST-FIX 4):** we do *not* assert ai-town's code is the
literal upstream of jynew's C# — that is unverifiable from this repo. The
load-bearing claim is weaker and sufficient: ai-town already contains a
native, structurally-equivalent agent/conversation FSM, so re-porting
jynew's Phase 1 FSM into ai-town would be redundant. Buckets:

| Bucket | What | ai-town disposition |
|---|---|---|
| **A. Already native** | Agent tick FSM, conversation FSM, 3 operations, participatedTogether, inputs/engine loop | **KEEP ai-town's.** Do not re-port. Extend only candidate-selection + prompt language. |
| **B. Port back (TS rebuild)** | AITavern §3.6 interest-weighted selection + RelationshipGraph; Phase 3 layered memory (WorldCodex/Bio/Dossier/RuntimeMindState/ContextAssembler/reflection/decay); the 射雕 lore JSON | Rebuild in TS per the reviewer-validated jynew Phase 3 plan, adapted to Convex idioms. Replace `convex/agent/memory.ts` embedding path. |
| **C. Build new** | 2D turn-based wuxia battle + INV-8 hostility→combat→death/drop/faction bridge | New in-engine battle subsystem (§5), re-implementing jynew battle math verbatim. **INV-8 has no reference code anywhere** (jynew never built it) — `aitavern_invariants.md` INV-8 ids are the sole source of truth and are cited verbatim in Phase-4 tasks. |

The lore pipeline (Python `xai-sdk`, offline) **stays in jynew, is not
re-run** (jynew Phase 3 §0). We consume its committed output verbatim.
The Unity `LoreImporter.cs` is replaced by a Convex seed.

---

## 1. Target architecture (where each piece lands)

### 1.1 Engine model — battle is an *in-engine ticked subsystem* (ai-town-lens MUST-FIX 1 & 2)

There is exactly one engine per world (`worldStatus.engineId`); `runStep`
self-reschedules; the only stop levers are `stopEngine` and the
generation-number bump (`main.ts`). A generation bump does **not** suspend
(it cancels the run; nothing restarts it). Therefore **there is no
"suspend the world, spin up a second battle engine" mechanism — that is
the nested-engine the plan must avoid.**

Adopted mechanism: **battle is a `Battle` subsystem ticked inside the
existing `Game.tick`** (alongside `Conversation.tick` / `Agent.tick`),
gated by a world-level `mode: 'social' | 'battle'` field in the
*serialized world*. When `mode === 'battle'`, `Agent.tick` and
`Conversation.tick` early-return; `Player.tickPathfinding` /
`tickPosition` are also gated (or are provably benign — frozen positions
just historical-buffer in place); only `Battle.tick` advances. Battle
math is pure/synchronous → fits the single-threaded tick. No second
engine, no second scheduler, no `stopEngine` choreography.

**Battle-state placement (resolves the R1/§6.2 contradiction):**
- The **active battle's transient state** (grid occupancy, turn queue,
  per-combatant HP/MP/Hurt/Poison/Tili/Pos ints) lives in the `worlds`
  doc as a single small `battle?: SerializedBattle` field, advanced
  in-tick. It is a handful of combatants × ~20 ints — well within the
  "few dozen KB, diff-saved every step" budget (ARCHITECTURE.md). It is
  **absent** (undefined) outside battle, so the social-only world doc is
  unchanged in size.
- **Durable battle artifacts** (result, exp, death records, drops) are
  written to `convex/battle` / `convex/agent` tables at battle teardown
  via normal `inputs` (the engine-owns-its-tables rule: outside code
  mutates engine state only via inputs; operations never write game
  state directly).
- The world→battle round-trip does **not** snapshot agent positions —
  positions already live in the world doc + historical buffers; the
  round-trip reuses them.

### 1.2 State-placement rule (engine-small) — reinforced

RuntimeMindState (10-turn ring, affect, per-pair reflection), lore
(WorldCodex/Bio/Dossier), durable battle artifacts, **and inventory**
(PC + NPC item state — itself net-new, see §6.4) **never** live in the
`worlds` doc — they live in `convex/agent` / `convex/battle` tables,
read/written inside operations (`internalAction`s that write back via
inputs), exactly as `memory.ts` does today. The only engine-doc additions
are (a) the transient `battle?` field above (§1.1) — present only during
combat **and its teardown disposition**: it carries an explicit
`phase: combat → pendingDisposition → teardown` (§6.4) so it remains a
closed, bounded addition, not an open-ended one — and (b) a per-agent
`subdued?: { until: number }` field (§6.5) — a single optional object,
the size class of the existing `lastConversation`/`activity` fields —
because it gates `Agent.tick` and must therefore be engine-visible (it
cannot live in a `convex/agent` table the engine can't read). Both are
bounded and absent/empty in steady-state social play; the size-budget
test covers the `pendingDisposition` phase too. A test asserts the
social-mode
`worlds` doc stays within budget.

### 1.3 LLM / operations rule — unchanged

All Grok calls (dialogue, reflection, hostility sidecar) happen in
`internalAction` operations that write back via `inputs`, never in
`tick`. Turn-based input latency (~1.5s round-trip, ARCHITECTURE.md) is
acceptable for a turn-based battle — this is *why* a turn-based design is
viable here where real-time would not be.

```
convex/aiTown/{agent,conversation}.ts   KEEP FSM; + world.mode gate
convex/aiTown/battle.ts                  NEW Battle subsystem (ticked in Game.tick)
convex/aiTown/world.ts/schema.ts         + mode + transient battle? field
convex/agent/{memory,conversation}.ts    REPLACE embedding path → layered memory
convex/agent/{contextAssembler,mindState,lore}.ts  NEW
convex/agent/schema.ts                   REPLACE memoryEmbeddings → mindState + lore
convex/battle/{rules,damage,hostility}.ts + data/  NEW (jynew math verbatim)
convex/util/llm.ts                        Grok branch; embeddings OFF (guard)
data/characters.ts + data/lore/           射雕 roster (f1–f8 reuse); lore JSON
src/components/                           + battle Pixi view (plain useQuery)
```

---

## 2. Phase 0 — Foundations

| T | Task | Detail |
|---|---|---|
| 0.1 | **LLM provider** | `convex/util/llm.ts`: add a Grok/xAI branch (`https://api.x.ai/v1`, model `grok-4*`), env-driven. **Guard:** the existing custom-`LLM_API_URL` path requires `LLM_EMBEDDING_MODEL` and `detectMismatchedLLMProvider` (`init.ts`) throws otherwise — remove/guard that check since embeddings are off. Keep `chatCompletion` signature stable. |
| 0.2 | **Lore ingestion** | Copy `jynew/tools/lore_pipeline/out/{world,bios,dossiers}.json` → `ai-town/data/lore/`. Convex seed replicates the `JSON_CONTRACT.md` **asymmetry**: `world.json` = full (re)write of WorldCodex; `dossiers.json` = full (re)write per agent; `bios.json` = **PATCH-only** (the 5 Phase-3 fields; never clobber hand-authored identity/plan). |
| 0.3 | **Roster — exactly the 4 canon-backed NPCs** *(world-lore MUST-FIX 1)* | The pipeline `ROSTER` / `bios.json` / `dossiers.json` contain **exactly 4**: `huangrong, ouyangke, guojing, munianci`. The roster is **locked to these 4**. The earlier "4–6 / +完颜康/丘处机 optional" is **struck**: 完颜康/丘处机 exist only as dossier *targets* in `NOTABLE_SET`, with no first-person bio/dossier; promoting them would fabricate runtime "canon" with no novel-scan provenance, and §0 forbids re-running the pipeline. Per NPC: a `data/characters.ts` `Descriptions` entry (sprite from f1–f8 — **zero new art**), identity/plan seeded from bios+dossiers via the `createAgent` input path, **and** a battle stat block (own `convex/battle` table keyed by agentId — it cannot ride on `createAgent`). |
| 0.4 | **Maps (no new art)** | A small 射雕 市镇/客栈 town map + one battle-grid map via `src/editor/` + shipped tilesets. Town co-presence of the 4 is **explicitly designer-fiction** (§4 / world-lore MUST-FIX 4), not canon. |
| 0.5 | **Test scaffold** | Jest (`npm test`). Suites: battle-math golden vectors (vs. hand-computed jynew Lua), memory/ContextAssembler, candidate-selection, hostility parse. 3 layers: pure-TS unit / Convex integration / scenario. |

### 0.6 Canon-provenance invariant *(world-lore MUST-FIX 2)*

**No agent is instantiated as a 射雕 NPC unless it has a matching entry in
BOTH committed `bios.json` AND `dossiers.json`.** The seed asserts this
and **fails closed** (refuses to seed an NPC missing either). An NPC with
an `agentDescription` but no Dossier would silently lose the §4 long-term
layer + §5.5.4 ToM line and regress to omniscient-sandbox behavior — this
invariant prevents that.

Scope fence: **"DnD" = wuxia turn-based RPG flavor** (HP/MP/武功/items,
grid tactics) — *not* the D&D 5e SRD. Combat = jynew's 金庸群侠传 model.

---

## 3. Phase 1 — Native dialogue + AITavern §3.6 extensions

ai-town already does autonomous wander + conversation. Port only the
delta. **Location correction (ai-town-lens MUST-FIX 3):**
`findConversationCandidate` is an `internalQuery` invoked from the
`agentDoSomething` **operation** (`agentOperations.ts`), *not* from
`Agent.tick`. It is **not** the FSM. The scoring change lives in that
query/operation; the FSM is untouched.

- **3.1 Interest-weighted selection.** Replace the nearest-sort in
  `findConversationCandidate` with AITavern §3.6: `score = interest ×
  proximity × recencyDamp`, `MIN_CANDIDATE_SCORE` floor,
  weighted-random pick, short-circuit on `justLeftConversation ||
  recentlyAttemptedInvite`. **Determinism:** ai-town has no ambient
  seeded RNG (`Math.random()` is used directly). The weighted pick uses a
  `System.Random`-equivalent seeded from `RandomSeed XOR
  agentId.hash XOR stepTimestamp`, explicitly threaded into the query
  args (no hidden global). **Granularity note:** `participatedTogether`
  is written only at conversation teardown (`Game.saveDiff`), so
  recency-damping is per-*conversation*, not per-message — accepted, this
  matches AITavern intent.
- **3.2 RelationshipGraph.** Directed `{Ally,Friend,Neutral,Rival,
  Enemy}` per ordered pair, in a `convex/agent` table, **derived only
  from the committed `dossiers.json` relationship/impression text, never
  re-inferred at runtime** (world-lore MUST-FIX 3 / RECOMMEND). Unset
  edges (incl. NPC→player) → `Neutral`. The scalar attractor it feeds
  (Phase 2 §4C) is the ratified `AffectBaseline.ForRelation` map
  (jynew Phase 3 §10 Q3, built verbatim in `AffectBaseline.cs`):
  **Enemy −0.7 / Rival −0.4 / Neutral 0 / Ally +0.4 / Friend +0.6**;
  unset → Neutral 0; decay relaxes *toward this baseline, never toward
  0*; no Grok call. These exact values are load-bearing — do not
  re-derive (existing-extension MUST-FIX 2).
- **3.3 Distinct-identity canon fence** *(world-lore MUST-FIX 3).* The
  RelationshipGraph/dossier seed and the §4D `违背设定` tripwire carry
  jynew `config.py SPOILER_EXCLUSIONS` verbatim, not just the 5 spoilers:
  歐陽克 ≠ 完顏康 (no merge/alias); 指腹為婚 binds only 郭靖+楊康;
  黃蓉↔楊康 strangers at 回10; 穆念慈 has no 丈夫 / no 楊康之死
  (post-cutoff); 周伯通 never personally met 黃蓉/郭靖 by 回10. A pair
  with no `dossiers.json` entry (e.g. 穆念慈↔欧阳克) gets the §3
  stranger-surface treatment — **never an invented relationship.**
- **3.4 Constants.** Port AITavern RETUNE'd constants into
  `convex/constants.ts`, reconciled with ai-town's existing ones.

**Exit:** the 4 canon NPCs wander the 2D 射雕 town and hold in-character
Grok conversations, interest-driven, with canon-derived relationships.

---

## 4. Phase 2 — Layered memory port (replace embeddings)

Faithfully rebuild AITavern **Phase 3 (3A–3D)** in TS, replacing
`memory.ts` embeddings + `conversation.ts` prompt builder. jynew Phase 3
plan + `aitavern_invariants.md` are the spec. The two `*ConversationMessage`
builders + `rememberConversation` are wired into `agentOperations.ts` only
via `agentGenerateMessage` / `agentRememberConversation` (both
`internalAction`s that already write back via inputs) — swap their bodies
without touching the FSM, inputs, or world doc.

- **4A — Static spine (3A).** WorldCodex + extended CharacterBio +
  CharacterDossier as `convex/agent` tables from the lore JSON.
  ContextAssembler §1–§4. **Coexistence rule (verb-precise,
  existing-extension RECOMMEND):** the assembler block is **prepended**
  before the retained existing prior-memory block (not appended after —
  appending invites the long-context recency-dip), and the existing
  memory path is **not removed until 4D**. No memory-continuity
  regression mid-port. The mod-scene situation injected into
  ContextAssembler §5.1 carries the jynew Phase 3 §3.3 label
  「设计者设定的虚构情境，非小说原文桥段」 — town co-presence is sandbox
  fiction, dossiers/ImpressionDelta are the only canon (world-lore
  MUST-FIX 4).
- **4B — Working memory (3B).** RuntimeMindState (situation/task/
  surroundings) in a new `mindState` `convex/agent` table — never the
  world doc. **Ordering invariant (existing-extension MUST-FIX 1):** the
  co-located ring-append (a `TurnRecord` written to
  `Targets[talkee].Ring` in the *same synchronous step* as the turn is
  appended to the transcript, for both NPC and player turns) is built and
  verified **here in 4B/early-4D, and MUST land before** the 4D
  transcript-source removal. The §9-equivalent **no-under-render**
  assertion (a post-append `BuildContinue` contains the most-recent turn)
  guards the deletion from silently dropping the in-flight turn.
- **4C — Affect with decay (3C).** Emotion + per-target affection, lazy
  timestamp-based exp decay (`Math.exp`, ms epochs), floor-omit,
  affection reverts to the §3.2 `AffectBaseline` scalar (never 0).
- **4D — Consolidation (3D).** Replace `rememberConversation` with the
  4-slot re-fold-from-raw reflection op (往来印象/情绪变化/好恶变化/
  违背设定). **Salience gate — full predicate (existing-extension
  MUST-FIX 3):** `trivial = (|好恶变化| < AFFECT_DELTA_DEADBAND) AND
  (情绪变化 label is neutral)`; when trivial, the **summary is still
  folded** — only the affect-delta application + `LastSetMs` reset are
  skipped (so baseline-reversion decay can fire for a chatty pair).
  Deltas are computed from the **raw** turns, not the decayed
  `Affect.Current(now)`. Episodic ring = **anchor (first turn, pinned) +
  last-9** (not FIFO-10); mid-conv overflow spills raw synchronously at
  the append site, no mid-conv Grok call. **GlobalReflection — carried
  guarantees (existing-extension MUST-FIX 4):** flat fold over the
  already-distilled per-pair summaries (never raw, never recursive);
  **output-only — never an input to any per-pair fold**; ≥2 non-blank
  per-pair summaries gate, else skip *and do not clear* an existing one;
  cross-pair staleness is *intentional* — do not force-refold other
  pairs; strict per-pair-before-global order (global runs only when the
  just-finished pair is consolidated); best-effort failure must not
  corrupt already-written per-pair state. `ImpressionDelta` is overlay
  only — never mutates the canon Dossier. **Removals:** delete the
  `memoryEmbeddings` vector table + `vectorIndex`, `embeddingsCache`,
  importance Grok calls, `searchMemories`/`fetchEmbedding`; make
  ContextAssembler the **sole transcript source** (no second
  `AppendTranscript`); Leave uses the **lean profile** (§2 self-bio +
  §5.4 emotion + §5.5.3 ring only).

**Migration (ai-town-lens RECOMMEND):** dropping the `memoryEmbeddings`
table + its `vectorIndex` is schema-breaking and orphans `memories`
`embeddingId` refs. The plan adopts a **one-shot fresh-world reset** for
the 射雕 build (no production data to preserve); documented, not silent.

No embeddings (user directive + jynew Phase 2 §14): valid at N≤8 within
Grok's 256K window; 4 NPCs is comfortably inside. Re-evaluate only past
~8 (jynew Phase 3 §0 research-lens trigger — recorded, not now).

**Exit:** NPCs converse with full novel-grounded layered memory; durable
disposition via reflection; zero embeddings; no continuity regression.

---

## 5. Phase 3 — 2D turn-based wuxia battle engine (new)

Re-implement jynew combat **in TS, math verbatim**. Sources:
`DamageCaculator.lua`, `BattleFieldModel.cs` / `BattleLoop.cs` /
`RangeLogic.cs` / `BattleManager.cs`, `RoleInstance.cs`,
`SkillCastInstance.cs`, `Configs/Lua/*Config.lua`.

- **5.1 Data port.** Convert `Configs/Lua/{Skill,Item,Character,Extra,
  Settings}Config.lua` (flat array tables w/ `fieldIdx` header) → typed
  TS/JSON. **Use the Lua tables, never the .xlsx** (Lua is the runtime
  truth; aitavern's set is byte-identical to base JYX2 — verified). The
  four **synthetic skills are NOT in the Lua table** and must be
  reconstructed in code (jynew-lens MUST-FIX 5): `Poison`(magic 93) if
  `UsePoison≥20 && Tili≥10`, `DePoison`(94) likewise, `Heal`(95) if
  `Heal≥20 && Tili≥50`, `Anqi`(97) — each with `CastSize = ability/15+1`,
  POINT cover, `coverSize=1` overrides.
- **5.2 Rules engine (`convex/battle/rules.ts`).** Square 4-neighbor grid
  (`dx={1,0,-1,0}`), **Manhattan distance**. **Turn order
  (jynew-lens MUST-FIX 3):** `SortRole` = Qinggong desc, tie by roleId
  asc; within a round `OnActioned` removes+appends the actor; **once
  every role has acted the entire list is re-sorted fresh (`ResetAct` +
  `SortRole`) — a new round is a fresh Qinggong sort, not a stable
  rotating queue.** `ActWait` defers the actor by inserting it *before
  the first already-acted role* (drop from front). Pure turn-based path
  only (`SEMI_REAL=false`). **Move (jynew-lens MUST-FIX 1):**
  `moveAbility = (Tili≤5) ? 0 : max(0, Qinggong/15 − Hurt/40)`; a turn's
  move is BFS over the 4-grid with remaining range `moveAbility −
  movedStep`, and `movedStep` **accumulates across a split/multi-step
  manual move** (already-moved steps subtract). **Start-of-turn DoT
  (jynew-lens MUST-FIX 3):** `hurtDmg = clamp(Hurt/20, 0, Hp)` and
  `poisonDmg = clamp(Poison/10, 0, Hp)` clamped **independently against
  pre-subtraction Hp**, then `Hp -= hurtDmg; Hp -= poisonDmg; if Hp<1
  Hp=1` — the per-component-clamp-then-sum-then-floor order is
  load-bearing for the exact post-DoT Hp (golden-vector). **Skill cover
  (jynew-lens MUST-FIX 4):** point/line/cross/rect/rhombus; `CoverSize==0
  ⇒ 1`; LINE special-case (forced CastSize, central cell inaccessible)
  per `RangeLogic.GetSkillCoverBlocks`. Rest/wait/flee; win/lose/
  surrender result.
- **5.3 Damage (`convex/battle/damage.ts`).** Port the **six** DamageType
  formulas verbatim. **Carried details the v1 omitted:**
  - **MP-gated effective level (jynew-lens MUST-FIX 2):** effective
    `level_index` is downgraded by available MP via
    `calMaxLevelIndexByMP` (`level = floor(mp/(needMp*2))*2 − 1`,
    clamped) before the per-level `Attack` lookup — low MP *weakens* the
    skill, distinct from blocking it.
  - **MP-too-low chip short-circuit (jynew-lens MUST-FIX 2):** for
    DamageType 0, `if r1.Mp <= magic.MpCost: damage = 1 + rand(0,9);
    return` — bypasses the whole formula.
  - **武学常识 team-sum (jynew-lens MUST-FIX 5):** DamageType 0 adds
    `GetTotalWuXueChangShi(attackerTeam)` to attack and the defender
    team's sum to defence — only members with `Wuxuechangshi≥80 && alive`,
    each ×2.
  - **Cover→distance feedback + falloff (jynew-lens MUST-FIX 4):**
    distance = Manhattan `r1.Pos→r2.Pos`; **for RECT/RHOMBUS add
    `blockVector→r2.Pos`**; then `dist≤10 → v = v*(100−(dist−1)*3)//100`
    else `v = v*2//3`, per-target.
  - **No hit/miss/crit roll exists** — every in-range cast hits; the only
    randomness is the `±rand` spread terms. Pinned as a positive test
    (jynew-lens RECOMMEND).
  - **左右互搏 (jynew-lens RECOMMEND):** for DamageType 0/1 with
    `Zuoyouhubo`, the skill casts **twice** (MP twice, Tili once).
    Carried (not deferred-silently).
  - **RNG precision (jynew-lens RECOMMEND):** Lua `math.random(0,n)` is
    inclusive `[0,n]` (damage formulas); the C#-side helpers
    (`OnRest`/`UseItem`/`LevelUp`/DoT) use `Random.Range(0,n)` exclusive
    `[0,n)`. The port applies each form where jynew does — not one
    uniformly.
- **5.4 Battle subsystem.** Per §1.1: `Battle` class ticked in
  `Game.tick`, `world.mode='battle'` gates social ticks. Player turns =
  `inputs`; AI turns computed synchronously (heuristic-lite:
  reachable-cell × skill scoring; full `AIManager.lua` deferred to
  Phase 5, stated not silent). **Defeat ≠ death — `Downed` not death
  (user rule, 2026-05-18; supersedes INV-8 HP≤0→death).**
  - **This is a deliberate design divergence, NOT a generalization of
    jynew's engine (jynew-lens R3 MF1).** The v2-locked **in-battle
    math, turn order, DoT-clamp order, cover/falloff and the six
    DamageType formulas are ported verbatim and untouched.** What
    diverges is *only* the end-condition + post-battle disposition.
    jynew itself does the opposite for enemies — `GetNextRoleInTurnBase`
    (`BattleFieldModel.cs:239-247`) destroys + removes a dead role and
    `GetBattleResult` (`:120-147`) ends the fight by *excluding*
    `IsDead()` roles from the per-team alive-count. Only the
    *player-protection ethos* is jynew-real (team-0 forced `Hp≤0→Hp=1`
    `BattleManager.cs:217-222`; DoT floors `Hp≥1` `BattleLoop.cs:133`);
    v3 extends that ethos to everyone by choice.
  - **`Downed` definition that keeps the verbatim-ported result
    terminating (jynew-lens R3 MF1+MF2):** a combatant at `Hp≤0` →
    `Downed`. The TS alive-predicate the ported `GetBattleResult`
    consumes is **`isAlive = Hp>0 AND NOT Downed`**, and `Downed` roles
    are skipped in the team-count loop *exactly where*
    `BattleFieldModel.cs:129` does `if (role.IsDead()) continue;` — so
    one side all-`Downed` ⇒ Win/Lose terminates (without this, a
    not-removed `Downed` role would loop `InProgress` forever).
    Likewise `Downed` is **excluded from turn scheduling** at the exact
    point jynew removes the dead (`BattleFieldModel.cs:239-247`) so the
    v2-locked `SortRole`/`ResetAct`/`ActWait` order is preserved.
    Scope-confined: `Downed` = excluded from alive-count + turn
    scheduling; **not deleted from the world doc** until teardown
    disposition (§6.4). `Whosyourdad` is debug-only and now largely
    subsumed by the universal never-die rule (carried, narrowed).
- **5.5 Battle UI.** Pixi grid + action menu (move/skill/item/rest/wait/
  flee), HP/MP/状态 bars. **Rendering note (ai-town-lens RECOMMEND):**
  the battle view bypasses the historical-replay path (which only does
  flat-numeric player locations) and renders from a plain `useQuery` on
  the transient `battle` state — a distinct render mode from the town,
  not a `PixiGame` reuse.

**Exit:** a self-contained faithful wuxia battle (player + AI),
golden-vector-verified turn order & damage, debug-triggerable.

---

## 6. Phase 4 — INV-8 hostility → combat → death/drop/faction bridge

INV-8 has **no reference code** (jynew never built it) — cite
`aitavern_invariants.md` INV-8 ids verbatim in tasks.

- **6.1 Hostility detection (INV-8-3/4/5).** Per NPC message:
  lexicon score + Grok JSON sidecar at sentinel `\n###META\n{...}`;
  parse-fail → `hostility=lexiconScore, intent=talk`, log, no throw.
  Accumulate: `≥3` adds (no decay), `<3` decays; combat fires on the
  message that **crosses** `HOSTILITY_THRESHOLD` upward (latch, no
  re-fire). **Relation gate (existing-extension MUST-FIX 5):** uses the
  *directed* RelationshipGraph (asymmetric; unset→Neutral); Rival is a
  reserved type treated like Enemy **only at the decision layer where an
  invariant explicitly calls it out** — both NPCs must be `Rival|Enemy`.
- **6.2 World→battle round-trip (INV-8-1/2).** Set `world.mode='battle'`,
  build the transient `battle` state from the combatants' stat blocks +
  current world-doc positions (no separate position snapshot —
  ai-town-lens MUST-FIX 2), run the Phase 3 `Battle`, then on end emit
  result `inputs` (coalesced — single batched input, not one per
  combatant, to respect the OCC budget the engine already strains
  against — ai-town-lens RECOMMEND) and set `world.mode='social'`.
  Durable artifacts land in `convex/battle`/`convex/agent` tables.
- **6.3 Faction-ally joining (INV-8-7/8/9).** `Ally>Friend>Enemy>
  Neutral` precedence; RNG seeded `RandomSeed XOR conversationId.hash`;
  conflict→bystander; player auto-joins partner's side or is prompted
  within radius. **Defeated allies are `Downed` then dispositioned per
  §6.4 — never auto-killed** (they can be subdued/freed; the stakes are
  capture, not death).

- **6.4 Disposition at battle teardown (user rule, 2026-05-18 —
  replaces INV-8 auto-death/world-drop model).** **Invariant: only the PC
  can end an NPC's life; NPCs never kill (NPC or PC).**

  **Inventory is net-new state, NOT in the world doc (ai-town-lens R3
  MF2).** ai-town has no inventory system today. Inventory (PC + each
  NPC) is a new durable table in `convex/battle` keyed by playerId/
  agentId — the natural extension of the §0.3 stat-block table — **never**
  the `worlds` doc (it would blow the §1.2 size budget). Every transfer
  below is a **durable-table mutation performed by the coalesced
  teardown-input handler** (engine-owns-its-tables, §1.1/§6.2 pattern),
  not a world-doc write.

  **Pending-disposition phase lives inside the transient `battle?` field
  (ai-town-lens R3 MF3).** The PC choice gates teardown and the answer
  arrives ~1.5s later as an input; that pending state is an explicit
  `phase: combat → pendingDisposition → teardown` *inside* the existing
  `battle?` field — so §1.2's closed enumeration of engine-doc additions
  stays true (see §1.2 amendment). Safe under the single-threaded step +
  `world.mode='battle'` gate.

  - **PC's side won, NPC `Downed` → PC disposition prompt** per downed
    enemy: 「杀 kill / 擒 subdue / 夺 rob / 放 release」.
    - **杀 (kill) — PC only.** Reuse **INV-8-10 lifecycle ORDER**:
      (1) op-clear → (2) `Conversation.Stop(now)` *before* de-register
      → (3) de-register. The kill memory is written **after**
      `Conversation.Stop` (INV-8-10's step-2 purpose: survivors'
      `LastConversation`/`ToRemember` set first — existing-extension R3
      R2). **All belongings → PC**: transfer the dead NPC's `Items`
      (`List<CsRoleItem>`) + equipped `Weapon`/`Armor`/`Xiulianwupin`
      *item-ids*, and **clear the dead NPC's slots to -1** (defining
      behavior — jynew has no drop precedent to mirror, jynew-lens R3
      RECOMMEND). **Kill memory (revised INV-8-12):**
      `MemoryType.Relationship`, survivor-keyed, `targetPlayerId=<dead>`,
      `description="<self> 与 <other> 决斗，<other> 为 <PC> 所杀。"`
      (`<PC>` = killer **display name**, not id — existing-extension R3
      R1), `importance` **pre-set 9, skips the LLM importance call**;
      Phase-2 compaction-exempt.
  - **擒/夺/放 (PC chose non-lethal) & NPC-vs-NPC & NPC-vs-PC** — all
    survive (no kill). Outcomes: 擒 → `Subdued` (§6.5); 夺 → taker takes
    item(s) (durable-table transfer) then loser `Subdued`; 制 (NPC-only
    restrain) → `Subdued` w/ movement-chain; 放 → released, recovers from
    `Downed`. **NPC-vs-NPC**: winner NPC's action is **heuristic-lite,
    chosen synchronously in `Battle` teardown** (weighted by the directed
    RelationshipGraph/intent — *not* an LLM call, so no op/latency;
    jynew-lens R3 RECOMMEND / ai-town-lens R3 R-C). **NPC-vs-PC**: PC is
    `Downed`, maybe robbed, **never killed**, then **respawns, no
    game-over (INV-8-14)**.
  - **All non-kill disposition memories are `MemoryType.Relationship`
    (existing-extension R3 MF1)** — *not* `Conversation` — keyed to the
    affected/acting pair, `importance` **pre-set (PC-coerce 7,
    NPC-coerce 6), skipping the LLM importance call** (R3 R3); this is
    the *only* way the Phase-2 compaction-exemption (`Relationship`/
    `Reflection` never folded — Phase 2 §3.1/§8 Q8, `MemoryCompactor.cs`
    `Type != Conversation` filter) actually holds. Description follows
    the jynew §5.3 attribution句式 and the §10 武功-cutoff: **no
    post-回10 武功/秘籍 name appears in the memory text or any dialogue
    surfaced from it** (world-lore R3 R1).
  - **Affect channel — via the existing §5.3 re-fold, NOT a direct
    mutation (existing-extension R3 MF2).** The combat that triggered
    this was escalated from a conversation; that conversation is
    force-stopped (INV-8-10) so its conv-end consolidation fires. The
    battle outcome is appended as a **raw spill entry for the triggering
    pair**, so the existing §5.3 conv-end reflection re-folds it *from
    raw*, through the salience gate, into `ReflectionSummary` /
    `ImpressionDelta` (overlay only, never canon). **No battle-teardown
    code mutates `Emotion`/`Affection`/`ImpressionDelta` directly** —
    that would bypass the salience gate + raw-not-decayed + single-write
    discipline (Phase 3 §5.3, §9 regression test). The durable
    `Relationship` record (above) is the *event of record* surfaced
    directly like the INV-8-12 death memory; the raw-spill entry is what
    moves disposition. Two coexisting writes, one sanctioned affect path.

- **6.5 `Subdued` state — carried into the social 2D world.** A new
  **per-agent** `subdued?: { until: number }` field on the serialized
  agent in the world doc (size class of `lastConversation`/`activity`;
  engine-visible because it gates `Agent.tick`, per §1.2). **Tick-gate
  spec (ai-town-lens R3 MF1 — the `world.mode` analogy is struck; a
  per-agent blanket early-return deadlocks the FSM):**
  - The lazy decay (`if subdued && now ≥ subdued.until → delete subdued`)
    and the suppression run **after** `agent.ts:105` — i.e. *after* the
    `inProgressOperation` guard, the `toRemember` reflection dispatch,
    and inside/after the in-flight conversation FSM, **never**
    short-circuiting them. A `Subdued` agent **must still** fire
    `agentRememberConversation` (its memory of being beaten/subdued) and
    **must still** finish or leave a conversation it is already in.
  - Suppression is **narrow**: only the autonomous `agentDoSomething`
    dispatch (`agent.ts:78-92`) and the invite-**accept** path are
    gated — the chained loser can't wander, initiate, or be pulled into
    *new* conversations.
  - **On entering `Subdued`, any in-flight conversation is force-ended
    (`Conversation.Stop`) in the same teardown input** so the subdued
    agent is never left a live participant (else its partner's FSM
    deadlocks waiting on a peer that never types). Decay deferral while
    an `inProgressOperation` is in flight is benign (ops are short).
  - For `SUBDUE_DURATION_MS` then lazy-decays free (§4C timestamp
    pattern, no per-tick cost). **Recoverable:** the PC can free a
    `Subdued` NPC by interaction — canon-resonant: the consumed
    `ouyangke` dossier literally records the 回10 守约不追 release outcome
    (`dossiers.json`; world-lore R3 R2). Taken possessions stay taken.
    The disposition's affect/reflection impact flows via §6.4's
    raw-re-fold channel (overlay only, never canon).
  - **Open design point (flagged, user-overridable):** persistence
    duration & whether a freed/decayed NPC retaliates — defaulted to
    time-decay + PC-can-free.

**Exit:** an in-character hostile conversation escalates to a faithful 2D
battle; the PC may kill (→ loot to PC) or spare/subdue a beaten NPC, NPCs
subdue/coerce (never kill) each other, the `Subdued` state carries into
the social world, and everyone *remembers* it.

---

## 7. Phase 5 — Polish / scale

Tuning; full `AIManager.lua` AI fidelity; optional roster growth (only by
extending the jynew pipeline `ROSTER` and re-running it — never by
runtime fabrication); activity layer; daily schedule; parallel-
conversation rate-limit + Grok cost cap; full 3-layer test sweep; remove
the 4A coexistence path.

---

## 8. Cross-cutting risks & decisions

| # | Item | Disposition |
|---|---|---|
| R1 | Engine-state bloat | Mind/lore/durable-battle in `convex/agent`/`convex/battle`; only a tiny transient `battle?` field in the world doc during combat (§1.1). Size-budget test. |
| R2 | Single-engine vs. turn-based battle | In-engine `Battle` subsystem, `world.mode` gate; no second engine/scheduler (§1.1). |
| R3 | No embeddings at scale | Valid N≤8 / 256K (jynew Phase 2/3 §0). 4 NPCs fine. Re-eval trigger recorded. |
| R4 | Licensed-IP canon drift | Canon-immutable + overlay + 回10 cutoff + anti-omniscience + `SPOILER_EXCLUSIONS` distinct-identity fence + `违背设定` tripwire (§3.3/§4). |
| R5 | Grok endpoint/model drift | `curl /v1/models` at impl; canned-line fallback (AITavern Phase 1). |
| R6 | "Port" vs "rebuild" | Bucket A kept, B rebuilt TS, C built new. No C# shipped. Provenance asserted weakly (§0). |
| R7 | jynew has no drop system | INV-8 drop/faction is a fresh build, not a port. |
| R8 | Migration | Drop `memoryEmbeddings`+`vectorIndex` is schema-breaking → one-shot fresh-world reset, documented (§4D). |
| R9 | OCC under added inputs | Hostility + battle-result inputs add volume on the single `inputs` counter ai-town already strains (random-sleep mitigation today); coalesce battle-result inputs (§6.2). |
| R10 | Defeat≠death model (user, v3) | `Downed`→disposition at teardown; PC-only kill (→ all loot to PC); NPC-vs-NPC = `Subdued`+coerce, never kill; NPC never kills PC. **Deliberate divergence, NOT a generalization of jynew (jynew removes dead enemies)**; in-battle math untouched, only end-condition+disposition change; `Downed` excluded from alive-count & turn-scheduling so the verbatim `GetBattleResult` still terminates (§5.4/§6.4). |
| R11 | Persistent `Subdued` agent-state (user, v3) | Per-agent `subdued?` engine field; narrow tick-gate **after `agent.ts:105`** (never short-circuits `toRemember`/in-flight conv); on subdue, in-flight conv force-stopped so partner doesn't deadlock; lazy time-decay; PC can free. Open: duration/retaliation — defaulted, user-overridable (§6.5). |
| R12 | Coercion + PC-disposition UX (user, v3) | New PC prompt 「杀/擒/夺/放」 (pending-disposition phase inside transient `battle?`) + heuristic-lite synchronous NPC coercion (no LLM). All non-kill memories `MemoryType.Relationship`, pre-set importance, compaction-exempt; affect via the §5.3 raw-re-fold only (no direct mutation). |
| R13 | Inventory is net-new state (v3) | ai-town has no inventory today. PC+NPC inventory = new `convex/battle` table keyed by playerId/agentId (extends §0.3 stat-block table), **never** the world doc; transfers are durable-table mutations by the coalesced teardown-input handler (§6.4). |
| Q1 | Battle map count | 1 generic grid map; per-encounter spawn-coord table (replaces Unity `Level/BattlePos`). |
| Q2 | Battle AI fidelity | Heuristic-lite first; full `AIManager.lua` → Phase 5 (explicit, not silent). |
| Q3 | Player speak UX | Reuse ai-town `MessageInput` (already native). |

## 9. Sequencing & size

P0 → P1 → P2 (4A→4B→4C→4D, ring-append co-location before transcript-
source removal) → P3 → P4 → P5. P2 is the largest (faithful Phase 3
rebuild); P3/P4 the most novel (no prior implementation — jynew never
built combat/INV-8). Each sub-phase independently committable/testable.

## 10. What this is NOT (scope fence)

Not D&D 5e SRD (wuxia turn-based). Not embeddings. Not multi-novel (射雕,
回10). Not a C# port (TS rebuild of the design). Not re-running the lore
pipeline. Not new art / 3D. Not roster fabrication beyond the 4
pipeline-backed NPCs. **Not auto-lethal combat / no game-over:** combat
defeat is `Downed`, never automatic death; only the PC ends an NPC life
(→ all loot to PC); NPCs never kill (each other or the PC); the PC never
hits a game-over (respawn). **Dialogue 武功-leak guard (world-lore RECOMMEND):**
battle-skill data may include post-回10 武功 names (mechanically fine — the
battle subsystem is decoupled fiction per §0.4); the ContextAssembler must
not surface a 武功 name a character canonically wouldn't know by 回10 in
*dialogue* (consistent with the jynew Phase 3 §3.3 武功 cutoff).

## 11. Review audit trail

### Round 4 (v3 → v4) — CONSENSUS

All 4 lenses **APPROVE**. jynew: MF1 (reframe as deliberate divergence +
`Downed` excluded from alive-count) / MF2 (`Downed` excluded from
turn-scheduling) / RECOMMEND (loot=item-ids+clear-to-(-1)) resolved with
exact citations, ported `GetBattleResult` provably terminates, no new
combat defect. ai-town: all 3 MF (narrow tick-gate after `agent.ts:105` +
force-stop conv; inventory net-new `convex/battle` table; pending-
disposition phase inside `battle?` keeping the closed enumeration) + 3
RECOMMENDs resolved, no new engine defect. existing-extension: both MF
(all non-kill memories `MemoryType.Relationship`; affect via §5.3
raw-re-fold only, no direct mutation) + recommends resolved, no v2
invariant regressed. world-lore: both R3 recommends folded, no new canon
defect. **v4 is consensus-approved.**

### Round 3 (v2 → v3) — user defeat/death/coercion scope change

Verdicts: **world-lore APPROVE** (2 non-blocking recommends adopted:
attribution句式+武功-cutoff on coercion memory text §6.4; 守约不追
canon anchor §6.5). **jynew / ai-town / existing-extension REQUEST
CHANGES** — all adopted into v4:

- **jynew** — MF1: §5.4 wrongly claimed "generalizes jynew to all
  combatants" (jynew *removes* dead enemies) **and** left `Downed` vs.
  the verbatim `GetBattleResult` non-terminating → §5.4 reframed as a
  deliberate divergence; `Downed` defined as excluded from alive-count.
  MF2: `Downed` must be excluded from turn-scheduling where jynew removes
  the dead → §5.4. RECOMMEND: loot = transfer item-ids + clear dead
  slots to -1 (defining, not porting) → §6.4.
- **ai-town** — MF1: per-agent blanket tick-gate deadlocks the FSM →
  §6.5 narrow gate after `agent.ts:105`, never short-circuits
  `toRemember`/in-flight conv, force-stop conv on subdue. MF2: inventory
  is net-new, undeclared → §6.4/§1.2/R13 (own `convex/battle` table,
  never world doc). MF3: PC-disposition pending state breaks §1.2's
  closed enumeration → pending-disposition phase inside `battle?`,
  §1.2 amended. RECOMMENDs: decay-check placement, `participatedTogether`
  ordering rationale, NPC-coerce is heuristic-sync not LLM → §6.4/§6.5.
- **existing-extension** — MF1: importance-7/6 variants lacked
  `MemoryType` → "compaction-exempt" only holds if `Relationship` →
  §6.4 all non-kill memories `MemoryType.Relationship`. MF2: affect
  "feeds reflection" channel unspecified → §6.4 enters reflection ONLY
  via raw-spill the §5.3 conv-end re-fold consumes; no direct mutation.
  RECOMMENDs: `<PC>`=display name; kill memory after `Conversation.Stop`;
  pre-set importances skip the LLM call → §6.4.

### Round 1 audit trail (v1 → v2)

4 lenses, all **REQUEST CHANGES**; every MUST-FIX adopted:

**jynew-lens** — (1) move formula: Tili≤5→0, speed<0→0, movedStep
accumulation → §5.2. (2) MP-gated effective level + MP≤cost chip
short-circuit → §5.3. (3) per-round resort + ActWait + DoT
per-component-clamp order → §5.2. (4) cover→damage-distance feedback +
per-target falloff + LINE/CoverSize quirks → §5.2/§5.3. (5) synthetic
skills + 武学常识 team-sum → §5.1/§5.3. RECOMMENDs (no-crit assert,
Whosyourdad/party-never-permadie, 左右互搏, RNG inclusivity) → §5.3/§5.4.

**ai-town-lens** — (1) no "suspend engine" mechanism → in-engine `Battle`
subsystem + `world.mode` gate (§1.1). (2) battle-state placement
contradiction → tiny transient world-doc field in-tick vs. durable tables
via inputs, reuse world-doc positions (§1.1/§6.2). (3) candidate
selection is a query from the operation, not the FSM; RNG seed source;
participatedTogether granularity → §3.1. (4) provenance claim softened →
§0. RECOMMENDs (migration/vectorIndex, llm.ts embedding-model guard, OCC
budget, Pixi non-historical render, latency) → §0.1/§4D/§5.5/§6.2/§8.

**world-lore-lens** — (1) roster locked to the 4 pipeline-backed NPCs;
完颜康/丘处机 struck → §0.3. (2) canon-provenance fail-closed invariant →
§0.6. (3) `SPOILER_EXCLUSIONS` distinct-identity fence + dossier-only
RelationshipGraph → §3.2/§3.3. (4) mod-scene-is-fiction label into
ContextAssembler §5.1 → §4A. RECOMMENDs (武功 dialogue-leak guard,
dossier-derived baseline, WorldCodex verbatim) → §3.2/§10.

### Review Round 2 (v2 — consensus)

All 4 lenses **APPROVE**. jynew: all 5 MUST-FIX + RECOMMENDs resolved,
no new combat blocker. ai-town: all 4 MUST-FIX + 5 RECOMMENDs resolved;
one non-blocking note (gate `Player.tick*` under battle mode) folded into
§1.1. world-lore: all 4 MUST-FIX + 3 RECOMMENDs resolved, no fabricated
canon. existing-extension: all 5 MUST-FIX resolved verbatim vs.
`AffectBaseline.cs`/`EpisodicRing.cs`/`MemoryCompactor.cs`/INV-8 + 3
RECOMMENDs. No reviewer relitigated the 3 locked decisions. Plan is
consensus-approved and ready for implementation.

---

#### Round 1 detail

**existing-extension-lens** — (1) 3D coexistence-flip ordering
(ring-append co-location before transcript removal) + no-under-render →
§4B/§4D. (2) exact `AffectBaseline` scalars + decay-never-0 → §3.2/§4C.
(3) full salience-gate predicate + summary-still-folds → §4D. (4)
GlobalReflection flat/no-recursion/output-only/≥2-gate/staleness-
intentional/order/best-effort → §4D. (5) INV-8-12 exact memory shape +
Phase-2 compaction-exemption intersection + INV-8-5 directed/Rival
semantics → §6.4/§6.1. RECOMMENDs (bios-patch vs world-rewrite asymmetry,
"prepend" verb, INV-8 cite-verbatim) → §0.2/§4A/§6.
