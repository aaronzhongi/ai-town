# Human-Memory → ai-town Port Plan (lore-free, single NPC) — v2

**Status:** v3.2 — **P1-1D IMPLEMENTED, DEPLOYED, AND USER-TRIAL-VALIDATED**
(consensus-approved at v3.1 R3; v3.2 records 1D execution + the
post-trial C003 tuning round). 169 tests across 13 suites; tsc 0.
Cross-conversation memory loop verified live: 琳娜 wrote a
`ReflectionSummary` at conv 1 end, conv 2 read it back via the §5.5
per-target block (the `往来印象（已沉淀）` line in the system prompt).
Three trial-surfaced defects (name evasion / typing race / repetition)
were fixed by C003 v2 (consensus-approved, 2 rounds × 2 lenses,
applied). v4 of the parent Wuxia2D plan is NOT the ancestor of this
doc; this is this doc's own v3.2.

**One-line:** Port *only* jynew AI Tavern's lore-free **human-memory
core** (episodic ring + reflection consolidation + lazy affect/emotion
decay) into ai-town's TS/Convex engine, driven by **one hand-authored,
non-canon NPC** (a plain 18-year-old girl) for **PC↔NPC conversation**.
Strip all 射雕 world / faction / martial-art knowledge. Battle is
**retained in the plan but deferred** (not built this iteration).

---

## 0. User-locked decisions (2026-05-18) — OFF-LIMITS to reviewers

| # | Decision |
|---|---|
| L1 | **Battle stays in the plan but is deprioritized** — battle/hostility/INV-8/subdue/inventory (v4 §5–§6) are **carried by reference, NOT implemented this iteration** (§7). |
| L2 | **Persona is user-supplied.** The plan defines the *schema/slots*; the user fills the *content* (§3, §6). |
| L3 | **World = default ai-town map, exactly ONE NPC + the player.** No new map; no multi-agent crowd. |
| L4 | **Memory = faithful jynew Phase 3D** (episodic ring + reflection consolidation + emotion/affection decay-to-baseline) with **only the lore layers stripped**. Now-moot machinery handled as **documented simplifications**, not redesigned. |

**Carried-forward v4 locks still in force:** no embeddings; LLM provider
= Grok (OpenAI-compatible endpoint); faithful TS *rebuild* (never a C#
copy); engine-small state placement; LLM only in `internalAction` ops
that write back via inputs.

---

## 1. The core insight — the valuable part is the *lore-free* core

jynew Phase 3D is two separable things:

1. **A lore-free human-memory machine** (the idea the user wants): an
   anchor-pinned **episodic ring**, post-conversation **reflection
   consolidation** (re-fold-from-raw, 4-slot, salience-gated), and
   **lazy exponential decay** of emotion/affection toward a baseline.
2. **A 射雕 lore skin** via ContextAssembler **§1 WorldCodex** and **§4
   CharacterDossier** (`PolityKnowledge`/`FactionKnowledge`/
   `PersonView.MartialNote`) — *exactly* "world / faction / martial-art
   knowledge."

**Enabling fact (verified):** ContextAssembler already omits §1 when
`World == null` and §4 when the dossier key is missing
(`_jynew_phase3d_extract.md:1110,1138`). Removing lore is **not surgery
on the memory machine** — it is *not seeding* WorldCodex/Dossier and
letting the assembler degrade to §2 + §3 + §5.x.

### 1.1 Decomposition (keep / rebuild / build-new / delete / defer)

| Bucket | What | Disposition |
|---|---|---|
| **A. Keep ai-town native** | agent/conversation FSM, engine loop, inputs, `messages` table + `agentSendMessage`/`messages.writeMessage` writers, the **two** operation seams `agentGenerateMessage` (`agentOperations.ts:46-91`) + `agentRememberConversation` (`agentOperations.ts:18-44`) | **Untouched.** Swap only the **four function bodies** reachable via those two seams: the three `*ConversationMessage` builders (`conversation.ts`, dispatched by `agentOperations.ts:59-71`) + `rememberConversation` (`memory.ts:24-86`). |
| **B. Rebuild in TS (lore-free core)** | RuntimeMindState shape + `Affect.Current` decay; the **derived-window** episodic ring (S10); MemoryCompactor `ConsolidateForOwner` (4-slot re-fold-from-raw, salience gate, deltas-from-raw, ImpressionDelta); `ParseEmotion`/`ParseAffectionDelta`/slot-extract; ContextAssembler **§2 + §3 + §5.x only**; constants verbatim; Grok branch in `llm.ts`; embeddings removal | Faithful TS rebuild per the verbatim extract ([_jynew_phase3d_extract.md](_jynew_phase3d_extract.md)), adapted to Convex idioms. |
| **C. Build new** | Hand-authored **persona-config** + **PC-side surface descriptor** schema + Convex seed (replaces jynew lore pipeline + `bios.json`/`dossiers.json`); single-NPC world seed | Persona-only; no novel scan, no canon. |
| **D. DELETE (lore)** | WorldCodex (§1), CharacterDossier (§4), RelationshipGraph (v4 §3.2), lore JSON ingestion, 4-canon roster, canon-provenance invariant, `SPOILER_EXCLUSIONS` | Never created. Assembler omits §1/§4 by design. |
| **E. DEFER (in plan, not now)** | Battle/hostility/INV-8/subdue/inventory (v4 §5–§6); interest-weighted selection (v4 §3.1); RelationshipGraph (v4 §3.2); long-term/ToM layer; GlobalReflection *exercised*; new map | Carried by reference to v4; gated in §7. |

---

## 2. Non-negotiables (faithfulness invariants — reviewer-checked)

- **N1 — Decay math, exact.** `Affect.Current(now) = Baseline + (Value −
  Baseline) · exp(−(now − LastSetMs) / HalfLifeMs)`; guard
  `HalfLifeMs ≤ 0 → return Value`. Lazy, on-read, never ticked
  (`RuntimeMindState.cs:51-56`).
- **N2 — Episodic ring = derived window over the durable `messages`
  table (see S10).** There is **no** separately maintained ring
  structure, **no** eviction, **no** spill bookkeeping. ai-town's
  `messages` table (NPC turns written by `agentSendMessage`, player
  turns by `messages.writeMessage`, read by `conversationId` via
  `api.messages.listMessages` — `conversation.ts:237`) **is** the
  durable per-conversation transcript jynew emulated with an in-memory
  ring + MemoryStash. The ring is computed **read-only inside the two
  ops**:
  - **Window rule (reproduces jynew anchor + last-9 exactly):** for the
    current/just-ended `conversationId` messages in creation order
    `m[0..k−1]`: if `k ≤ MEMORY_RING_CAP` (10) → window = all; else
    window = `{ m[0] (pinned anchor) } ∪ { m[k−9 .. k−1] }`. `m[0]` =
    first turn of the conversation, pinned; the most recent 9 follow
    (mirrors `EpisodicRing.cs:84-95` Ring[0]-anchor + last-9).
  - **Reflection re-fold (N4)** reads the **full** just-ended
    conversation transcript from `messages` (= jynew's spill ∪ ring),
    oldest-first, lines `"<SpeakerDisplayName>: <text>"` (N13 supplies
    the display name; never a raw engine id).
- **N3 — Recent-turn sourcing & no-under-render (replaces jynew's
  co-location).** Because the ring is derived from the **committed**
  `messages` table, the jynew "ring-append before async" invariant is
  satisfied structurally: ai-town persists the player turn
  (`messages.writeMessage`) **before** the NPC's `agentGenerateMessage`
  op runs, and the NPC turn (`agentSendMessage`, `agentOperations.ts:80`)
  **after** the op returns; consolidation (`agentRememberConversation`)
  runs at conversation end with all turns persisted. Test (lands in 1B,
  §0.5): a `continueConversationMessage` prompt built after a turn is
  persisted **contains that turn** via the derived window (no
  under-render). **No co-appended write is introduced → FSM, the two
  seam signatures, `agentSendMessage`, `messages.writeMessage` stay
  UNTOUCHED (N11 / bucket A).**
- **N4 — Re-fold-from-raw.** Reflection rebuilds the summary from **raw
  turns only** (the full just-ended conversation transcript, oldest-
  first); the prior `ReflectionSummary` is **deliberately excluded** as
  Grok input — anti-degradation, no summary-of-summary
  (`MemoryCompactor.cs:66-216`).
- **N5 — 4-slot output, parsed exactly.** Slots `往来印象：`/`情绪变化：`/
  `好恶变化：`/`违背设定：`; `往来印象` missing ⇒ abort fold (no partial
  write); `ParseEmotion` (first-float magnitude; neutral set incl.
  平静/无/无明显变化/无变化/空/none/None/neutral/Neutral; default
  intensity 0.5) and `ParseAffectionDelta` (first signed float, clamp
  [−1,1]); `ExtractSlot`/`ExtractFirstFloat`/`HasContradiction` ported
  exactly (`MemoryCompactor.cs:252-275, 491-630`).
- **N6 — Salience gate, full predicate.** `trivial = (|affDelta| <
  AFFECT_DELTA_DEADBAND 0.08) AND emotionNeutral`. The **summary is
  always folded** — `ReflectionSummary` / `ImpressionDelta` /
  `CompactedSummary`-equivalent are written by the Step-5 path that
  **precedes** the gate (`MemoryCompactor.cs:193-235`); when `trivial`
  **only** the affect-delta application + `LastSetMs` reset are skipped,
  so baseline-reversion decay still fires for a chatty pair
  (`MemoryCompactor.cs:232-275`).
- **N7 — Deltas from RAW, not decayed.** Applied emotion/affection
  deltas are the model's read of the **raw turns**, not
  `Affect.Current(now)` (`MemoryCompactor.cs:237-275`).
- **N8 — Affect application detail (exact).** When `!trivial`:
  Emotion → `Label=emotionLabel`, `Value=clamp01(intensity)`,
  `Baseline=0`, `HalfLifeMs=EMOTION_HALFLIFE_MS`, `LastSetMs=now`.
  Affection → `Value=clamp(Value+affDelta,−1,1)`, `LastSetMs=now`,
  **do not overwrite `Baseline`/`HalfLifeMs`**, and **`if (emotionLabel
  non-blank && !emotionNeutral) Affection.Label = emotionLabel`**
  (the optional standing-hint write — `MemoryCompactor.cs:273-274`;
  feeds §5.5.1 render `ContextAssembler.cs:701-706`). Post-fold:
  `Ring.Clear()`/`IsFolded` are **no-ops here** (S10) — reflection is
  per-`conversationId`; nothing to clear.
- **N9 — Anti-omniscience seal.** The §3 talkee-surface builder accepts
  **only** `(bioName, sex, ageText, appearance, surfaceManner)` — it
  structurally cannot read the talkee's Personality/Identity/Plans/
  Relationships. Do not widen the signature; the narrow argument list
  *is* the guard. Both appearance+manner empty ⇒ §3 omitted
  (`ContextAssembler.cs:342-380`).
- **N10 — Constants verbatim.** `SECT_SELFBIO_BUDGET=600`,
  `SECT_TALKEE_BUDGET=400`, `SECT_SHORTTERM_BUDGET=4000`
  (§1=1500/§4=3000 retained as constants though unseeded);
  `EMOTION_HALFLIFE_MS=90000`, `EMOTION_FLOOR=0.12`,
  `AFFECTION_HALFLIFE_MS=900000`; `MEMORY_RING_CAP=10`,
  `AFFECT_DELTA_DEADBAND=0.08`; `REFLECT_MAX_TOKENS=500`,
  `REFLECT_TEMPERATURE=0.3`; emotion default intensity `0.5`;
  `GLOBAL_REFLECTION_MAX_CHARS=300` (`AITavernConstants.cs`,
  `MemoryCompactor.cs:51,405`; extract §7).
- **N11 — Engine discipline.** All Grok calls in the two
  `internalAction` ops that write back via inputs; FSM
  (`agent.ts`/`conversation.ts` FSM), the two seam signatures,
  `agentSendMessage`, `messages.writeMessage`, and the `worlds` doc
  untouched; `mindState`/`persona` live in `convex/agent` tables.
- **N12 — Read-time decay rendering.** `EmotionLine` omits §5.4 when
  `Current(now) < EMOTION_FLOOR`; `PerTargetBlock` renders affection via
  `Affection.Current(now)`; ring's last line marked
  `［刚刚结束的对话］`; all-empty per-target block omitted. The
  relocated §5.5 ImpressionDelta render is **read-only**: `TryGetValue`
  only, **never** `GetOrCreateMind`, **never** writes `mindState` back
  (the exact discipline of the deleted §4 host —
  `_jynew_phase3d_extract.md:751-768`) (`ContextAssembler.cs:597-608,
  670-718`).
- **N13 — Identity/speaker sourcing (lore-free + PC-side).** jynew's
  `FormatParticipantHeader` reads `bio.Identity` into the reflection
  user-body header (`MemoryCompactor.cs:665-675`) and returns the raw
  `id.Value` when no Bio exists. Lore-free rule: the **NPC** header
  degrades to **`bioName` only** (no `ShortIdentity`/Identity
  parenthetical — faithful because the lore-free persona has no Identity
  slice, mirroring S2's degrade-cleanly). The **PC** is sourced from the
  §6 PC-side surface descriptor: its `displayName` feeds (a) §3
  `BuildTalkeeSurface` when the PC is talkee, (b) the `对话的另一方`
  reflection header, (c) ring/summary speaker attribution
  (`ContextAssembler` `SpeakerName`/`TalkeeName`). **No raw engine id is
  ever rendered into a prompt or memory.** `PlayerPersona.displayName`
  is the **canonical** PC name for all memory/prompt artifacts and must
  be seeded consistently with ai-town's native
  `playerDescriptions.name` (or treated as authoritative) so the
  derived-window ring render and the §3 / reflection-header cannot
  disagree on the PC's name within one prompt (lens-3 Round-2
  recommend). *Citation note:* the `FormatParticipantHeader` line range
  (`MemoryCompactor.cs:665-675`) is **inferred** from helper clustering;
  re-ground to source-grade at implementation. The behavioral claim
  (raw `id.Value` when no Bio; lore-free header degrades to `bioName`)
  is corroborated by the extract and design intent.

---

## 3. What changes vs. jynew (documented simplifications)

- **S1 — §1 WorldCodex: not created.** Assembler omits §1. (Removes
  "world knowledge.")
- **S2 — §4 CharacterDossier: not created.** Assembler's `BuildLongTerm`
  returns `null` → §4 omitted. (Removes "faction" + "martial-art"
  knowledge exactly.) ImpressionDelta loses its §4 host → S6.
- **S3 — RelationshipGraph: not created → AffectBaseline = constant 0.**
  Every pair `Neutral`; `Affection.Baseline=0`,
  `HalfLifeMs=AFFECTION_HALFLIFE_MS`. The `AffectBaseline.ForRelation`
  switch is ported intact (values preserved for the deferred multi-NPC
  future) but **all seeding uses Neutral→0** this iteration. **This is
  semantically correct, not merely "moot": a non-canon stranger has no
  prior disposition — neutral *is* her true baseline toward an unknown
  player; affect spikes from a conversation and relaxes back to neutral
  over `AFFECTION_HALFLIFE_MS`.** N1 unchanged.
- **S4 — GlobalReflection: ported faithfully, gated, not exercised.**
  `FoldGlobalReflection` ported with **all** v4 §4D carried guarantees:
  flat fold over already-distilled per-pair summaries (never raw, never
  recursive); **output-only** (writes only `mind.GlobalReflection`);
  **≥2 non-blank per-pair summaries gate, else skip *and do not clear*
  an existing one**; cross-pair staleness intentional; strict
  per-pair-before-global order; **best-effort: a Grok failure / empty
  response logs and bails WITHOUT touching `GlobalReflection` and MUST
  NOT corrupt already-written per-pair state**
  (`_jynew_phase3d_extract.md:531,549-567`). With one pair → gate yields
  <2 → no-op (no Grok call, no token spend, no block); never fires this
  iteration.
- **S5 — 违背设定 slot: reframed, not removed.** jynew's slot already
  scopes to 「人物设定/常识」 (character-settings / common-sense), not
  novel canon (`_jynew_phase3d_extract.md:389,1193-1196`). Kept as the
  4th slot verbatim in structure; only the **system-prompt wording** is
  rewritten from the 武侠 framing to generic-persona framing. With a
  hand-authored persona this becomes a genuine **persona-drift
  detector** (flags when the NPC's turns drift off her authored
  personality) — *more* meaningful than the canon case; parsed by
  `HasContradiction`, logged as a tripwire, **zero gameplay effect**
  (matches jynew `Debug.LogWarning`, `MemoryCompactor.cs:284-290`). Not
  dead code — do not later remove.
- **S6 — ImpressionDelta relocated §4 → §5.5.** With §4 gone the runtime
  overlay is rendered inside the §5.5 per-target block, next to
  `往来印象（已沉淀）`. **Write contract unchanged** (`AppendImpressionDelta`,
  cap 3 entries / 600 chars, overlay-only/never-canon,
  `MemoryCompactor.cs:277-282,636-660`). **Render contract preserved
  (N12):** the relocated site is **read-only** (`TryGetValue`, never
  `GetOrCreateMind`, never writes back), exactly as the deleted §4 host.
  **Semantics note:** the overlay's *meaning* shifts from
  "deviation from immutable canon" (its jynew role under
  `PersonView.Impression`) to "most-recent folded impression layered
  over the settled summary"; placing it beside §5.5.2 makes that new
  meaning read correctly to the model. One of two structural relocations
  (with S10); reviewer-checked.
- **S7 — Reflection prompt framing.** `BuildReflectSystemPrompt`
  rewritten: drop 「某武侠人物」, use a neutral "this character".
  **Keep verbatim:** Chinese-only output rule; raw-only / no-prior-
  summary rule; attribution-句式 rule (「他声称」「据其所见」); the exact
  4-line prefixed output contract (slot prefixes byte-identical, the
  parser keys on them — N5); "缺失内容写「空」". `BuildReflectUserBody`
  keeps the `【原始逐字对话】` raw-concatenation shape; the participant
  header follows N13 (no Identity; PC displayName). The rewritten system
  prompt must **explicitly name the reference frame** for 违背设定:
  drift is judged against the **NPC's authored §2 personality** (the
  only persona in scope), *not* the PC's behavior (lens-3 Round-2
  recommend) — so the detector flags NPC voice-drift, not PC conduct.
- **S8 — Interest-weighted selection (v4 §3.1): not this iteration.**
  `findConversationCandidate` is an `internalQuery` invoked from the
  `agentDoSomething` op (`agent.ts:336`, `agentOperations.ts:150`) — not
  the FSM (carries v4 ai-town-lens MUST-FIX 3 by reference). With one
  NPC + the PC, `otherFreePlayers ≤ 1` so the native nearest-sort
  (`agent.ts:365`) is trivially deterministic; native initiation in
  `Agent.tick` (`agent.ts:78-92`) is unaffected. Safe to defer.
- **S9 — Persona replaces the pipeline (lore-free heir of v4 §0.2
  PATCH asymmetry).** A hand-authored `persona` record supplies the
  surviving `CharacterBio` persona-core fields. ai-town's existing
  `agentDescription.identity/plan` remain for the FSM but are **not**
  fed into ContextAssembler §2/§3 — persona-core and FSM identity/plan
  stay **disjoint, neither clobbers the other**, which is the surviving
  spirit of the v4 §0.2 "bios = PATCH-only, never clobber hand-authored
  identity/plan" asymmetry (the JSON ingestion itself is moot, deleted
  with the pipeline).
- **S10 — Episodic ring = derived window over `messages` (deliberate
  Convex-idiomatic adaptation; documented simplification).** jynew kept
  an in-memory ring + a MemoryStash with `[spill]`/`IsFolded`/
  `Ring.Clear()` *because Unity had no durable per-conversation
  transcript store*. ai-town's `messages` table already is exactly that
  (durable, per-`conversationId`, queryable). Therefore the in-memory
  ring, the `[spill]` marker, `IsFolded`, and `Ring.Clear()` are
  **unnecessary no-ops** — nothing is ever lost, so eviction/spill/clear
  have no referent. The **window rule (N2) reproduces the identical
  anchor+last-9 render**, and **re-fold reads the identical input**
  (jynew's spill ∪ ring = the full conversation transcript). Ring "clear
  after consolidation" is implicit: reflection is scoped per
  `conversationId`; the next conversation has a fresh message set;
  cross-conversation durable disposition (`Affect`/`Affection`/
  `ReflectionSummary`/`ImpressionDelta`) lives in the `mindState` table,
  not `messages`. **Faithful to behavior** (identical render, identical
  re-fold input) **while honoring N11** (no co-appended write, FSM/
  writers untouched). Reviewer-flagged as the second structural
  adaptation (with S6).

---

## 4. Target architecture

```
convex/util/llm.ts            + 'grok' to LLMConfig.provider union (llm.ts:38);
                              + grok branch in getLLMConfig PLACED BEFORE the
                              LLM_API_URL custom branch (llm.ts:75) so the
                              llm.ts:81 'LLM_EMBEDDING_MODEL is required' throw
                              is never reached; embeddingModel:'' (off)
convex/init.ts                seed via init({numAgents:1}); NO edit to init.ts:31
convex/agent/schema.ts        DROP memoryEmbeddings+vectorIndex, embeddingsCache,
                              memories.embeddingId, memories.importance;
                              ADD mindState + persona + playerPersona tables
                              (NO worldCodex/dossier)
convex/agent/persona.ts       NEW — persona + PC-surface seed/accessor
convex/agent/mindState.ts     NEW — RuntimeMindState table I/O + Affect decay
convex/agent/contextAssembler.ts  NEW — §2 + §3 + §5.x (no §1/§4); N9 seal; N13
convex/agent/memory.ts        REPLACE rememberConversation → reflection op;
                              DELETE searchMemories/rankAndTouchMemories/
                              calculateImportance/fetchEmbedding
convex/agent/conversation.ts  ContextAssembler PREPENDED before existing memory
                              block (1A coexistence); embeddingsCache.fetch +
                              searchMemories removed at 1D; derived-ring read
                              via api.messages.listMessages (N2/N3) — read-only
convex/aiTown/agentOperations.ts  UNCHANGED signatures/write-back (seam only)
convex/crons.ts               REMOVE 'memoryEmbeddings' from TablesToVacuum
                              (crons.ts:37 — compile + runtime blocker);
                              mindState/persona/playerPersona NOT added to it
convex/testing.ts             wipeAllTables excludedTables → [] once
                              embeddingsCache table dropped (compile blocker)
data/characters.ts            Descriptions[0] = the girl (sprite f1–f8)
convex/constants.ts           + the N10 constants
```

- **4.1 State placement.** `mindState` (per-target Affect/Affection/
  ReflectionSummary/ImpressionDelta), `persona`, `playerPersona` live in
  `convex/agent` tables (sibling `agentTables` merged in
  `convex/schema.ts`), **never** the `worlds` doc. Durable layered
  memory lives in **`mindState`**, **not** the `memories` table (the
  `memories` table is vacuumed by `crons.ts:34` — using it would let
  `VACUUM_MAX_AGE` silently delete durable disposition, violating
  N1/L4). Pre-declared index: `mindState.index('owner_target',
  ['ownerAgentId','targetPlayerId'])` (10-turn-equivalent window is
  derived from `messages`, so the `mindState` doc is tiny — well within
  Convex's 1 MB doc limit). No engine-doc additions (no `battle?`/
  `subdued?` — deferred).
- **4.2 LLM rule.** Grok dialogue + reflection in the two
  `internalAction` seams; ~1.5 s round-trip fine for turn-based PC↔NPC
  chat (v4 §1.3).
- **4.3 Migration — one-shot fresh-world reset (ordered).** Dropping
  `memoryEmbeddings`+`vectorIndex` orphans `memories.embeddingId`
  (schema-breaking) and `embeddingsCache`'s presence in
  `testing.ts` `excludedTables` becomes an invalid `TableNames` literal
  (compile blocker — moved into the §5 1D removal checklist; post-drop
  the list becomes `[]`). Reset is **ordered**: (1) `wipeAllTables`
  schedules paginated `deletePage` continuations
  (`testing.ts:29`); (2) **all continuations must fully drain** (no
  pending `vacuumTable`/delete pages) **before** `init({numAgents:1})`
  runs, else the new single-NPC seed races half-deleted `worlds`/
  `inputs`/`worldStatus` and double-seeds or no-op-seeds (the
  `shouldCreateAgents` guard returns false if `world.agents.length>0`
  *or* an unactioned `createAgent` input exists — `init.ts:90-113`).
  No production data exists; documented, not silent (v4 §4D / R8).

---

## 5. Phase sequencing (this iteration = P0 + P1 only)

### P0 — Foundations

| T | Task | Detail / file:line |
|---|---|---|
| 0.1 | **Grok provider** | `llm.ts`: add `'grok'` to the `LLMConfig.provider` union (`llm.ts:38`); add a `grok` branch in `getLLMConfig` **before** the `LLM_API_URL` branch (`llm.ts:75`), gated on `LLM_PROVIDER==='grok'` (or `XAI_API_KEY`), returning `{provider:'grok', url:'https://api.x.ai/v1', chatModel: env ?? 'grok-4.20-non-reasoning' (per GrokClient.cs:30), embeddingModel:'', stopWords:[], apiKey: XAI_API_KEY}`. Keep `chatCompletion` signature stable. |
| 0.2 | **Embeddings-off guard path** | With default `EMBEDDING_DIMENSION=OLLAMA_*` (`llm.ts:7`), `detectMismatchedLLMProvider` (`llm.ts:9-35`, called `init.ts:17` **and** `llm.ts:93`) hits `case OLLAMA: break` → **does not throw**; the `grok` branch (0.1) returns before the Ollama fallback so `llm.ts:92-97` is never reached, and before the custom branch so the `llm.ts:81` `LLM_EMBEDDING_MODEL` throw is never reached. **No guard edit needed** for the default dimension; keep `EMBEDDING_DIMENSION` default and document this (do not set a non-default dimension). All embedding *call sites* are deleted at 1D. |
| 0.3 | **Persona + PC-surface config** | `convex/agent/persona.ts` + `persona`, `playerPersona` tables (schema §6); Convex seed. **Content user-supplied (L2)**; plan ships schema + template. |
| 0.4 | **Single-NPC world** | Seed by invoking `init({numAgents:1})` (`init.ts:14,31` `numAgents` arg path — **no source edit to line 31**); `data/characters.ts` `Descriptions[0]` = the girl (existing sprite f1–f8, zero new art); reuse default map (L3). Verify `shouldCreateAgents`/`getOrCreateDefaultWorld` idempotency (§4.3). |
| 0.5 | **Test scaffold** | Jest. Suites: Affect decay golden vectors (N1); **derived-window** anchor/last-9/≤cap (N2, S10); a **golden test pinning the `messages` index iteration order** (oldest-first; `api.messages.listMessages` uses `.withIndex('conversationId').collect()` with **no `.order()`**) on a ≥11-message conversation — assert anchor `= m[0]`, window `= {m[0]} ∪ {m[k−9..k−1]}` — so a future Convex SDK change cannot silently regress the derived window (lens-2 Round-2 recommend); **no-under-render assertion — lands with 1B, not P0**; salience-gate predicate (N6); slot-parse incl. neutral set + default 0.5 (N5); ContextAssembler section-order/omission/budgets/anti-omniscience (N9/N12); N13 identity/speaker (no raw id; PC displayName). |

### P1 — Lore-free layered memory (faithful Phase 3D, mirrors v4 4A→4D)

- **1A — Static spine.** `persona`+`playerPersona` tables +
  ContextAssembler **§2 self-bio** (`Personality`, talker-only) + **§3
  talkee-surface** (N9 seal; PC-side surface from `playerPersona` per
  N13). §1/§4 structurally absent (S1/S2). Block **prepended** before
  the retained existing prior-memory block (no recency-dip; old path
  kept until 1D — v4 §4A coexistence). §5.1 situation carries a plain
  "designer-set scene" note (no canon claim).
- **1B — Working memory + derived ring.** `RuntimeMindState`
  (Situation/Task/Surroundings) in `mindState`. Implement the
  **derived-window ring read** (N2/S10) over `api.messages.listMessages`
  inside the two ops; **land + verify the no-under-render assertion
  (N3) here**. **MUST precede 1D.**
- **1C — Affect with decay.** Emotion + per-target Affection; lazy
  `Math.exp` ms-epoch decay (N1); `EMOTION_FLOOR` omit (N12); affection
  baseline = constant 0 (S3).
- **1D — Consolidation.** Replace `rememberConversation`
  (`memory.ts:24-86`) with the **4-slot re-fold-from-raw** op (N4/N5),
  generic-persona prompt (S5/S7), salience gate (N6), deltas-from-raw
  (N7), affect application incl. the `Affection.Label` write (N8),
  derived-window ring (N2/S10 — no spill/clear code), ImpressionDelta
  overlay relocated to §5.5 read-only (S6/N12), `FoldGlobalReflection`
  ported with all carried guarantees but ≥2-gated/no-op (S4),
  participant header/speaker per N13. **Removals (compile/runtime
  blockers):** `memoryEmbeddings`+`vectorIndex`, `embeddingsCache`
  (table + the `testing.ts` `excludedTables` literal → `[]`),
  `memories.embeddingId`/`memories.importance`, **`'memoryEmbeddings'`
  from `crons.ts:37` `TablesToVacuum`**, `searchMemories`/
  `rankAndTouchMemories`/`calculateImportance`/`fetchEmbedding`;
  ContextAssembler becomes **sole transcript source**; Leave = **lean
  profile** (§2 self-bio + §5.4 emotion + §5.5.3 ring only). Ordered
  one-shot reset (4.3).

**Exit (this iteration):** the single 18-year-old-girl NPC holds
in-character Grok PC↔NPC conversations with the **lore-free** layered
human memory — derived-window episodic ring, post-conversation
reflection consolidation, emotion/affection decay-to-baseline,
ImpressionDelta overlay — zero embeddings, zero world/faction/martial
knowledge, no memory-continuity regression mid-port.

---

## 6. Persona + PC-surface schema (USER-SUPPLIED — L2)

Two records replace `bios.json`. The user provides **content**; this
plan fixes the **shape**.

```ts
// convex/agent/persona.ts  (one NPC this iteration)
type Persona = {
  agentId: string;          // links to the seeded agent (TALKER role)
  bioName: string;          // §2/§3 header + N13 reflection header (NPC)
  sex: 'female';            // §3
  ageText: string;          // §3  e.g. "18岁"
  personality: string;      // §2 自我设定 — TALKER-ONLY self (≤ SELFBIO 600)
  appearance: string;       // §3 外貌 — first-impression surface (≤ TALKEE 400 w/ manner)
  surfaceManner: string;    // §3 气度 — first-impression demeanor
  defaultSituation: string; // §5.1 designer scene seed (plain, non-canon)
  defaultTask: string;      // §5.2 designer task seed
};

// PC-side surface descriptor (N13/MF: the PC is the TALKEE for every
// PC↔NPC turn; without this §3, the reflection 对话的另一方 header, and
// ring/summary speaker attribution have no source and degrade to a raw
// engine id). Schema-only; content user-supplied, sensibly defaulted.
type PlayerPersona = {
  playerId?: string;        // optional; falls back to a single default record
  displayName: string;      // N13 (a)(b)(c) — never a raw id; default e.g. "旅人"
  appearance: string;       // §3 when PC is talkee (what the NPC first sees)
  surfaceManner: string;    // §3 when PC is talkee
};
```

**Anti-omniscience boundary (this iteration — corrected framing).** The
only Full-profile assembly is **talker = NPC, talkee = PC** (the PC is
human, has no mind, and no ContextAssembler runs for the PC). So:
- `Persona.personality` (§2) is **talker-only** — it renders as the
  NPC's own self-voice and **never** in any §3/§5.5 block representing
  the PC's surface or the NPC's view *of* the PC; `ImpressionDelta` and
  `ReflectionSummary` are the **NPC's own** and are never rendered as
  the PC's. N9's narrow §3 signature enforces this structurally.
- The PC's side is sourced **only** from `PlayerPersona` surface fields
  (appearance/manner/displayName) — never from any NPC-private field.
There is no PC-as-talker path this iteration; do not "protect" a
non-existent path — the operative guard is the §2-talker-only / §3-seal
boundary above.

> **TEMPLATE the user fills (collected before implementation):**
> NPC — name; age 18; personality (§2, who *she* is); appearance (§3);
> manner (§3); opening situation/task (§5.1/§5.2). PC — display name;
> the appearance/manner the NPC perceives (a minimal "who is this
> person in front of me" — defaults to a generic traveler if unset).

---

## 7. Deferred (in plan, NOT this iteration) — explicit, not dropped

Carried by reference to v4; gated behind this iteration's exit:

- **Battle / hostility / INV-8 / disposition / Subdued / inventory** —
  v4 §5–§6 verbatim. **Open tension flagged (must resolve before the
  battle round):** v4's battle is built *entirely* on jynew Lua 武功/
  skill/character data; a plain non-canon 18-year-old girl has **no
  武功**. Reconciling a generic persona with a wuxia-derived combat
  dataset is unresolved — recorded now, re-planned (own review round)
  before any battle code.
- **Long-term-knowledge / Theory-of-Mind layer** — §4 + the §5.5.4 ToM
  line (v4 §0.6; `_jynew_phase3d_extract.md:1102`) are *not built* (no
  canon, single NPC). Re-opens with RelationshipGraph in the multi-NPC
  future.
- **Interest-weighted selection (v4 §3.1) + RelationshipGraph
  (v4 §3.2)** — meaningful only with ≥2 NPCs.
- **GlobalReflection exercised** — fires only at ≥2 pairs (S4).
- **New 2D map authoring** — default map this iteration (L3).

Any of these re-opens a dedicated review round when scheduled.

---

## 8. Scope fence — what this is NOT

Not lore (no WorldCodex/Dossier/world/faction/martial knowledge). Not
射雕 canon, not the 4-canon roster, not the lore pipeline, not
embeddings. Not battle/hostility/INV-8/subdue/inventory *this iteration*
(deferred, not cancelled). Not a long-term/ToM layer *this iteration*.
Not interest-weighted selection / RelationshipGraph *this iteration*
(single NPC). Not a new map. Not a C# copy (faithful TS rebuild). Not a
redesign of the memory machine — the N-invariants are ported exact; S6
(ImpressionDelta host) and S10 (derived-window ring) are the only two
structural relocations, each behavior-preserving and reviewer-checked.

---

## 9. Risks & decisions

| # | Item | Disposition |
|---|---|---|
| R1 | Persona is the **sole** semantic spine (no lore) | §2/§3 quality depends entirely on the user-supplied persona; budgets `SELFBIO 600`/`TALKEE 400` enforced; empty appearance+manner ⇒ §3 omitted (N9). Persona + PC-surface templates (§6) make the contract explicit. |
| R2 | AffectBaseline = constant 0, no graph (S3) | Semantically correct for a non-canon stranger (no prior disposition); switch ported intact for the deferred multi-NPC future; N1 decay unchanged. |
| R3 | GlobalReflection moot with one pair (S4) | Ported with **all** v4 §4D guarantees incl. **no-clobber-on-skip** + **failure-must-not-corrupt-per-pair**; ≥2-gate ⇒ no-op; not exercised; ready for multi-NPC. |
| R4 | 违背设定 with no canon (S5) | jynew text already 「人物设定/常识」-scoped; reframed wording → **persona-drift detector**; tripwire-log only, zero gameplay effect. Not dead code. |
| R5 | ImpressionDelta loses §4 host (S6) | Relocated into §5.5; **write contract AND read-only render discipline** (TryGetValue, never GetOrCreateMind/write-back) both preserved (N12); semantics shift (canon-deviation → recency overlay) documented. The 1st of 2 structural relocations — reviewer-checked. |
| R6 | Reflection prompt 武侠→generic (S7) | Only prompt *wording* changes; 4-slot contract / slot prefixes / raw-only / attribution-句式 / Chinese-only / "缺失→空" kept verbatim (N4/N5 intact). |
| R7 | Schema-breaking embeddings drop | Ordered one-shot reset (4.3): wipe **fully drains before** reseed; `testing.ts` `excludedTables`→`[]` and `crons.ts:37` `'memoryEmbeddings'` removal are **compile/runtime blockers** in the 1D removal checklist (not parentheticals). |
| R8 | Derived-ring read-path before old-transcript removal (N2/N3/S10) | The derived-window read + no-under-render test land in **1B**, **before** 1D removes the old transcript path. No co-appended write (N11 intact). |
| R9 | Generic-girl vs. wuxia battle dataset | Out of scope this iteration; **explicitly flagged**, deferred, re-planned before the battle round (§7). Not hand-waved, not pre-solved. |
| R10 | `crons.ts` references the dropped `memoryEmbeddings` table | `crons.ts:37` removed from `TablesToVacuum` (compile + daily-cron runtime blocker); durable layered memory lives in `mindState` (NOT the vacuumed `memories` table); `mindState`/`persona`/`playerPersona` are NOT added to `TablesToVacuum` (decay-not-delete per N1/L4). |
| R11 | §4 deletion removes long-term + §5.5.4 ToM layer (v4 §0.6) | This iteration's context model is **§2 + §3 + §5.x only**; N9 is now the **sole** omniscience guard and it covers only §3. No ToM layer is built (correct per L3/L4 — no canon, single NPC); the loss is **explicit**, not silent. v4's validated context model always had §4 — that consensus does not extend here (see R12). A ToM/long-term layer re-opens with RelationshipGraph (§7). |
| R12 | Provenance scope | v4's 4-lens consensus was for v4's *scope*; this plan is a *subset* — consensus does **not** transfer. This doc earns its own consensus (§11). "no drift" is **not** claimed: core memory seams re-verified accurate this session; two foundation cites were **corrected** at re-grounding (the embeddings-guard path is `llm.ts:81` custom-branch / `detectMismatchedLLMProvider` OLLAMA-break, not a blanket "disable 80-81"; single-NPC is the `init({numAgents:1})` arg, not an `init.ts:31` edit). |
| R13 | `worldDescription` static prose vs. map swap (S11) | `worldContext.ts` ships hand-authored Chinese prose faithful to the default `data/gentle.js` map (L3-locked). If the map is later swapped, the prose becomes wrong (NPC describes the old map). Documented in `worldContext.ts` header; the §5.3 contract guarantees live position + ambient updates, but NOT live world prose. Acceptable trade-off (no Grok call per turn) for the single-map dev trial; revisit if/when a map swap is planned. L2 boundary: `worldDescription` is **map** prose (L3-scoped), NOT **persona** prose (L2-scoped) — L2 is unaffected. |

## 10. Sequencing & size

P0 → P1 (1A → 1B → 1C → 1D; **derived-ring read + no-under-render test
(1B) before old-transcript-source removal (1D)**). P1 is the bulk. Each
sub-phase independently committable/testable against §0.5. Deferred work
(§7) is separately planned and re-reviewed when scheduled.

## 11. Review audit trail

### Round 0 (provenance)
Derived as a strict subset + documented simplification of v4 (4-lens
consensus-approved **for v4's scope only — not transferable**, R12).
jynew Phase 3D source + ai-town seams re-grounded to implementation
grade this session.

### Round 1 (v1 → v2) — all 4 lenses REQUEST CHANGES; every must-fix folded

- **Lens 1 (jynew fidelity) — REQUEST CHANGES.**
  - MF1 `FormatParticipantHeader` reads `bio.Identity` (a 2nd
    lore-reader) → **folded: N13** (NPC header degrades to bioName).
  - MF2 N8 missing `Affection.Label = emotionLabel` write → **folded:
    N8**.
  - R-A/B/C cite tightening + spill/ring line-format → **folded** (N6
    cite `:193-235`; N5 cites `:252-275,491-630`; line format in
    N2/S10; spill obviated by S10).
- **Lens 2 (ai-town/Convex engine) — REQUEST CHANGES.**
  - MF1 `crons.ts:34,37` references dropped `memoryEmbeddings` →
    **folded: §4, §5 1D, R10**.
  - MF2 ring-append "co-located in conversation.ts" not realizable
    (no shared append site; `agentSendMessage`/`writeMessage` outside
    the seams) → **folded: N2/N3 rewritten to derived-window-over-
    `messages`; new S10; R8 rephrased** (verified self:
    `conversation.ts:237`, `agentOperations.ts:80`).
  - MF3 stale cites (`init.ts:31 toCreate=1` wrong; `llm.ts` guard
    path) → **folded: §4, §5 0.1/0.2/0.4, R12** (verified self:
    `init.ts:14,31`; `llm.ts:7,9-35,75-93`).
  - MF4 one-shot reset under-specified; `excludedTables` compile
    blocker → **folded: §4.3, §5 1D, R7**.
  - R-a (four function bodies) / R-b (S8 cites) / R-c (mindState
    index, doc size) → **folded** (§1.1 bucket A, S8, §4.1).
- **Lens 3 (memory-semantics & persona) — REQUEST CHANGES.**
  - MF1 PC has no persona → §3 dead every turn, reflection header =
    raw id → **folded: §6 `PlayerPersona`, N13**.
  - MF2 §6 anti-omniscience framing points at a non-existent
    PC-as-talker path → **folded: §6 corrected boundary**.
  - R1 (违背设定 = persona-drift detector) / R2 (S3 stranger
    semantics) / R3 (ImpressionDelta semantics shift) → **folded:
    S5, S3, S6**.
- **Lens 4 (v4-faithfulness & scope) — REQUEST CHANGES.**
  - MF1 v4 §4D GlobalReflection no-clobber + no-corrupt guarantees
    dropped → **folded: S4, R3**.
  - MF2 S6 relocation dropped the read-only render half → **folded:
    S6, N12, R5**.
  - MF3 provenance over-claim "no drift" → **folded: R12, §11 Round 0;
    cites corrected**.
  - MF4 §4 deletion removes long-term + §5.5.4 ToM, unrecorded →
    **folded: R11, §7**.
  - R-A (S9 = lore-free heir of v4 §0.2 asymmetry) / R-B (§0.5
    no-under-render lands with 1B) / R-C (R9 force — preserve) →
    **folded: S9, §0.5, R9**.

### Round 2 (v2) — CONSENSUS: all 4 lenses APPROVE, zero blockers

Fresh independent re-review; each lens verified its Round-1 must-fixes
resolved without distortion **and** attacked the two new structural
changes (S10 derived-window ring; §6 `PlayerPersona`/N13).

- **Lens 1 (jynew fidelity) — APPROVE.** Verified line-by-line that the
  S10 window rule reproduces `EpisodicRing.cs:84-95` anchor+last-9
  *exactly* for every `k`, and re-fold receives the identical input
  jynew's spill∪ring produced; `Ring.Clear()`/`IsFolded` are *provably*
  no-ops under per-`conversationId` re-fold scoping; N8 `Affection.Label`
  write matches `MemoryCompactor.cs:273-274`; N13 degrade is the real
  jynew output for an Identity-less bio (not fabricated). No new defect.
- **Lens 2 (ai-town engine) — APPROVE.** Derived-window is realizable
  (the ops can call `api.messages.listMessages` as `previousMessages`
  already does, `conversation.ts:237`) and race-free (player turn
  committed before the generate op; FSM gates on
  `lastMessage`+`MESSAGE_COOLDOWN`); `.collect()`-no-`.order()`
  oldest-first is the same ordering the engine already relies on; all
  Round-1 cites now accurate. No new engine defect.
- **Lens 3 (memory-semantics/persona) — APPROVE.** §6 `PlayerPersona`
  + N13 fully close the raw-id/blind-§3 gap (all three sinks sealed);
  corrected anti-omniscience boundary is right; single-pair loop
  conceptually closed end-to-end under the derived-window ring; default
  "generic traveler" PC percept is semantically faithful, not
  incoherent.
- **Lens 4 (v4-faithfulness/scope) — APPROVE.** S10 is a
  behavior-preserving Convex-idiomatic adaptation (substrate change
  only), §6/N13 a strictly-forced minimal schema slot — neither is
  scope creep; nothing deferred is functionally pre-built (GlobalReflection
  faithfully ported then gated-to-no-op is what L1+L4 jointly require);
  provenance now honest (consensus explicitly non-transferable, R12).

**Post-consensus non-blocking refinements folded** (refinements *within*
consensus — test/citation/consistency/wording, **not** structural, so
review is **not** re-opened): (1) §0.5 — golden test pinning the
`messages` oldest-first index order (lens-2); (2) N13 —
`PlayerPersona.displayName` canonical & seed-consistent with
`playerDescriptions.name`; `FormatParticipantHeader` cite annotated
*inferred, re-ground at impl* (lens-3, lens-4); (3) S7 — rewritten
违背设定 prompt must name the NPC-§2 reference frame (lens-3).

**v2 was consensus-approved and ready for implementation** pending (a)
explicit user go-ahead and (b) user-supplied persona content (L2 / §6).

### Round 3 (v2 → v3) — POST-CONSENSUS MID-TRIAL AMENDMENTS, awaiting review

Trigger: user observed during 1A-1C trial that (i) the NPC was unaware
of the actual map (lived only inside her §5.1 narrative), and (ii) the
human player was being removed from the world after a conversation
ended. Two fixes + a coexistence guard + UI polish were applied without
spawning reviewers first. Per the plan-review workflow this section
records them as a v3 amendment (§12) and submits them to a fresh 4-lens
round (R3). Each lens carries its R2 verdict forward and must also
verify those R2 must-fix items remain resolved.

---

## 12. Mid-trial amendments (v3) — for Round 3 review

Four changes were applied between Round-2 consensus and the start of
P1-1D, while the user was trialing 1A-1C end-to-end. They are documented
here together so reviewers can attack them with full context. The N/S
invariant numbering is extended (S11, S12) where the amendments create
new behavior; engine-only patches (Fix B) and pure CSS (UI) are recorded
without inventing new N/S entries.

### 12.1 Fix A — NPC map awareness (new §5.3 data source) — STRUCTURAL

**Problem (observed in trial):** the NPC (琳娜) ignored the actual
ai-town `data/gentle.js` map and described the world as a 山谷 because
her §5.1 narrative seed dominated and §5.3 surroundings was empty (it is
only written by 1D's Grok-summarized path; 1A-1C left it null → omitted
by the assembler → no map awareness).

**Change:** new pure module
[convex/agent/worldContext.ts](../convex/agent/worldContext.ts) exporting
a hand-authored `worldDescription` (Chinese prose faithful to what
`data/gentle.js` actually renders — small rural town with cottages,
paths, gardens, trees, a pond) and `buildSurroundings({position,
ambientNeighborNames})` that returns: `worldDescription` + the talker's
current grid coords + names of other players in the world besides the
talker and the current talkee (talkee is already in §3). The text also
explicitly notes the dissonance with §5.1 (*"与你印象中'被群山环绕的山谷'
并不完全吻合 — 或许是你刚醒来时记忆混淆了"*) so the model can reconcile
the two coherently in-character.

In [convex/agent/conversation.ts](../convex/agent/conversation.ts)
`queryPromptData`, the per-turn `shortTerm.surroundings` is now an
**always-base + optional overlay** (v3.1, R3 lens-3 R-1):

```ts
const overlay = (mind?.surroundings ?? '').trim();
shortTerm.surroundings = overlay
  ? `${dynamicSurroundings}\n\n【近况（沉淀）】\n${overlay}`
  : dynamicSurroundings;
```

— the dynamic environment (worldDescription + position + ambient) is
**always** included; 1D's `mindState.surroundings` (when present) is
**appended as a brief overlay**, never as a replacement. Whitespace-safe
(blank overlay contributes nothing — closes the latent `??`/empty-string
fallthrough flagged by R3 lens-1 R-B).

**New invariant (S11 — §5.3 surroundings, base + overlay rule, v3.1):**
- *Always-on base:* `buildSurroundings(...)` (worldDescription + live
  position + ambient names) — computed every turn in `queryPromptData`.
  Permanent, never superseded. This guarantees real-map awareness for
  the entire lifetime of the project, not just the pre-1D window.
- *Optional overlay:* `mindState.surroundings` written by 1D's
  conversation-end reflection. Appended under a `【近况（沉淀）】`
  sub-header. **1D's surroundings-summarizer prompt MUST target "近况"
  / recent changes / what just happened around her** — NOT a full
  re-description of the world (which would duplicate the base). The
  base owns the static environment; the overlay owns post-event delta.
- *Whitespace-safe:* `overlay.trim() === ''` → no overlay rendered (no
  empty sub-header, no `??`/`||` truthy-vs-defined trap).
- *Post-1D end state:* base persists forever; overlay accumulates per
  conversation-end. The fallback is NOT dead code at 1D — it is the
  permanent §5.3 base. (Resolves R3 lens-4 R-4 / lens-3 R-1.)
- *Anti-omniscience:* `buildSurroundings` reads only `world.players`
  (for ambient names via `playerDescription.name`) + the talker's own
  position; it cannot read any talker/talkee private fields. N9
  unaffected.
- *N13 compliance:* ambient names are display names; no raw engine id.
- *Lean Leave profile:* §5.3 surroundings is part of working memory,
  excluded by the Leave profile — unchanged. Surroundings never enters
  the farewell prompt.
- *Faithfulness footnote (R3 lens-1 R-A):* jynew's `SurroundingsModel`
  is template-rendered by default; Grok-on-structural-change is a 3B+
  enhancement that does not fire in the shipped jynew "frozen NPC" path
  (`RuntimeMindState.cs:22-26`). The overlay can be either
  template-rendered or Grok-summarized depending on 1D's prompt design;
  the contract here is "1D writes a brief recent-change string into
  `mindState.surroundings`," provider-agnostic.
- *L2 boundary (R3 lens-4 R-2):* `worldDescription` is **map prose**
  (L3-coupled), NOT **persona prose** (L2-scoped). L2 — "persona is
  user-supplied" — refers to `Persona`/`PlayerPersona` schemas, which
  are unchanged. R13 in §9 tracks the map-swap brittleness.

**Why this is structural, not a documented simplification:** the
consensus-approved v2 plan implicitly committed §5.3 to the
jynew-faithful single-source `mindState` path. S11 introduces a *second*
always-on data source the plan did not specify. This is the third
structural change to the assembler's data flow after S6 (ImpressionDelta
relocation §4 → §5.5) and S10 (derived-window ring). Reviewer-checked
in R3.

**Risk added: see [§9](#9-risks--decisions) **R13**** (map-swap
brittleness of `worldDescription` — moved into the risks table per R3
lens-4 R-3 for parity with R1–R12).

### 12.2 Fix B — PC idle-kick (engine input-handler patch + constant) — NON-STRUCTURAL

**Problem (observed in trial):** the human player was auto-removed from
the world after each conversation ended. Root cause: `Player.tick`
([convex/aiTown/player.ts:85](../convex/aiTown/player.ts#L85)) calls
`this.leave(game, now)` when `lastInput < now - HUMAN_IDLE_TOO_LONG`
(5 min). Pre-Fix-B, `lastInput` was set **only by `Player.join`**
([player.ts:221](../convex/aiTown/player.ts#L221)) — neither chat nor
movement inputs updated it (R3 lens-2 R-2 correction; earlier draft of
this section incorrectly implied move inputs also set it). So a player
chatting for several minutes without re-joining got auto-kicked.

**Change:**
1. In [convex/aiTown/conversation.ts](../convex/aiTown/conversation.ts)
   `finishSendingMessage` handler, after the existing
   `conversation.lastMessage`/`numMessages` updates, look up
   `game.world.players.get(playerId)` and set `sender.lastInput = now`.
   The handler is the engine's input layer (mutates engine state via
   inputs — the sanctioned engine-write path); it does *not* mutate
   anything via the operations seam.
2. [convex/constants.ts](../convex/constants.ts) `HUMAN_IDLE_TOO_LONG`:
   `5 * 60 * 1000` → `30 * 60 * 1000` (5 min → 30 min) as a dev
   forgiveness buffer.

**Plan-invariant impact:** none. Does not touch the FSM/agent
seams/world doc structure (N11). `lastInput` is already an
engine-resident field on `Player` (player.ts:52,221); the patch writes
it from another input handler that already manipulates
`conversation.lastMessage`/`numMessages` — same engine-write rules apply.

**Carry-forward concern:** the `lastInput` write happens regardless of
whether the sender is human or NPC. NPC `agentSendMessage`
([agent.ts:319](../convex/aiTown/agent.ts#L319)) also calls
`finishSendingMessage` via `agentInputs.ts:108` for the NPC's own turns,
so the NPC's `lastInput` will also be bumped on every NPC message. But
the `Player.tick` idle check only kicks when `this.human` is set
(player.ts:85), so an NPC's `lastInput` being updated is harmless. Noted
for reviewers.

### 12.3 Embeddings-off coexistence guard — NON-STRUCTURAL (within R12 anticipation)

**Problem (impl-time, before trial):** the legacy memory path retained
by §4A coexistence calls `embeddingsCache.fetch` /
`memory.searchMemories` / `memory.rememberConversation` →
`fetchEmbedding` / `calculateImportance`. Under the new Grok provider
(P0.1) `embeddingModel = ''` and there is no `/v1/embeddings` endpoint —
those calls would throw and crash every conversation, blocking the
1A-1C trial entirely.

**Change:** new helper
[`embeddingsEnabled()`](../convex/util/llm.ts) in `convex/util/llm.ts`:
`return !!getLLMConfig().embeddingModel;`. Three narrow guards:
- `startConversationMessage`: skip `embeddingsCache.fetch` +
  `memory.searchMemories`; `memories = []`.
- `continueConversationMessage`: same.
- `rememberConversation` (legacy path): early-return when embeddings
  off (the body is wholesale replaced by 1D's 4-slot reflection op
  anyway).

A fourth guard was added in v3.1 (R3 lens-2 R-3): `testEmbedding` in
[convex/testing.ts](../convex/testing.ts) is an `internalAction` dev
tool that calls `fetchEmbedding` directly. Under Grok it would throw;
the guard returns `{ embedding: [], embeddingsDisabled: true }` so a
developer running the test tool sees a clear no-op instead of an opaque
HTTP error.

**New invariant (S12 — embeddings-off coexistence rule):**
- When `embeddingsEnabled() === false`, the legacy embedding-search
  memory block contributes **no related memories** to the prompt
  (`memories = []`). The ContextAssembler §2/§3/§5.x spine is the sole
  context source. No throws.
- The guards are scoped to the legacy path **only**; they introduce no
  new behavior on the new (ContextAssembler) path.
- **Trial-window behavior (R3 lens-3 R-5):** during 1A-1C while
  `embeddingsEnabled() === false`, the NPC has **no durable
  cross-conversation memory** of the PC (no embedding-search, no
  reflection-yet). This is **intentional** for the coexistence window
  — the missing cross-conversation memory channel is exactly what 1D's
  4-slot reflection consolidation (N4-N8) writes. Read an empty memory
  channel during trial as *the gap 1D fills*, not as a regression.
- All guards (the four conditional sites + `embeddingsEnabled()` helper
  itself + its tests in `llm.test.ts`) are deleted at 1D when the
  legacy path itself is removed — they are *temporary scaffolding* for
  the coexistence window. **1D removal checklist additions (R3 lens-1
  R-E):** `convex/util/llm.ts` `embeddingsEnabled()` function;
  `convex/util/llm.test.ts`; the four guard sites in
  `convex/agent/conversation.ts`, `convex/agent/memory.ts`,
  `convex/testing.ts`.

**Plan-invariant impact:** none on N1-N13 or S1-S10. Within v2 R12's
anticipated "core seams re-verified accurate this session; corrections
applied at impl time."

### 12.4 UI layout — NON-INVARIANT (pure CSS/JSX)

**Problem (observed in trial):** the game viewport was too small (max-w
1400px cap; lg:text-9xl title eating ~128px vertical; min-h-720
forcing scroll on short windows) and the chat panel too narrow
(lg:w-96 forcing wraps).

**Change:** in [src/App.tsx](../src/App.tsx) and
[src/components/Game.tsx](../src/components/Game.tsx) — reduce padding
(lg:p-8 → lg:p-2), shrink title (lg:text-9xl → lg:text-4xl), hide
tagline on lg, trim footer padding, remove min-h-[720px] cap, add
lg:h-full so the game fills available flex space, widen chat column
(lg:w-96 → lg:w-[28rem] / xl:w-[32rem] / 2xl:w-[36rem]).

**Plan-invariant impact:** none. Pure frontend layout; no backend code
or invariant touched. Out of reviewer scope but noted here for the
plan's completeness.

---

### Round 3 (v3 → v3.1) — CONSENSUS: all 4 lenses APPROVE, zero blockers

Trigger: v3 §12 documented four post-consensus mid-trial amendments
(Fix A NPC map awareness, Fix B PC idle-kick, embeddings-off guard, UI)
that shipped without review. Per playbook step-6 the structural piece
(Fix A / S11) re-opened a review round; for process discipline all
four were submitted to a full 4-lens pass.

Each lens verified its R2 must-fix items remain intact and attacked the
§12 amendments. **All four APPROVE; zero blockers.** R3 non-blocking
recommends were folded as v3.1 (same pattern as Round-2 close — not a
structural change, does not re-open review).

- **Lens 1 (jynew Phase 3D fidelity) — APPROVE.** R1 MFs (N13 degraded
  header; N8 `Affection.Label` write) intact. R3 recommends folded:
  R-A plan-text mischaracterized `mind.surroundings` as "Grok-summarized"
  → S11 now describes it as 1D-written (template- or Grok-rendered,
  provider-agnostic); R-B `??` whitespace fallthrough → switched to
  `.trim()`/concat (and the new always-base+overlay rule made this moot
  for the primary path); R-C ambient-name PC multi-PC inconsistency
  noted; R-D §5.3 prose narrative-crutch → dropped the
  "或许是你刚醒来时记忆混淆了" interpretive half (lens-3 R-2 same
  finding); R-E `embeddingsEnabled()` itself added to the 1D removal
  checklist (§12.3).
- **Lens 2 (ai-town / Convex engine) — APPROVE.** R1 MFs (crons.ts
  reference; ring-append site; cite corrections; one-shot reset
  ordering) intact. R3 recommends folded: R-1 (ambient loop running
  even when `mind.surroundings` wins) became moot under the v3.1
  always-base+overlay contract (loop always runs by design); R-2
  corrected the "move inputs set lastInput" phrasing in §12.2 (pre-Fix
  setter is only `Player.join`); R-3 added `embeddingsEnabled()` guard
  to `convex/testing.ts:testEmbedding` (the missing dev-tool entry
  point).
- **Lens 3 (memory-semantics & anti-omniscience/persona) — APPROVE
  WITH RECOMMENDS.** R1 MFs (PC `playerPersona` + N13 sourcing; §6
  boundary framing) intact. R3 substantive recommend R-1 — the §5.3
  fallback self-destructs after 1D writes — **was the largest fold**:
  the contract changed from `mind?.surroundings ?? dynamicSurroundings`
  ("primary wins") to **always-base + optional overlay** (base
  permanent, 1D writes a brief `【近况（沉淀）】` overlay). 1D's
  surroundings-summarizer prompt is now constrained to recent-change
  deltas, not full re-descriptions. R-2 (drop reconciliation hint from
  `worldDescription`) folded. R-3 (multi-NPC ambient-name future) noted
  in S11. R-4 (code comment at NPC `lastInput` bump) folded into
  [convex/aiTown/conversation.ts](../convex/aiTown/conversation.ts)
  `finishSendingMessage`. R-5 (cross-conversation memory empty during
  trial is intentional) folded into S12.
- **Lens 4 (v4-faithfulness & scope discipline) — APPROVE.** R1 MFs
  (S4 GlobalReflection no-clobber; S6 read-only render; R12 provenance
  non-transfer; R11 §4-deletion downstream) intact. R3 recommends
  folded: R-1 / R-5 — this proper lens-by-lens R3 audit trail (you are
  reading it) replaces the prior stub, and the process-cost lesson is
  recorded below; R-2 (L2 boundary clarification: `worldDescription` is
  map prose / L3-scoped, not persona prose / L2-scoped) folded into
  S11 + R13; R-3 (R13 moved into §9 risks table) folded; R-4 (S11
  post-1D end state explicit) folded — the always-base+overlay contract
  makes the base permanent, so the §5.3 base is never dead code.

**Process-cost lesson (R3 lens-4 R-5):** the four mid-trial changes
that triggered Round 3 shipped without a review round because they
*felt* like small fixes mid-trial. Lens-3 R-1 caught a real design
defect (the §5.3 self-destruct post-1D) that proportional triage might
have surfaced but full 4-lens definitely caught — the user's choice of
"Full 4-lens like v2" paid off. **Standing rule for future rounds:**
even fixes that feel small but touch a plan-defined data flow or
invariant get a review round (proportional, not full unless explicitly
asked) *before* shipping, not after.

**v3.1 was consensus-approved and ready for implementation**; 1D was
permitted with full spec and is now shipped — see §13 below.

---

## 13. P1-1D execution audit (v3.2)

**Status:** code-complete, deployed to `wooden-shepherd-675`, fresh
world reseeded, cross-conversation memory loop user-trial-validated,
trial-surfaced defects fixed by C003. **169 tests across 13 suites,
tsc 0 errors.**

### Phase-by-phase delivery

| Phase | What | Outcome |
|---|---|---|
| **1D.A** | Pure reflection core: `BuildReflectSystemPrompt` (generic-persona S5/S7); `BuildReflectUserBody` (raw turns + N13 + §2 reference frame); slot extraction; `ParseEmotion` / `ParseAffectionDelta` / `HasContradiction` / `IsNeutralLabel` / `extractFirstFloat`; salience-gate predicate (N6); `AppendImpressionDelta` (cap 3/600); GlobalReflect prompts (S4); `buildRawBody` (N4) | `convex/agent/reflection.ts` + test suite — **47 new tests, all pass**. Faithful to jynew `MemoryCompactor` (per `_jynew_phase3d_extract.md` §3); only generic-persona framing differs (S5/S7). |
| **1D.B** | Wire `rememberConversation` (memory.ts:24-86) → 4-slot re-fold-from-raw op: `loadReflectionData` (internalQuery: persona / playerPersona / messages / mindState / all-pairs); `writeMindStateReflection` (internalMutation: upsert with N8 affect application incl. `Affection.Label` write); `FoldGlobalReflection` ≥2-pair gated (S4, no-op for single pair) | Full rewrite of `convex/agent/memory.ts`. `agentRememberConversation` operation seam (N11) untouched; only the function body swapped. |
| **1D.C** | Embeddings teardown — delete: `searchMemories` / `rankAndTouchMemories` / `calculateImportance` / `fetchEmbedding` / `fetchEmbeddingBatch` / `ollamaFetchEmbedding` / `fetchModeration` / `tryPullOllama` / `embeddingsEnabled` / `detectMismatchedLLMProvider` / `EMBEDDING_DIMENSION` const / `LLMConfig.embeddingModel` field / `embeddingsCache.ts` file / `testEmbedding` in testing.ts / `relatedMemoriesPrompt` + `previousMessages` helpers in conversation.ts / `'memoryEmbeddings'` + `'memories'` from crons.ts `TablesToVacuum` / `excludedTables` `embeddingsCache` literal → `[]` / `hnswlib-node` from package.json | `convex/util/llm.ts` 735 lines → 320 lines. ContextAssembler is now sole transcript source per §4D. **Scope-consistent dead-code removals beyond the strict spec letter:** also dropped `fetchModeration` (unused) and `tryPullOllama` (ollama-embedding auto-pull) — small extra cleanups, no new functionality removed that was used by anything. |
| **1D.D** | Schema teardown — drop `memoryEmbeddings` + `vectorIndex` + `embeddingsCache` tables; drop `memoryTables` (memories + embeddingId/importance fields) entirely (vestigial); drop EMBEDDING_DIMENSION import from schema | `convex/agent/schema.ts`. agentTables = `{persona, playerPersona, mindState}`. Validated against the empty pre-1D state of all three legacy tables (verified before wipe). |
| **1D.E** | One-shot fresh-world reset (per v3.1 §4.3 ordered drain): `wipeAllTables` → 10s drain → `init` (creates fresh world + 1 agent 琳娜 since `Descriptions.length === 1`) → `seedHumanMemory` (re-seeds persona + playerPersona) | Live `wooden-shepherd-675`. Verified post-reset: 1 world, 1 agent, 0 messages, 0 mindState rows (correctly empty — populates only at conv-end). |
| **1D.F** | User end-to-end behavioral trial — start conv 1, leave, start conv 2, verify cross-conversation memory | **PASSED.** Log evidence: at conv 1 end, `agentRememberConversation` fired `往来印象：他声称自己差点跟不上她走路的速度...; 情绪变化：谨慎 0.7; 好恶变化：+0.15; 违背设定：空`. Conv 2 system prompt now contains `·对 李平·` with `当下好恶：0.29（谨慎，向长期基线缓回）` (decayed value via N1) + `往来印象（已沉淀）：他声称自己...` + multi-entry `［本局所历］：...` ImpressionDelta overlay (S6) + multi-turn ring. **The cross-conversation memory loop is live and observable.** |

### Trial-surfaced defects → C003 (post-1D tuning)

The 1D trial also surfaced three behavioral defects (not memory-loop
defects — those passed). Each was reviewed and fixed under Mandate B
in `docs/CHANGES.md` C003 v2 (2 rounds × 2 lenses, consensus):
- **Defect 1 — name evasion.** Grok had `李平` in context 3× but
  said "I don't remember your name." Fix: positive-frame name-
  permission nudge in all three builders.
- **Defect 2 — agent talks while user types.** `TYPING_TIMEOUT 15s`
  cleared the indicator mid-typing on long messages; MessageInput
  only pinged once. Fix: 15s → 60s + 10s-throttled refresh keystroke
  while keeping the in-flight re-entrancy guard.
- **Defect 3 — repetition + `**琳娜：**` prefix leak.** Default
  temperature + no variation hint + narrow `trimContentPrefx`
  pattern. Fix: `DIALOG_TEMPERATURE = 0.85` const; positive-frame
  variation instruction targeting semantic stall (`原地打转`); refactor
  `trimContentPrefx` to a 12-pattern priority-ordered first-match-
  wins helper (+19 new unit tests).

### Out of scope post-1D (deferred — TBD as C004)

- The legacy `agentPrompts()` injection in conversation.ts:192-206
  still pushes `About you: ${agent.identity}` + `Your goals:
  ${agent.plan}` (from `data/characters.ts:27`) into every prompt.
  These now duplicate / contradict the new §2 personality + §5.2
  task from the assembler. Two ways forward, **deferred to its own
  Mandate-B review round (C004 when scheduled):**
  - (a) L2 content edit: user rewrites the legacy `identity` + `plan`
    in `data/characters.ts:27` to align with the new persona.
  - (b) Engine-path removal: drop the `agentPrompts()` call from the
    three builders entirely. Cross-cutting LLM-input-shape change.

### Code surface delta

- **New files:** `convex/agent/reflection.ts`, `convex/agent/reflection.test.ts`, `convex/agent/conversation.test.ts`.
- **Rewritten files:** `convex/agent/memory.ts` (full); `convex/util/llm.ts` (735 → 320 lines).
- **Edited files:** `convex/agent/conversation.ts` (legacy embedding block + previousMessages deleted; C003 prompt edits added); `convex/agent/schema.ts` (legacy tables dropped); `convex/constants.ts` (TYPING_TIMEOUT + DIALOG_TEMPERATURE + IMPRESSION_DELTA_* added; 1D constants already added in v2); `convex/testing.ts` (testEmbedding deleted, excludedTables empty); `convex/init.ts` (detectMismatchedLLMProvider call removed); `convex/crons.ts` (legacy tables out of TablesToVacuum); `src/components/MessageInput.tsx` (typing-refresh fix); `data/characters.ts` (unchanged but its line 27 is the deferred C004).
- **Deleted files:** `convex/agent/embeddingsCache.ts`.
- **package.json:** `hnswlib-node` removed.

### Plan-invariant ledger after 1D + C003

| Invariant | Status |
|---|---|
| N1 decay math (verbatim) | ✅ implemented in `affect.ts:affectCurrent` |
| N2/S10 derived-window ring | ✅ implemented in `mindState.ts:ringWindow` |
| N3 no-under-render (recent-turn sourcing via committed `messages`) | ✅ enforced by per-turn `queryPromptData` |
| N4 re-fold-from-raw | ✅ enforced in `memory.ts:rememberConversation` (no prior-summary feed) |
| N5 4-slot parse | ✅ verbatim slot prefixes; parsers ported with golden tests |
| N6 salience-gate predicate | ✅ `isTrivial(affDelta, emoNeutral)`; summary-always-folded |
| N7 deltas-from-raw | ✅ deltas computed from Grok output, not `Affect.Current(now)` |
| N8 affect application incl. `Affection.Label` write | ✅ folded faithfully (R3-1 lens-1 MF2 caught + fixed) |
| N9 anti-omniscience seal | ✅ `BuildTalkeeSurfaceSealed` 5-arg signature intact |
| N10 constants verbatim | ✅ all in `convex/constants.ts` |
| N11 engine discipline (FSM + writers + seams untouched) | ✅ verified through C003 |
| N12 read-time decay rendering + relocated §5.5 ImpressionDelta read-only | ✅ |
| N13 display-name speakers; no raw engine ids in any prompt/memory artifact | ✅ verified live in log dumps |
| S1-S2 lore-free spine (§1/§4 not seeded) | ✅ |
| S3 affection baseline 0 | ✅ |
| S4 GlobalReflection ≥2-gated; no-clobber-on-skip; best-effort | ✅ wired (no-op for single pair this iteration) |
| S5/S7 generic-persona prompt framing; 违背设定 references §2 | ✅ |
| S6 ImpressionDelta relocated to §5.5; read-only render; write contract preserved | ✅ |
| S8 interest-weighted selection deferred | ✅ (single NPC) |
| S9 persona / FSM identity disjointness | ⚠ partial — agentPrompts duplication still emits FSM identity; **C004 deferred** |
| S10 derived-window-over-messages adaptation | ✅ |
| S11 always-base + optional overlay §5.3 | ✅ |
| S12 embeddings-off coexistence guard | ⛔ NO LONGER NEEDED — guards + helper + tests all deleted with the legacy path (per 1D.C). The S12 line stays as historical record of what was removed. |

### 14. Successor — Memory v2 (forward-link)

**Status:** v3.2's memory layer (reflection consolidation +
ReflectionSummary + ImpressionDelta + GlobalReflection) is being
**superseded** by a tiered Knowledge-DB architecture spec'd in
[Memory_KnowledgeDB_Plan.md](Memory_KnowledgeDB_Plan.md) (Memory v2,
**doc-v3** — Mandate-A R1 cleared with 18 MFs folded; user added
mid-cycle Round-1.5 design rule (**associative keyword layer L12 /
N26** — each entry stores keywords with per-keyword association
ratios in `[0,1]`; storage + maintenance ship in doc-v3, decision-
making consumer DEFERRED to a future user-spec'd plan); R2 pending
on doc-v3). Driven by user 2026-05-20 pivot after 1D shipped.

**What v2 replaces (memory layer only):**

| v3.2 invariant | Memory v2 disposition |
|---|---|
| N4 re-fold-from-raw | OBSOLETED — replaced by per-turn Op A fact extraction |
| N5 4-slot parse | OBSOLETED — replaced by free-form fact extraction |
| N6 salience-gate predicate (knowledge side) | OBSOLETED — replaced by frequency counters + LLM merge judgment |
| N6 trivial-skip (affect side) | KEPT — folded into Memory v2 N23 |
| N7 deltas-from-raw | KEPT in spirit — affect update is in Op A; same discipline |
| N8 affect application incl. Affection.Label conditional write | KEPT verbatim — Memory v2 N23 |
| S4 GlobalReflection ≥2-pair gated | OBSOLETED — cross-entity facts become first-class entries (entity = `__general__`) |
| S5/S7 reflection prompt framing | OBSOLETED — replaced by new Op A/B/C prompts |
| S6 ImpressionDelta cap (3/600) | OBSOLETED — replaced by knowledge-DB tier caps (30 entries / 3000 chars per tier) |
| S12 embeddings-off coexistence guard | (already deleted in 1D.C) |

**What v3.2 keeps (surviving infrastructure):**

N1 decay math · N9 anti-omniscience seal · N10 constants verbatim ·
N11 engine discipline · N12 read-time decay rendering · N13 display-
name-only · S10 derived-window ring (Memory v2 KEEPS it as raw input
to Op A's fact extractor AND as the last block in §6 render) · S11
base+overlay surroundings · persona / playerPersona / mindState
(emotion, situation, task, surroundings, affection fields) · the
ContextAssembler shell · the `agentGenerateMessage` /
`agentRememberConversation` operation seams (still untouched FSM-
wise; the body of `rememberConversation` does change).

**C003 carry-forward:** all C003 v2 tuning (12-pattern
`trimContentPrefx` + 60s `TYPING_TIMEOUT` + 10s-throttled
`startTyping` refresh + `DIALOG_TEMPERATURE = 0.85` + variation hint +
positive-frame name-nudge) is explicitly protected by
[Memory_KnowledgeDB_Plan §10.1](Memory_KnowledgeDB_Plan.md#101-c003-v2-carry-forward--explicit-protection-l1-mf4-fold).
Memory v2 phases MUST NOT touch those surfaces.

**C004 status:** UNCHANGED. Still deferred to its own Mandate-B
review; not blocked by v2 nor a precondition for v2.

**Live-data note for v2 cutover:** `wooden-shepherd-675` (the live v3.2 / 1D / C003
deployment) requires an ordered reset before Memory v2 ships (per
v2 phase 2A.0). The reset is the same pattern as 1D.E: `wipeAllTables
→ init → seedHumanMemory`. 琳娜's existing mindState reflection /
impression / global-reflection rows DO NOT carry forward (schema
diff drops those fields). User-visible "琳娜 forgets the v3.2 trial"
is expected; consent gate is the Memory v2 Mandate-A permission step
before 2A.0 runs.
