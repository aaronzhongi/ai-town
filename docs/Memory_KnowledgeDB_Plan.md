# Memory v2 — Tiered Knowledge-DB with Multi-Modal Per-Turn Acquisition — v3.5

**Status:** v3.2 — DRAFT awaiting Round 2 review. v1 Round 1: all 4
adversarial lenses REQUEST CHANGES (18 must-fixes + ~15 useful
recommends; full disposition in §12 Round 1 audit). v2 folded every
MF + the high-value RECs + a new design rule from the user
(**N24 — remembering triggers affect re-application**) + an L10
refinement (**Affection is one of the emotions** — semantic
unification of the affect family). **v3 added a user-driven
mid-cycle addition (Round 1.5):** an **associative keyword layer**
on each knowledge entry (**L12 / N26**) — each entry stores
keywords with per-keyword association ratios; merged at every
merge site; the decision-making consumer of these associations was
intentionally deferred to a separate plan (user spec'd it
2026-05-20). **v3.1** recorded the resolution of v3's Q10
(deferred consumer): the consumer is now spec'd as a peer plan
**[Action_Decision_Maslow_Plan.md](Action_Decision_Maslow_Plan.md)
v1** — Maslow-Hierarchy-driven action selection that reads
(read-only, no re-fire) `knowledgeFact.keywords` + `affectImpact` via
a deterministic-scored recall pipeline. **v3.2 (this revision —
Round-1.6 lit-driven fold, user-approved 2026-05-20):** folds
literature-grounded reviewer recommendations: (1) **Rec 2** — add
Park-style `importance` field (1–5 LLM-scored at insertion;
max-on-merge) to `knowledgeFact`, multiplied into the §6 render
score (cites [Park et al 2023 §4.1](https://arxiv.org/abs/2304.03442));
(2) **Rec 6** — gate N24 affect re-fire by `affectImpact.confidence
× intensity` against `N24_REFIRE_THRESHOLD` (addresses existing R13
amplification risk; cites [Croissant et al PLOS ONE 2024](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0301033)
appraisal-graduated pattern); (3) **Rec 7** — add Op A
self-consistency CI check (run twice with different seeds; flag
decision divergence >10%) to phase 2A.1 (addresses literature-
identified silent-misclassification weakness in LLM-as-judge
retrieval); (4) **Rec 8** — cite [A-MEM (Xu et al, NeurIPS
2025)](https://arxiv.org/abs/2502.12110) as prior art for the
keyword-tag layer (Memory v3 L12/N26 is mainstream, not invention).
Memory v3 schema / ops are unchanged by Action v1; the two plans
review and ship independently (Memory v3 first, Action v1 after
Memory v3 phase 2C ships).

**v3.3 (user-driven addition 2026-05-20):** added
**basic instinct LT entries** (L23 / N28) — pre-seeded `knowledgeFact`
rows in LT for universal human survival heuristics. New schema field
`source: 'op-a' | 'instinct'`; rows with `source === 'instinct'`
were declared immune to all three compaction processes. The new plan
[LLM_Routing_Calibration_Plan.md](LLM_Routing_Calibration_Plan.md)
is a sibling concern: it tiers LLM calls between Grok and Ollama
(gpt-oss:120b local) via calibration-based routing — orthogonal to
Memory's storage layer but cross-referenced from §5.1/§5.2/§5.3 for
per-call routing eligibility.

**v3.4 (R2 four-lens fold 2026-05-21):** all 4
Mandate-A R2 reviewer lenses returned APPROVE WITH FIXES on v3.3.
v3.4 folds 10 distinct must-fixes + 13 recommends + the instinct-
content research deliverable. Headlines:
- **C1 (3-lens convergent):** Op B's apply-step now forces
  `keep-in-ST` (not `promote-as-new-LT`) when an ST candidate has
  `sourceFactId` pointing at an instinct LT row — stops silent-dup
  pathway that would dilute LT with parallel non-instinct rows
  about the same concepts as instincts.
- **C2 (2-lens convergent):** phase 2A.0 step (5) restructured —
  `seedBasicInstincts` could not have executed as written (function
  and `knowledgeFact` table did not exist yet). Phase 2A.0.5 renamed
  to **2A.2**; sequence becomes 2A.0 (wipe+init+seedHumanMemory) →
  2A.1 (schema + Op A) → 2A.2 (seedBasicInstincts implementation +
  content + one-shot run).
- **C3:** `opBLock` + `opCLock` schema fields added to §3.1.1
  `serializedAgent` validator diff (described in §5.2/§5.3 but
  missing from schema diff — Convex push would have failed).
- **C4:** Op B's apply mutation re-reads each target LT row pre-
  patch; compares `lastUpdatedAt` to pre-Grok snapshot; if changed
  → skip merge-into-existing, fall back to `promote-as-new-LT`.
  Eliminates TOCTOU window with parallel Op A.
- **C5:** new `instinctSlotKey: v.string()` schema field gives
  `seedBasicInstincts` a stable identity for idempotent re-seeding.
  Repurposes the previously-diagnostic-only `owner_tier_source`
  index from "dead weight" to "load-bearing."
- **C6:** N22 v3.3 silent contradiction-pin widening REVERTED.
  Restored: `pinned: true` → C2-exempt only;
  `pinned: true AND source === 'instinct'` → C1+C2+OpB-exempt.
  Stops R14 (pin pollution) from getting worse for contradiction
  rows.
- **C7:** `__general__` Op A LT slice gets a two-budget rule —
  separate `LT_GENERAL_INSTINCT_BUDGET_CHARS = 2000` (selective —
  keyword-overlap pre-filter against the input fact) + existing
  `LT_GENERAL_OPA_BUDGET_CHARS = 800`. Stops instinct slice
  saturation that would have blown the per-entity char budget.
- **C8:** LT caps split into `KNOWLEDGE_LT_INSTINCT_RESERVE = 15` +
  `KNOWLEDGE_LT_DYNAMIC_CAP = 30` (sum = 45). Op C eligible-set +
  trigger math adjusted. Adds `relatedInstinctId` field for Op B
  promote-as-new-LT fallback diagnostic.
  > **2026-05-21 fix-up:** reserve was 18 in earlier drafts of this
  > plan (assuming 15 universal + 3 琳娜 overlay rows). Per user scope
  > decision the instinct floor is **universal-only** (15 entries, §3
  > of `Instinct_Manifest_Research.md`); the 3 persona-overlay rows in
  > §4 are REJECTED-BY-USER-SCOPE. Reserve drops 18→15; total cap 48→45.
- **C9:** N24 confidence gate REPLACED with multiplicative scaling
  (Croissant-faithful appraisal-graduated pattern):
  `intensity_applied = intensity × confidence`. No threshold OR
  perf-only floor at 0.05. Q7 re-opens.
- **C10:** Phase 2E explicitly owns `rememberConversation` body
  rewrite (was implicit, no scheduled owner).
- **Render-policy reconciliation (L2-vs-L4 root):** instincts now
  seed at `importance=3` (not 5) per the importance ladder's
  *episodic-not-procedural* semantics; new constant
  `INSTINCT_RENDER_FLOOR = 2` guarantees ≥2 instincts surface per
  general-block render regardless of score; Op A refreshes
  `lastUpdatedAt` on the instinct's LT row when the slice includes
  it (instinct stays warm while relevant, fades when not); score-tie
  tiebreak prefers `source: 'op-a'` over `source: 'instinct'`.
  Resolves Lens 2's cold-start-dominance AND Lens 4's day-2-
  invisibility concerns with one consistent policy.
- **Instinct content** — research deliverable at
  [docs/Instinct_Manifest_Research.md](Instinct_Manifest_Research.md)
  provides **15 universal entries** (§3 only — §4's 3 persona-overlay
  rows are REJECTED-BY-USER-SCOPE per 2026-05-21 decision; basic
  instincts must be universal to "any 18yo (girl) reacting to any
  situation," not game- or character-specific) grounded in 16 cited
  findings. User-flagged "rely on only-available-male" candidate
  explicitly decomposed: familiarity-under-threat encoded sex-
  neutrally (I-SAF-2); elevated-male-wariness encoded universally
  per Öhman/Mineka + Campbell + stranger-danger lit (I-SAF-3 — user
  chose to ship as universal per disposition); per-character
  applications (e.g., 琳娜→李平) left for Op E decision-time (NOT
  hardcoded into the instinct floor). v3.4 §13 replaces the v3.3
  scaffold with a pointer to the research deliverable + ingest
  instructions.
- **R11 cost-delta estimate updated:** v3.2-shipped → v3.4 is
  **~3.3–3.8× total token spend** (up from v3's 2.7× estimate),
  peaks ~5–6× during overlapping Routing v1 calibration trial week.
  Steady-state after Routing offloads B+C to Ollama: ~2.5×.

**v3.5 (this revision — single-line coordinated amendment per Action
v1.2 R1 lens convergence, 2026-05-21):** Action v1.2 R1's 4-lens
review surfaced a cross-plan contradiction (3-source convergent —
A1-MF5 + A3-MF3 + the deferred L3-REC-3-4 from Memory R2 audit):
Memory v3.4 §10.1 row 5 still listed `task` as a protected
`mindState` field, but Action plan's L18 / N32 / §3.2 unambiguously
drops it. v3.5 amends §10.1 row 5 to remove `task` from the
protected set and explicitly hand the field to the peer plan. NO
other Memory plan content changes; this is a single-line cross-plan
coordination fix. The Round 2.5 audit entry below records the
amendment; Memory v3.5 does NOT require a fresh R3 — the amendment
is small enough and the change had unanimous reviewer convergence.

**Supersedes the memory layer of
[HumanMemory_AITown_Plan v3.2](HumanMemory_AITown_Plan.md)**
(reflection consolidation / mindState's reflection-summary &
impression-delta & globalReflection fields are removed; the per-turn
knowledge-DB pipeline below replaces them). Substantial portions of
v3.2 survive as the surrounding infrastructure (see §2 Inherited).

**One-line:** Per-NPC paired short-term + long-term **knowledge
databases** of atomic facts (timestamped + frequency-counted), fed by
**every turn** of conversation AND **multi-modal perception events**
(meeting / spatial / temporal), with **Grok-driven** match/merge/
contradiction/compaction. Replaces the jynew Phase 3D
re-fold-from-raw reflection model.

**Mandate-A:** this is a project-restart-tier change. ≥4 independent
adversarial reviewer lenses required before any code; consensus +
explicit user permission gate; v3.2 / 1D code is NOT modified before
those gates clear.

---

## 0. User-locked decisions (2026-05-20) — OFF-LIMITS to reviewers

| # | Decision |
|---|---|
| **L1** | **Full replace** of v3.2 memory layer. The reflection.ts module, mindState's `reflectionSummary` / `impressionDelta` / `globalReflection` fields, the 4-slot reflection consolidation op — all REMOVED. v3.2's surviving infrastructure (ContextAssembler shell, derived-window ring, persona / playerPersona / worldContext, **affect-scalar layer** per L10) stays. |
| **L2** | **Hybrid caps** on each DB tier: free-text fact strings + **entry-count cap AND char-budget cap** (whichever bites first triggers compaction). |
| **L3** | **LLM-driven (Grok)** for matching, merging, contradiction detection, compaction decisions. Frequency counters and timestamps are deterministic; semantic equivalence judgment is Grok's. |
| **L4** | **ST and LT have the same nominal size.** ST is a **soft cap** (overflow allowed → triggers compaction). LT is a **hard cap** (no overflow ever; LT-overflow is the only path that *deletes* memory). |
| **L5** | **Two LT compaction instances**: (B) periodic ST→LT consolidation at a fixed interval, accelerated under ST pressure; (C) LT-overflow compaction (compact OR delete least-frequent — only deletion path). |
| **L6** | **No embeddings** (carries forward from v3.2). |
| **L7** | **Refresh memory** — when new info matches only an LT entry (not ST), **copy** the LT entry into ST. The LT entry remains until the next consolidation reconciles. ST takes the freq++ / merge for the new info. |
| **L8** | **Multi-modal input sources** — conversation turns + meeting events (first time seeing a player / NPC) + spatial perception (new surroundings, time-of-day, ambient activity). |
| **L9** | **Per-turn Grok pipeline** — every NPC and player message (and every perception event) triggers the fact-extract + DB-match Grok call. ~2 Grok calls per conversation turn; latency on her replies grows. |
| **L10** | **Affect-scalar layer survives** — emotion (§5.4) + per-target affection (§5.5.1) with N1 lazy-exp decay-to-baseline are preserved, updated by the same per-turn Grok pass that emits facts. Dual-track cognitive model: SEMANTIC = fact-DB; AFFECTIVE = scalar layer. **v2 refinement:** "Affection is one of the emotions" — semantically a unified affect family (general mood + per-target sentiment are the same kind of thing). Implementation: keep the v3.2 two-field schema (`mindState.emotion` + `mindState.affection`) for v2.0 minimal change; v2.1 may unify into an emotion-collection array keyed by optional target. |
| **L11** (v2 — new) | **Remembering triggers affect re-application.** Each knowledge entry stores an `affectImpact` annotation (label + intensity + optional targetEntity). Every memory-access op that "remembers" the entry — insert / exact-match (freq++) / partial-merge / L7 refresh (LT→ST copy) / Process A internal merge — re-applies the stored `affectImpact` to the live affect-scalar layer (per N8 application discipline). **Move ops (Process B ST→LT migration) and delete ops (Process C C2) do NOT re-fire affect** — moving and forgetting are not the same as remembering. See N24. |
| **L23** (v3.3 — new) | **Basic instinct LT entries — pre-seeded, immutable.** At agent seeding (`init.ts` + new `seedBasicInstincts` function), a small set of `knowledgeFact` rows (~10–25 per NPC, tuned in trial) are inserted into LT representing universal human survival heuristics across the 5 Maslow levels. Rows carry `source: 'instinct'` (new schema field) + `pinned: true`. **They are IMMUTABLE in three senses:** (a) Process B never merges any ST candidate INTO an instinct LT row (instinct text stays canonical — Op B treats instinct LT rows as ineligible merge targets); (b) Process C1 never includes instinct rows in compaction batches (already covered by N22's "pinned excluded from C" rule, extended to C1); (c) Process C2 never deletes them (already covered by N22). **L7 refresh-from-LT IS still allowed** (instinct LT row can be copied into ST as a working active copy when Op A judges a new fact `lt-only`-matches it) — but Op B never reconciles that ST copy back into the original instinct (special-case via `sourceFactId` link, see N28). Instinct categories include but are not limited to: physiological (basic body needs), safety (threat scanning in unfamiliar environments, sheltering heuristics, **including the kind of culturally-coded survival prior the user flagged as worth exploring — e.g., for a young female persona in an unknown setting, the "rely on the only available familiar male for short-term protection" heuristic is a plausible candidate but needs grounding research before seeding**), belonging (social warmth signals), esteem (face/dignity maintenance), self-actualization (curiosity / meaning-seeking). **Actual content TBD via separate research pass** (user-suggested: scan literature on evolutionary psychology, cultural survival priors, persona-specific heuristics for an 18yo Chinese female suddenly displaced). See §13 for the category scaffold and the deferred research task. |
| **L12** (v3 — new; v3.2 cited prior art) | **Associative keyword layer.** Each knowledge entry stores a bounded list of `(keyword, assocRatio)` pairs. Keywords are short Chinese tokens describing what the entry is *about* / what concepts it would surface under (e.g., 偷瞄 / 凝视 / 礼仪 / 害羞). `assocRatio ∈ [0,1]` is THIS-entry-to-THAT-keyword association strength (independent per keyword; NOT a probability distribution). Grok generates keywords + ratios as part of every Op A fact emission. Every merge site (Op A partial / Op A L7 refresh / Op B ST→LT merge-into-existing / Op C C1 same-entity compaction) **merges keyword lists**: union of keywords; on shared keywords take `max(ratio_a, ratio_b)`; truncate to `KNOWLEDGE_FACT_MAX_KEYWORDS` keeping highest ratios. **Prior art (v3.2 Rec 8):** this is structurally the same as the Zettelkasten-inspired LLM-generated-tag-per-memory-unit layer in **[A-MEM (Xu et al, NeurIPS 2025)](https://arxiv.org/abs/2502.12110)** — A-MEM uses ~3–5 tags per memory, dynamic re-tagging on new-memory arrival, and tag-driven retrieval; the design here is a faithful instance of that pattern (slightly more keywords per entry; merge-on-collision rather than dynamic re-tagging; no graph backbone — Memory v3 is otherwise read-only for tags). The decision-making consumer that USES these associations is spec'd as the peer plan [Action_Decision_Maslow_Plan.md](Action_Decision_Maslow_Plan.md) — Q10 ✅ resolved per §11. v3 ships storage + maintenance only. See N26. |

**Carried-forward v3.2 locks still in force** (not relitigated): no
embeddings; LLM only in `internalAction` ops that write back via
inputs; FSM untouched; engine-small state placement; faithful
TS rebuild discipline.

---

## 1. The architecture (entry lifecycle)

```
                ┌────── Information Acquisition (new input I) ─────────────────────┐
                │   sources (L8 multi-modal): conv turn / meeting / perception      │
                ▼
       ┌─── per-turn Grok Op A: extract facts from I + match against ST + LT ───┐
       │                                                                          │
  no match anywhere   exact match (ST or LT)   partial overlap     LT-only match │
       │                       │                      │                  │       │
       ▼                       ▼                      ▼                  ▼       │
   INSERT new entry        freq++ on matched     MERGE I into       REFRESH      │
   into ST                 entry                 matched entry      MEMORY:      │
                                                                    copy LT      │
                                                                    entry → ST   │
                                                                    (LT entry    │
                                                                    remains      │
                                                                    until next   │
                                                                    consolidation),│
                                                                    then re-run  │
                                                                    match-tree   │
                                                                    against new  │
                                                                    ST entry     │
                                                                                  │
       ─────────  Affect layer (L10) updated in same Op A pass ────────────────  │

  ────────── Async compaction processes (always running) ────────────────────────

  Process A — ST internal compaction  (trigger: ST soft-cap exceeded)
    A1. Grok merges overlapping ST entries (e.g., multiple facts about
        the same entity collapse into one denser fact-line).
    A2. If still over: accelerate Process B (push less-frequent ST
        entries down to LT now instead of waiting for the interval).
    ⚠ ST entries are NEVER thrown away in Process A.

  Process B — Periodic ST → LT consolidation  (fixed interval, default
              ~5min; accelerated under ST overflow pressure)
    Less-frequent ST entries are pushed to LT.
    If the entry was previously refreshed from LT (L7), the
    consolidation MUST reconcile (merge / replace) with the existing
    LT entry — no duplicates allowed in LT.

  Process C — LT-overflow compaction  (trigger: LT hits HARD cap)
    Either:
      C1. Grok compacts existing LT entries (merge similar entries
          to shrink total bytes / entry count).
      C2. Delete the least-frequent LT entries entirely — THE ONLY
          place memory is ever thrown away. Tiebreak: oldest first
          (`lastUpdatedAt` ascending).
```

### 1.1 What v3.2 element each process replaces

| v3.2 element | Memory v2 replacement |
|---|---|
| `rememberConversation` / 4-slot reflection at conv-end (N4–N8) | Per-turn Op A fact-extract + match-tree (L9) |
| `ReflectionSummary` (one per pair, replaced at conv-end) | The fact-DB itself — many entries per entity, evolved over time |
| `ImpressionDelta` (cap 3/600) | Multi-entry fact-DB with explicit freq + timestamp |
| `FoldGlobalReflection` (S4 ≥2-pair gated) | Cross-entity / "general knowledge" facts in the DB (§2.4) |
| `EpisodicRing` (anchor + last-9, derived window over `messages`) | **KEPT** as raw input to Op A's fact extractor |
| Affect scalars (emotion + affection, N1 decay) | **KEPT** as the affect-scalar layer (L10) |
| ContextAssembler shell + §2 + §3 + §5.1-5.3 working memory | **KEPT** (§5.5 per-target render rewritten — see §6) |

---

## 2. Invariants

### 2.1 Inherited from v3.2 (still in force)

- **N1** Affect decay math (`Affect.Current(now) = Baseline + (Value − Baseline) · exp(−(now − LastSetMs)/HalfLifeMs)`). Used by the surviving affect-scalar layer.
- **N9** Anti-omniscience seal — §3 `BuildTalkeeSurfaceSealed` narrow 5-arg signature unchanged.
- **N10** Constants verbatim (decay half-lives, EMOTION_FLOOR, AFFECT_DELTA_DEADBAND, SECT_* budgets etc.). New constants added in §5.
- **N11** Engine discipline — all Grok calls in `internalAction` ops that write back via inputs; FSM untouched; engine-small state placement.
- **N12** Read-time decay rendering of affect (`EmotionLine` / `PerTargetBlock` decay-on-read via `affectCurrent(now)`).
- **N13** Display names everywhere; NO raw engine ids in any prompt or memory artifact.
- **S10** Derived-window ring over the durable `messages` table — kept as the raw-input source feeding Op A's fact extractor.

### 2.2 Obsoleted from v3.2 (removed under L1 full-replace)

- **N4** Re-fold-from-raw (one summary per pair) — replaced by accumulative fact-DB.
- **N5** 4-slot parse — replaced by Op A's free-form fact extraction.
- **N6** Salience-gate predicate — replaced by frequency + LLM merge judgment.
- **N7** Deltas-from-raw (affect from raw turns, not decayed) — affect layer remains but the update path is now inside Op A.
- **N8** Affect-application detail (incl. `Affection.Label` write) — survives in spirit; the rule itself ports to the Op A affect-update sub-step (§5.3).
- **S4** GlobalReflection (≥2-pair gated cross-pair fold) — replaced by cross-entity facts as first-class entries (§2.4 below).
- **S5/S7** Reflection prompt framing — replaced by new Op-A/B/C prompts.
- **S6** ImpressionDelta cap (3 entries / 600 chars) — replaced by fact-DB tier caps.
- **S12** Embeddings-off coexistence guard — long since deleted in 1D; no longer applicable.

### 2.3 New invariants (Memory v2)

- **N14 — ST and LT equal nominal size; ST soft / LT hard.** ST caps are *triggers* for Process A; LT caps are *absolute* (Process C runs to keep LT at or below cap, deleting if needed).
- **N15 — Multi-modal acquisition pipeline.** Every conv-turn (NPC and player) and every perception event (meeting / spatial-change / ambient) fires an `internalAction` that runs Op A.
- **N16 — Match decision tree (deterministic outer; LLM inner).**
  - Op A's Grok call returns, for each extracted fact, ONE of: `{insert, exact-match: <existingId>, partial-overlap: <existingId>, lt-only-match: <existingId>}`.
  - The deterministic outer code applies the corresponding write (insert / freq++ / merge / refresh + freq++).
- **N17 — Refresh memory** (L7) — LT→ST copy preserves the LT entry until next Process B reconciliation. ST entry is the active working copy. **(v2 fold of L2-MF1):** after refresh, the deterministic outer layer **re-issues the match query restricted to ST entries only** for the new input — so if a partial-overlap ST entry about the same fact already existed, the refreshed entry merges with it immediately (rather than waiting for Process B). Op A's outer loop pseudocode (§5.1) implements this as a 2-step sequence on `lt-only` decisions: (a) materialize LT→ST copy, (b) re-pose match-tree restricted to ST.
- **N18 — Frequency counter + timestamp on every entry.** `frequency` starts at 1 on insert; increments on exact-match. `createdAt` (immutable) + `lastUpdatedAt` (touched on any update / refresh / partial-merge).
- **N19 — Entity-keyed; cross-entity facts allowed.** Most facts are about a specific entity (player / agent / place / object). Cross-entity / general-knowledge facts use entity slot `*` (sentinel).
- **N20 — Compaction Processes A / B / C as specified in §1.** A never deletes; B moves; C is the sole deletion path.
- **N20.1 — ST-never-deleted, mechanically.** No code path may delete from `knowledgeFact` where `tier === 'ST'` without first writing (or having written) an equivalent LT row. Op B is the only path that transitions an ST row out of ST, and it does so by either patching the existing LT match (then deleting the ST row) or by retiering the same row to LT (no delete). Op A and Op C never touch `tier === 'ST'` rows destructively. Reviewer-checked in v2; unit-tested in §8 phase 2A.
- **N21 — LLM-judged matching/merging (no embeddings).** Op A's Grok prompt receives the new fact + a slice of ST + a slice of LT scoped by entity and returns the match-tree decision per fact. No vector search; no string-similarity heuristic.
- **N22 — Contradiction handling.** When Op A judges a fact as partial-overlap with EXPLICITLY conflicting content (e.g., name was `李平`, new fact says `李星平`), the merged entry records BOTH values + flags a meta-fact about source reliability ("据其先后所言，姓名一会儿说是X一会儿说是Y") in the same entry's text. **(v2 fold of L2-MF3):** the contradicting entry is additionally **pinned** (immune to Process C2 deletion regardless of frequency rank) AND **rendered prominently** in the per-target block — specifically, contradicting entries are rendered FIRST in the block (before the freq×recency-sorted top-K), under a `【冲突信息】` sub-header. The pin is a `pinned: v.boolean()` field on `knowledgeFact` (default false). Affect coupling: handled via N24 — the contradicting-merge updates the entry's `affectImpact` toward warier disposition, and the v2 N24 re-fire mechanism then propagates that affect drift naturally (no separate affect-on-contradiction code path needed).

  **v3.3 extension (L23 / N28), v3.4 narrowed (C6):** the v3.3 wording "the pin semantics generalize" silently widened ALL pinned rows (including v3 contradiction-pins) to also exempt from C1 compaction merging — which made R14 (pin pollution) worse for contradiction rows and ambiguated §5.3 C1's eligible-set. **v3.4 restores the narrower semantics:**
  - `pinned: true` (any source) → **C2 deletion EXEMPT** (unchanged from v2).
  - `pinned: true AND source === 'instinct'` → **C1 merge EXEMPT + Op B merge-into-existing EXEMPT** (instinct-specific only).
  - Contradiction-pinned rows (`pinned: true AND source === 'op-a'`) → **CAN participate in C1 compaction merges** (Grok can compact two old contradiction rows about the same entity into a denser fact-line; this clarifies stale contradictions over time).

  See N28 for the full instinct-immutability semantics. §5.3 C1 eligible-set is explicitly restated below to remove the v3.3 ambiguity.
- **N23 — Affect-scalar layer survives.** Same as v3.2: emotion + per-target affection with N1 lazy decay. Updated in the same Op A pass (the Grok output includes affect deltas alongside facts), per the v3.2 N7/N8 discipline. **(v2 fold of L3-R1):** explicit detail preservation —
  - **Emotion application:** `Label = emotionLabel`, `Value = clamp01(intensity)`, `Baseline = 0`, `HalfLifeMs = EMOTION_HALFLIFE_MS`, `LastSetMs = now`.
  - **Affection application:** `Value = clamp(Value + affDelta, -1, 1)`, `LastSetMs = now`, **do NOT overwrite `Baseline` or `HalfLifeMs`**.
  - **Conditional standing-hint write (v3.2 jynew `MemoryCompactor.cs:273-274`, v3.2 N8 lens-1 MF2):** `if (emotionLabel non-blank && !emotionNeutral) Affection.Label = emotionLabel`. Preserved verbatim.
  - **v3.2 N6 salience-gate trivial-skip — DOES carry forward:** when both `|affDelta| < AFFECT_DELTA_DEADBAND (0.08)` AND emotionNeutral, the affect-delta application + `LastSetMs` reset are skipped (so baseline-reversion decay can still fire for chatty pairs). Knowledge-DB write still happens; only the affect side is skipped.

- **N24 (v2 NEW; v3.2 confidence-annotated; v3.4 multiplicative-scaled per C9) — Remembering re-fires affect at `intensity × confidence`, no gate.** Each `knowledgeFact` row stores an optional `affectImpact: { label, intensity, confidence, targetEntity? }` annotation — "how this fact made the NPC feel when first encountered" (or as updated by subsequent merges) AND how reliable that annotation is. Whenever a memory-access op "remembers" the entry (insert / exact-match freq++ / partial-merge / L7 refresh from LT→ST / Process A internal merge), the stored `affectImpact` is **scaled** (not gated) and applied: `intensity_applied = intensity × confidence` (with `confidence: 0..1` and `intensity: -1..1`). The scaled value then flows through N23's application discipline (`Affection.Value += affDelta_scaled` with conditional standing-hint write; emotion application same shape).

  **v3.2 → v3.4 evolution (C9):** v3.2 (Rec 6) used a hard threshold `confidence × |intensity| > N24_REFIRE_THRESHOLD = 0.25` to gate the re-fire. Lens 2 R2 walked through scenarios showing this caused flicker — a mid-tier annotation (`|intensity|=0.4`, `confidence=0.65`) fires at 0.26 (barely above); same row's next re-emit at `confidence=0.5` flicker drift drops it to 0.20 (silenced). Emotionally inconsistent NPC behavior with no observable trigger. **v3.4 fix:** replace all-or-nothing gate with multiplicative scaling (graduated, Croissant-faithful) — every re-fire applies, but at intensity scaled by confidence. Low-confidence applies softly; high-confidence applies fully; no flicker. A perf-only floor (`N24_REFIRE_PERF_FLOOR = 0.05`) skips the work when the scaled delta is negligible — this is cost optimization, not cognitive contract.

  Move ops (Process B ST→LT migration) and delete ops (Process C C2) do NOT re-fire affect — they are not "remembering," they are reorganizing storage. The `affectImpact` value (incl. confidence) is updated on every merge/refresh by Op A (it can drift over time as the entry's prose evolves); insert sets the initial value. Composability with N23: the live affect layer's decay (N1) continues — N24 is an additional WRITE PATH, not a replacement for the standard Op-A-per-turn affect update. In typical use both apply: every turn updates affect from the FRESH input AND re-fires the affect of any entries that get touched by that input's match-tree at multiplicatively-scaled intensity.

  **v3.4 instinct-row interaction (REC-3-3 fold):** instinct rows have `affectImpact = undefined` per N28 ("instincts carry no inherent affect — they are procedural, not episodic") — so N24 re-fire is naturally bypassed for them (no row affectImpact to read). HOWEVER, the L7 refresh-COPY of an instinct in ST MAY carry a *fresh* `affectImpact` emitted by Op A — Op A sees the current situational reading and can attach an affect (e.g., a safety-instinct activated in a tense moment carries `{label: '警觉', intensity: 0.7, confidence: 0.8}` on the ST copy). The instinct LT original retains `affectImpact = undefined`; only the situational ST copy carries the freshly-judged affect. N24 re-fire then applies to the ST copy normally.

  **Addresses existing R13 (affect amplification):** low-confidence entries apply softly (and below 0.05 are skipped for perf); high-confidence salient ones propagate at full intensity; no amplification compounding. Cites [Croissant et al PLOS ONE 2024](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0301033) appraisal-graduated emotion mechanism — graduated scaling is the literature-faithful pattern, not threshold gating.

- **N25 (v2 NEW — v3.2 N13 carried forward STRICT):** absolutely no raw engine ids appear in any prompt-side or LLM-output-side memory artifact. Specifically:
  - `knowledgeFact.entity`: stored as `v.union(v.literal('__general__'), playerId)` — engine-id allowed in the schema, but the schema validator surfaces the sentinel discoverably (replaces v1's bare `v.string()` per L3-MF2 + L1-RC5).
  - `knowledgeFact.factText`: free-text LLM-generated prose — **MUST contain display names only**. Op A's prompt is given DISPLAY NAMES (not ids) in the input slice; Op A's output prose is therefore display-name-only by construction.
  - The outer deterministic layer maps display-name → playerId before storing in the `entity` field (lookup via playerDescriptions / playerPersona).
  - Render path (§6): `entity → talkeeName` translation already deterministic (assembler resolves talkeeSurface.bioName ?? otherPlayer.name); the `factText` is rendered verbatim. v3.2 N13 ✅ verified live extends here too.

- **N26 (v3 NEW — associative keyword layer per L12).** Each
  `knowledgeFact` row stores `keywords: { keyword: string, assocRatio: number }[]`
  with `assocRatio ∈ [0, 1]` (independent per keyword; no normalization).
  Rules:
  - **Generation contract.** Op A's per-fact output schema includes a
    `keywords` array of `{keyword, assocRatio}`. Grok is instructed
    (Chinese-only tokens; 2–6 per fact in normal density; ratio
    reflects how prominently this fact would surface under that
    keyword in associative recall). For `partial` and `lt-only`
    decisions, Op A emits the **post-merge keyword list** (Grok does
    the merge inline, same place it emits `mergedFactText`). For `exact`
    decisions, Op A may either re-emit the keyword list (if the new
    input reinforces) or omit (outer layer keeps existing).
  - **Deterministic merge contract** (applies whenever a merge happens
    on the OUTSIDE of Op A — i.e., Op B's batched ST→LT and Op C's C1
    same-entity compaction, where Grok IS in the loop but the merge
    prose is emitted on a different code path; AND as a fallback for
    Op A when Grok declines to emit a fresh list): `union(a, b)`,
    on-collision `max(ratio_a, ratio_b)`, then truncate to
    `KNOWLEDGE_FACT_MAX_KEYWORDS` keeping highest ratios; on tie keep
    older keyword (stability).
  - **Bound.** Per-entry cap `KNOWLEDGE_FACT_MAX_KEYWORDS = 8` (§4).
    Per-keyword string ≤ 16 chars (informal cap, validated in mutation
    not validator — same pattern as `KNOWLEDGE_FACT_HISTORY_CAP`).
  - **N25 STRICT carry over to keywords.** Keywords are TOKENS, NEVER
    engine ids; Op A's prompt instruction makes this explicit. Outer
    code does NOT translate display-name keywords to ids (unlike the
    `entity` field) — keywords are not identity references, they are
    conceptual tags.
  - **N24 interaction.** Touching an entry's keywords (read-side) is
    NOT a "remembering" event for N24 purposes UNTIL the deferred
    decision-making layer wires associative recall as an explicit
    memory-access op. For now (v3), the existing N24 sites
    (insert / exact / partial / refresh / Process A merge) write the
    keyword list as part of the same atomic mutation that re-fires
    affect, so the two are causally co-located but not coupled. When
    the future decision-making layer arrives, its spec must explicitly
    state whether associative-recall surfacing counts as a
    "remembering" event (and therefore re-fires affect on every
    surfaced entry).
  - **Deferred decision-making consumer.** L12 keeps the use of
    these associations out of v3 deliberately. No render path consumes
    `keywords`; no Op consumes them. They are written and merged but
    not yet READ. Reviewers may not pull "but you don't USE keywords"
    into MFs for v3 — that's the intentional deferral. (v3.1: consumer
    spec'd in peer plan per §11 Q10 ✅.)

- **N27 (v3.2 NEW — Park-style importance, Rec 2).** Each
  `knowledgeFact` row carries an `importance: 1..5` integer LLM-scored
  by Op A at insertion (and re-scored at every partial/refresh —
  Op A re-judges memorability as the prose evolves). Frequency was
  used in v3 as a proxy for memorability; **`importance` is the
  proper Park et al 3rd-factor signal** that frequency cannot
  substitute for (a one-shot shocking event has `frequency=1`,
  `importance=5`; chatty trivia has `frequency=10`, `importance=1`).
  Rules:
  - **Generation contract.** Op A's per-fact output schema includes
    `importance: 1..5` (required on insert / partial / lt-only;
    optional on exact — if omitted on exact, the existing importance
    is preserved).
  - **Merge contract** (all merge sites: Op A partial / Op A L7
    refresh / Op B `merge-into-existing-LT` / Op C C1 same-entity
    compaction): `importance_merged = max(importance_a,
    importance_b)`. Importance monotonically rises with re-
    encounter, never falls. Justification: a piece of information
    that was once judged pivotal stays pivotal even as the entry's
    prose gets refined.
  - **Render score (§6).** The per-target and general-knowledge
    block ordering becomes `score = importance × frequency ×
    exp(-(now - lastUpdatedAt) / RECENCY_HALFLIFE_MS)`. Park et al
    weighted the three factors equally (α=1); we follow that
    default. Tunable per `KNOWLEDGE_IMPORTANCE_RENDER_WEIGHT` (not
    spec'd — `1` until trial says otherwise).
    - **v3.4 render-policy reconciliation caveat:** the v3.2 narrative
      claim "a one-shot pivotal event outranks chatty trivia" is
      FALSE at default α=1 on raw product: `5×1=5` vs `1×10=10` —
      trivia wins until recency-decay does enough work. The decay
      eventually rescues the pivotal-vs-trivia ordering after a few
      hours. Lens 2 Scenario S5 raised this; soften wording, raise
      `KNOWLEDGE_IMPORTANCE_RENDER_WEIGHT` if trial shows the rescue
      is too slow.
    - **v3.4 (instinct semantics):** instinct rows seed at
      `importance=3` (NOT 5) per Lens 2 MF1's reconcile. Rationale:
      the importance ladder (§5.1 prompt: 5=刻骨铭心 / 4=印象深刻 /
      3=值得记得 / 2=普通琐事 / 1=可有可无) is about *episodic*
      memorability. Instincts are *procedural*; they do not belong
      on the episodic-pivotal scale. Importance=3 ("值得记得") puts
      them at parity-or-below most warm-state op-a facts and avoids
      cold-start dominance of the §6 render block. Combined with the
      new `INSTINCT_RENDER_FLOOR = 2` (§6) and the `lastUpdatedAt`
      refresh on slice inclusion (§5.1), this resolves BOTH the Lens
      2 cold-start dominance AND the Lens 4 day-2 invisibility
      concerns with one consistent policy.
  - **Bounds.** `KNOWLEDGE_IMPORTANCE_MIN = 1`, `KNOWLEDGE_IMPORTANCE_MAX
    = 5`, default `1` when Op A omits the field. Clamped in mutation.
  - **N25 carry.** Importance is a number, not a name; no engine-id
    concern.
  - Cites [Park et al 2023 §4.1 retrieval](https://arxiv.org/abs/2304.03442).

- **N28 (v3.3 NEW — instinct immutability per L23).** Rows with
  `source === 'instinct'` are pre-seeded basic-survival-heuristic
  entries injected at agent init by `seedBasicInstincts`. They obey
  the following immutability contract on top of the standard
  `knowledgeFact` semantics:

  **Write-side guarantees:**
  - `seedBasicInstincts` is the SOLE writer of `source === 'instinct'`
    rows. Op A NEVER emits `source: 'instinct'` (its outputs are
    always `source: 'op-a'`). Outer code enforces this in the
    mutation.
  - All instinct rows are inserted at `tier: 'LT'` directly (skip
    ST). They never undergo Op B promotion.
  - All instinct rows are inserted with `pinned: true`,
    `importance: 5` (always-pivotal — they're the cognitive bedrock),
    `frequency: 1` (rises only via Op A `exact`/`partial`/`lt-only`
    match hits — see L7 interaction below), `createdAt = now`,
    `affectImpact = null` (instincts carry no inherent affect — they
    are procedural, not episodic).

  **Read-side carry:** instinct rows participate in the normal Op A
  match-tree (their `factText` + `keywords` show up in Op A's LT
  slice when the entity matches), normal §6 per-target render
  (highest-importance × highest-pin, so they tend to surface),
  normal Op E-G recall (their keywords match against the seed-term
  lexicon per Action v1.1 §5.3).

  **Compaction immunity:**
  - **Process B never merges incoming ST rows INTO an instinct LT
    row.** Op B's outer code, when evaluating an ST candidate against
    a LT slice, filters out `source === 'instinct'` rows from the
    merge-into-existing target set. The ST candidate is then either
    `promote-as-new-LT` (creating a parallel non-instinct LT row
    about the same concept — acceptable) or `keep-in-ST` (will fade
    naturally via Process A).
  - **Process C1 never includes instinct rows in compaction batches.**
    Op C1's eligible-set filter (already excludes `pinned: true` per
    N22 + L2-MF2's `KNOWLEDGE_LT_COMPACT_MIN_AGE_MS` floor) extends
    cleanly — instinct rows are pinned, so the existing filter
    already excludes them; v3.3 ratifies this as an explicit invariant
    (no code change beyond a test).
  - **Process C2 never deletes instinct rows.** Already covered by
    N22 pinned-exclusion.

  **L7 refresh interaction (v3.4 — substantially revised per C1 +
  Lens 2 MF3 + Lens 1 REC3 convergence):** when Op A judges a new
  fact matches an instinct LT row as `lt-only`, the refresh-copy IS
  made (instinct LT row is copied into ST per L7) — this is desirable
  because it lets the active working memory carry an instinct that's
  currently relevant. The ST refresh-copy gets `source: 'op-a'`
  (NOT `'instinct'` — only the original is canonical), `sourceFactId:
  <instinct LT row id>` (back-pointer; preserved across all Op A
  operations including Process A merges — see preservation rule
  below), and **MAY carry a fresh `affectImpact` emitted by Op A**
  (the instinct LT original keeps `affectImpact = undefined`; the
  situational reading happens on the copy). N24 re-fire then applies
  normally to the ST copy at scaled `intensity × confidence`.

  **`sourceFactId` preservation rule (v3.4):** when Process A
  internally merges two ST rows, the merged row preserves
  `sourceFactId` per the following rule:
  - If exactly one of the two has a non-null `sourceFactId`, the
    merged row keeps that pointer.
  - If both have non-null `sourceFactId`s pointing to the SAME LT
    row, keep it.
  - If both have non-null `sourceFactId`s pointing to DIFFERENT LT
    rows, keep the older one (the one whose source LT row has
    earlier `createdAt`) and warn-log the divergence.
  - If both are null, merged row is null.

  This ensures Op B's downstream guard logic (which keys on
  `sourceFactId`) doesn't fail when Process A has done its
  consolidation work first.

  **Op B path for instinct-derived ST refresh-copies (v3.4 / C1 —
  CONVERGENT FROM 3 LENSES: L1-REC3 + L2-MF3 + L4-MF1):** when Op B
  evaluates an ST candidate where `sourceFactId !== null` AND the
  pointed-to LT row has `source === 'instinct'`:
  - The **merge-into-existing-LT** decision is rejected if the LT
    target is the instinct row (instinct text stays canonical, per
    v3.3 original semantics).
  - **NEW v3.4 (C1):** the **promote-as-new-LT** decision is ALSO
    rejected. Default to `keep-in-ST` for this candidate. The ST
    refresh-copy is allowed to fade naturally via Process A
    overlapping-merge with other ST rows about the same concept (if
    any), OR to stay in ST until ST-cap pressure evicts it.
    Rationale: promoting these to LT would silently dup instinct
    concepts as parallel non-instinct LT rows — over time, the LT
    accumulates two versions of every refreshed instinct, halving
    effective dynamic LT capacity.
  - The OTHER promote-as-new-LT path (where an unrelated ST row is
    Grok-judged similar to an instinct but has no `sourceFactId`)
    still promotes as normal, but the new LT row carries
    `relatedInstinctId: <instinct row id>` for diagnostic
    visibility (see schema field above; doesn't affect behavior).

  **Spec-wording correction (v3.4 per Lens 2 MF3 (c)):** v3.3's
  "keep-in-ST for one more cycle, then promote-as-new-LT on the next"
  was misleading. The actual v3.4 semantics is: "S_copy remains in ST
  as a working-memory copy until normal ST pressure evicts it via
  Process A overlapping-merge, or until ST-cap pressure forces Op A's
  ST internal compaction to age it out. It never gets promoted to LT
  as a parallel non-instinct row." Bounded by ST cap + Process A
  pressure.

  **Render distinction:** v3.3 ships WITHOUT a visual "this is an
  instinct" tag in §6 render. Instincts appear in the per-target
  block under their natural `importance × frequency × recency-decay`
  ranking. Could be reviewer-debated; flag as Q12. Rationale: the
  NPC's experiential surface shouldn't distinguish "I remember Joe
  is a thief" from "I instinctively know to scan for shelter when
  somewhere new" — both are just things she knows. Op A's prompt
  doesn't need to know the source either.

  **Cross-NPC stance:** each NPC's instinct LT set is per-NPC (owned
  by `ownerPlayerId`). v3.5 ships with one shared **universal-only**
  instinct manifest (same 15 universal rows for all NPCs per the
  2026-05-21 scope decision); per-persona instinct customization is
  a future enhancement (e.g., a wuxia warrior persona could carry
  combat-doctrine instincts, a child persona could carry attachment-
  to-caregiver instincts). All persona-specific content currently
  lives in `persona.personality` / `defaultTask` / `defaultSituation`
  rather than the instinct floor.

### 2.4 Cross-entity / general-knowledge facts (sentinel design)

Facts about places, time, weather, ambient activity (multi-modal L8)
get entity = `*` (a reserved sentinel). They participate in all caps,
compaction, refresh-memory the same way. At render time the assembler
shows them in a new `【对世界的认识】` block separate from per-target
blocks.

---

## 3. Schema design

### 3.1 New table: `knowledgeFact`

Replaces (drops) `mindState.reflectionSummary` / `.impressionDelta` /
`.globalReflection`. mindState's `emotion` and `affection` fields stay
per L10.

```ts
// convex/agent/schema.ts
// v2: entity is a discriminated union (L3-MF2 / L1-RC5) — '__general__'
// sentinel for cross-entity facts vs playerId for per-entity facts.
const ENTITY_GENERAL = '__general__';
const entityValidator = v.union(v.literal(ENTITY_GENERAL), playerId);

export const knowledgeFactFields = {
  // Owner: the NPC whose memory this is.
  ownerPlayerId: playerId,
  ownerAgentId: agentId,

  // Tier: 'ST' (short-term) | 'LT' (long-term).
  // Same entry can exist in BOTH tiers temporarily under L7 refresh.
  tier: v.union(v.literal('ST'), v.literal('LT')),

  // Entity scope (v2): per-target facts → playerId of the talkee /
  // observed party; general-knowledge facts → '__general__' sentinel.
  // The sentinel is discoverable via the validator (L1-RC5).
  entity: entityValidator,

  // Free-text fact prose. N25: MUST contain display names only (Op A
  // sees display names in input and outputs display-name-only prose;
  // outer code translates display-name → playerId before writing
  // `entity`). LLM-merged on exact-match / partial-overlap / refresh.
  // Char budget per fact: KNOWLEDGE_FACT_MAX_CHARS = 200.
  factText: v.string(),

  // Audit trail of source turns / events that contributed (capped to
  // KNOWLEDGE_FACT_HISTORY_CAP = 5; enforced in the mutation, not the
  // validator — L1-RC1).
  history: v.array(
    v.object({
      ts: v.number(),
      src: v.union(
        v.object({ kind: v.literal('msg'), messageId: v.id('messages') }),
        v.object({ kind: v.literal('perception'), event: v.string() }),
      ),
    }),
  ),

  // Counters (N18).
  frequency: v.number(),
  createdAt: v.number(),
  lastUpdatedAt: v.number(),

  // v3.2 (Rec 2 / Park et al 2023 §4.1 retrieval): how *memorable* /
  // *pivotal* this fact is, 1..5 integer, LLM-scored by Op A at
  // insertion. Frequency was a poor proxy because it conflates
  // "happened often" with "mattered" — a shocking one-shot event
  // (frequency=1) needs a way to survive against chatty trivia.
  // Multiplied into §6 render score: `score = importance × frequency
  // × exp(-Δt/τ)`. On any merge site (Op A partial/refresh, Op B,
  // Op C C1): `max(importance_a, importance_b)` — importance
  // monotonically rises with re-encounter, never falls.
  importance: v.number(),               // 1..5 integer

  // v2 (N24): "memorized affect signature" — re-applied to mindState
  // every time this entry is remembered (insert / freq++ / merge /
  // refresh / Process A merge). Updated by Op A as the entry evolves.
  // v3.2 (Rec 6): added `confidence: 0..1` — LLM's own confidence
  // that this affect annotation is accurate. N24 re-fire is gated by
  // `confidence × intensity > N24_REFIRE_THRESHOLD` (§4). Addresses
  // R13 affect amplification: low-confidence re-fires get filtered;
  // high-confidence salient ones still propagate. Cites Croissant et
  // al 2024 PLOS ONE appraisal-graduated pattern. On merge: take the
  // newer (most-recently-emitted) confidence — Op A's latest read of
  // the merged-prose's affective tone is the freshest signal.
  affectImpact: v.optional(
    v.object({
      label: v.string(),
      intensity: v.number(),           // 0..1 for emotion-like; -1..1 for affection-like
      confidence: v.number(),          // 0..1 (v3.2 Rec 6) — gates N24 re-fire
      targetEntity: v.optional(playerId), // when this fact's affect is target-specific
    }),
  ),

  // v2 (N22): contradicting entries are pinned (immune to Process C2
  // deletion) and rendered prominently (§6). v3.3 (L23 / N28): instinct
  // entries are ALSO pinned (immune to all three compaction processes
  // — B, C1, C2). Default false; set true when Op A's
  // `isContradiction` decision fires OR when seedBasicInstincts
  // inserts an instinct row.
  pinned: v.boolean(),

  // v3.3 (L23 / N28): origin of this row. 'op-a' for normal LLM-
  // extracted facts (the default for all v3 traffic); 'instinct' for
  // pre-seeded basic survival heuristics inserted via
  // seedBasicInstincts at agent init. Discriminator drives the
  // immutability semantics in §5.2/§5.3.
  source: v.union(v.literal('op-a'), v.literal('instinct')),

  // v3.3 (N28): when a row is created via L7 refresh-copy (LT → ST),
  // this field points back to the LT source row. Op B uses this to
  // detect "this ST row is a refresh-copy of an instinct LT row" and
  // skip merge-into-existing-LT for it (instinct LT text stays
  // canonical). Null for all other rows. Optional; not validator-
  // enforced as required.
  // v3.4 (C1): when Op B WOULD have promoted such a refresh-copy to
  // LT, it now instead forces `keep-in-ST` (see §5.2). The
  // sourceFactId guards both Op B paths (the merge-into-existing
  // rejection AND the promote-as-new-LT prevention).
  sourceFactId: v.optional(v.id('knowledgeFact')),

  // v3.4 (C5) — stable identity for `seedBasicInstincts` idempotency.
  // For source='instinct' rows, this is the manifest-slot identifier
  // (universal-only per 2026-05-21 scope decision, e.g., 'I-PHY-1' /
  // 'I-SAF-2' / 'I-BEL-1'). For source='op-a' rows, this is null.
  // seedBasicInstincts queries owner_tier_source index for existing
  // instinct rows + compares slot-key set against the manifest to
  // decide which to insert. Repurposes owner_tier_source from
  // "diagnostic-only" to "load-bearing" (closes L1-REC1).
  instinctSlotKey: v.optional(v.string()),

  // v3.4 (C8) — when Op B's apply-step promotes a non-refresh-copy
  // ST row to LT AND Grok had judged it semantically similar to an
  // existing INSTINCT row (which Op B cannot merge into per v3.3
  // N28), this field records the related instinct row id. Diagnostic
  // only: lets the admin dump show "this op-a LT row is the lived-
  // experience counterpart of instinct X." No behavior change; helps
  // operators see when the instinct floor + lived layer are
  // semantically overlapping.
  relatedInstinctId: v.optional(v.id('knowledgeFact')),

  // v3 (L12 / N26): associative keyword layer. Short Chinese tokens
  // tagging what this entry is "about" with per-keyword association
  // strength in [0,1]. Generated by Op A; merged on every merge site
  // per N26 deterministic merge contract; bounded by
  // KNOWLEDGE_FACT_MAX_KEYWORDS (8) and 16-char per keyword (enforced
  // in mutation, not validator). Not yet READ by any code path in v3 —
  // L12 defers the decision-making consumer to a future plan.
  keywords: v.array(
    v.object({
      keyword: v.string(),
      assocRatio: v.number(),       // [0, 1] — independent per keyword
    }),
  ),
};

export const knowledgeFactTable = {
  knowledgeFact: defineTable(knowledgeFactFields)
    // Primary access patterns:
    .index('owner_tier_entity', ['ownerPlayerId', 'tier', 'entity'])    // Op A match query
    .index('owner_tier_freq', ['ownerPlayerId', 'tier', 'frequency'])    // Process B/C ranking
    .index('owner_tier_lastUpdated', ['ownerPlayerId', 'tier', 'lastUpdatedAt']) // C tiebreak
    .index('owner_tier_pinned', ['ownerPlayerId', 'tier', 'pinned'])     // Process C exclusion (v2 N22)
    .index('owner_tier_source', ['ownerPlayerId', 'tier', 'source']),    // v3.3 — fast scan of instinct rows (e.g., dump for inspection / verify integrity)
};

// Add knowledgeFact to agentTables.
```

### 3.1.1 Engine-small `serializedAgent` additions (L1-MF2 fold)

Perception event detection (§7) needs **per-NPC state** to compare
"current observation" vs "what I'd already noticed" — `seenPlayers` for
meeting, `spatialBucket` for spatial, `lastTimeOfDayBucket` for
temporal. Per N11 these MUST live engine-small (`Agent` serialized
shape), NOT in the `worlds` doc unboundedly. Path A from L1-MF2: extend
`convex/aiTown/agent.ts:271-284` `serializedAgent` validator:

```diff
 export const serializedAgent = {
   id: agentId,
   playerId,
   toRemember: v.optional(conversationId),
   lastConversation: v.optional(v.number()),
   lastInviteAttempt: v.optional(v.number()),
   inProgressOperation: v.optional(...),
+
+  // v2 perception state (L1-MF2). All bounded per-NPC; aggregate
+  // worlds-doc growth at L3 single-NPC scale: ≤(MAX_HUMAN_PLAYERS=8)
+  // playerIds + 2 ints ≈ 100 bytes per agent. Within the size-class
+  // of the existing inProgressOperation / lastConversation fields.
+  seenPlayers: v.optional(v.array(playerId)),       // for meeting events
+  spatialBucket: v.optional(v.object({ bx: v.number(), by: v.number() })),
+  lastTimeOfDayBucket: v.optional(v.string()),       // 'morning' | 'noon' | 'evening' | 'night'
+  inProgressOpA: v.optional(v.object({              // L1-MF5 / L4-MF1: separate slot from inProgressOperation
+    started: v.number(),
+    operationId: v.string(),
+  })),
+
+  // v3.4 (C3 fix — was missing from v3.3 §3.1.1 even though §5.2/§5.3
+  // described both). Without these schema entries, Convex push would
+  // accept the schema BUT any mutation patching opBLock/opCLock
+  // would throw at validator time. Critical to land in 2A.1 with the
+  // rest of the per-agent slots so 2B/2C cron handlers don't crash.
+  opBLock: v.optional(v.object({                    // §5.2 — Op B periodic consolidation lock
+    started: v.number(),
+    runId: v.string(),
+  })),
+  opCLock: v.optional(v.object({                    // §5.3 — Op C overflow-compaction lock
+    started: v.number(),
+    runId: v.string(),
+  })),
 };
```

**Amendment to v1's "no new worlds-doc fields" claim:** there ARE new
fields on the serialized agent (which is part of the `worlds` doc).
They are bounded per-NPC and small. This is *not* an N11 violation —
N11 is about *unbounded growth*; bounded per-agent state with the
size-class of existing fields is the v3.2 / v3.x pattern (e.g.,
`lastConversation`, `lastInviteAttempt`, `inProgressOperation`,
`subdued` flagged in v4 plan §1.2).

**v3.4 amendment (C3):** `opBLock` + `opCLock` added to validator
diff above (matching their semantics described in §5.2/§5.3). v3.3
silently relied on these being on the doc; v3.4 makes the schema
match. Implementer note: the runtime `Agent` class's `serialize()`
method (`convex/aiTown/agent.ts:260-268`) must mirror the validator
— add corresponding fields. Validator-vs-runtime mismatch would
surface as a different error class than the schema push, so worth
testing both paths in 2A.1.

**`inProgressOpA` separate slot** addresses L1-MF5 / L4-MF1: Op A is a
distinct concurrent operation from `agentGenerateMessage` /
`agentRememberConversation`, so it gets its own slot. The agent's tick
gate allows them to fire in parallel (Op A processes the latest turn's
fact extraction; `agentGenerateMessage` produces the next reply against
the latest mindState). **§5.1 Op A's writes to `mindState` are atomic
per-mutation**; `agentGenerateMessage` reads the snapshot it gets at
its `queryPromptData` time. Acceptable one-turn staleness on affect
during very fast back-to-back chat (which doesn't happen often given
MESSAGE_COOLDOWN). Verified: closes L4's "NPC reply blocks on Op A
serially" concern.

### 3.2 mindState schema diff

```diff
 export const mindStateFields = {
   ownerPlayerId: playerId,
   ownerAgentId: agentId,
   targetPlayerId: playerId,
   emotion: v.optional(affectValidator),         // KEPT (L10)
   situation: v.optional(v.string()),            // KEPT (§5.1)
   task: v.optional(v.string()),                 // KEPT (§5.2)
   surroundings: v.optional(v.string()),         // KEPT (§5.3)
-  globalReflection: v.optional(v.string()),
   affection: v.optional(affectValidator),       // KEPT (L10)
-  reflectionSummary: v.optional(v.string()),
-  impressionDelta: v.optional(v.string()),
 };
```

The `mindState` table is now just the per-target affect layer +
working memory; everything semantic moves to `knowledgeFact`.

### 3.3 Net storage shape per NPC

- One `mindState` row per (owner, target) — small, scalars only.
- `knowledgeFact` rows: bounded by L4 caps. Per-NPC: N_ST + N_LT
  rows total (across all entities). At default caps (30+30 entries) ≈
  60 rows per NPC. Convex doc-size + index budget fine.

---

## 4. Concrete caps (N10 additions)

Initial defaults (tunable; reviewer-checked):

```ts
// convex/constants.ts (additions)
// Memory v2 — Tiered Knowledge-DB caps (N14 / L2 / L4).
// ST and LT have EQUAL nominal size (L4).

// Per-owner totals across ALL entities (per NPC).
export const KNOWLEDGE_ST_MAX_ENTRIES = 30;   // soft (Process A trigger)
export const KNOWLEDGE_LT_MAX_ENTRIES = 30;   // hard (Process C trigger)
export const KNOWLEDGE_ST_MAX_CHARS = 3000;   // soft
export const KNOWLEDGE_LT_MAX_CHARS = 3000;   // hard

// Per-fact cap (each entry's factText soft cap).
export const KNOWLEDGE_FACT_MAX_CHARS = 200;

// Per-fact history cap (last K source-turns retained for audit).
export const KNOWLEDGE_FACT_HISTORY_CAP = 5;

// Process B periodic consolidation interval (ms). ST pressure
// shortens this dynamically (see §5.2).
export const CONSOLIDATION_INTERVAL_MS = 5 * 60 * 1000;  // 5 min
export const CONSOLIDATION_INTERVAL_MS_UNDER_PRESSURE = 60 * 1000;  // 1 min when ST over soft cap

// Render slice for §5.5 per-target block (how many facts shown in prompt).
export const RENDER_FACTS_PER_TARGET = 8;
export const RENDER_FACTS_GENERAL = 6;

// ──────────────────────────────────────────────────────────────────────
// v2 R1 must-fix additions
// ──────────────────────────────────────────────────────────────────────

// L2-MF2 — new-entries-protected floor. Process C MUST NOT consider
// an LT entry for compaction or deletion until at least this long has
// elapsed since `createdAt`. Prevents the pathological "fact arrives,
// gets promoted to LT in 5min, gets deleted at 6min because LT is at
// cap" oscillation. Combined with N22 pinned exclusion this means
// Process C's eligible-set = LT rows where pinned=false AND
// (now - createdAt) > KNOWLEDGE_LT_COMPACT_MIN_AGE_MS.
export const KNOWLEDGE_LT_COMPACT_MIN_AGE_MS = 30 * 60 * 1000;  // 30 min

// L4-MF3 — perception event coalescing window. When two same-kind
// perception events fire for the same NPC within this window, the
// later one is dropped (or replaces the earlier without re-firing
// Op A). Targets spatial / temporal bouncing; meeting events do NOT
// coalesce (each new player is its own event but the seenPlayers set
// keeps it one-shot anyway).
export const PERCEPTION_COALESCE_WINDOW_MS = 5 * 1000;  // 5s

// L4-MF3 — outer rate-limit safety net per NPC. If Op A is fired by
// perception events more than this many times per minute (e.g., NPC
// rapid-wandering across spatial buckets), the engine drops excess
// events without scheduling Op A. Distinct from the per-kind 5s
// coalesce above; this caps the absolute Op A action volume.
export const PERCEPTION_OP_A_MAX_PER_MINUTE = 6;

// L4-MF2 / Q5 — Op B batch cap. Periodic consolidation processes at
// most this many least-frequent ST entries per run, batching their
// match-against-LT queries into ONE Grok call. Bounds Op B's worst-
// case cost and prevents convex action timeout on large ST sets.
export const OP_B_BATCH_K_MAX = 5;

// §6 render — fact ranking recency half-life. Newer facts weighted
// higher in the `frequency × exp(-Δt/τ)` ordering. Default τ ≈ 1 day
// (assumes NPCs are reasoning over recent days, not lifetimes).
export const RECENCY_HALFLIFE_MS = 24 * 60 * 60 * 1000;  // 1 day

// v3 (L12 / N26) — associative keyword layer. Per-entry cap on
// keyword list size; truncation rule is "highest assocRatio wins,
// tiebreak older keyword for stability." Initial magnitude educated
// guess; tunable in trial.
export const KNOWLEDGE_FACT_MAX_KEYWORDS = 8;

// v3 (L12 / N26) — per-keyword string char cap. Enforced in the
// mutation (truncate), not the validator (same pattern as
// KNOWLEDGE_FACT_HISTORY_CAP). Keeps short conceptual tokens, blocks
// the LLM from emitting paragraphs as "keywords."
export const KNOWLEDGE_KEYWORD_MAX_CHARS = 16;

// ──────────────────────────────────────────────────────────────────────
// v3.2 lit-review fold (Round 1.6)
// ──────────────────────────────────────────────────────────────────────

// v3.2 (Rec 2 / Park et al 2023 §4.1) — `importance` bounds.
export const KNOWLEDGE_IMPORTANCE_MIN = 1;
export const KNOWLEDGE_IMPORTANCE_MAX = 5;
export const KNOWLEDGE_IMPORTANCE_DEFAULT = 1;  // when Op A omits the field

// v3.2 (Rec 6) — N24 re-fire gate.
// **v3.4 (C9) REPLACED:** the all-or-nothing threshold was found to
// cause re-fire flicker as LLM confidence drifts between fires (e.g.,
// confidence=0.65 × intensity=0.4 → 0.26 fires; same row next time
// confidence=0.5 × intensity=0.4 → 0.20 silenced — emotionally
// inconsistent NPC behavior). Croissant-faithful appraisal-graduated
// pattern is MULTIPLICATIVE SCALING, not gating: every re-fire fires,
// but at `intensity_applied = intensity × confidence`. Low-confidence
// annotations apply softly; high-confidence ones propagate fully;
// no flicker. The constant below is now a "perf-only skip" floor:
// re-fires with `|intensity × confidence| < threshold` are skipped
// because the affect delta is negligible (cheap perf win, not a
// cognitive contract). Default 0.05; trial-tunable.
export const N24_REFIRE_PERF_FLOOR = 0.05;

// ──────────────────────────────────────────────────────────────────────
// v3.4 R2 fold additions
// ──────────────────────────────────────────────────────────────────────

// L23 (v3.3) / C8 (v3.4) — LT capacity split. Pre-v3.4 had a single
// hard cap of 30. v3.4 separates the instinct floor from the dynamic
// (op-a) capacity so instinct pre-occupation does not silently halve
// effective lived-experience capacity. Hard cap (Op C trigger) =
// INSTINCT_RESERVE + DYNAMIC_CAP. Soft cap (Op A trigger) inherits
// DYNAMIC_CAP for the op-a-side; instinct rows do not count toward
// Op A pressure (they never live in ST).
export const KNOWLEDGE_LT_INSTINCT_RESERVE = 15;       // 15 universal entries (Instinct_Manifest_Research.md §3 only; §4 REJECTED-BY-USER-SCOPE 2026-05-21)
export const KNOWLEDGE_LT_DYNAMIC_CAP = 30;             // lived-experience LT capacity (was KNOWLEDGE_LT_MAX_ENTRIES in v3.3)
export const KNOWLEDGE_LT_TOTAL_CAP = KNOWLEDGE_LT_INSTINCT_RESERVE + KNOWLEDGE_LT_DYNAMIC_CAP;   // Op C trigger threshold (= 45)

// L23 (v3.3) / C7 (v3.4) — `__general__` Op A LT slice two-budget
// rule. Pre-v3.4, all of __general__'s rows competed for one ~800-char
// budget; with 13-18 instincts each ~250-350 chars, the slice was
// instinct-saturated (~4500-6300 chars) blowing the per-entity budget.
// v3.4 separates instinct-side from op-a-side budgets in the
// __general__ entity slice, and applies a deterministic keyword-
// overlap pre-filter to select which instincts are included (those
// whose `keywords[]` intersect the input fact's keywords). Per-entity
// budget for non-__general__ entities is unchanged (800 chars total).
export const LT_GENERAL_INSTINCT_BUDGET_CHARS = 2000;   // room for ~6-8 most-relevant instincts via keyword pre-filter
export const LT_GENERAL_OPA_BUDGET_CHARS = 800;          // existing op-a-side budget for __general__

// L23 (v3.3) / render reconcile (v3.4) — render-time floor on instinct
// surfacing in the §6 general-knowledge block. Prevents Lens 4's
// "instincts invisible after 1-2 days" failure mode by guaranteeing
// at least N instinct rows surface in the general block regardless of
// `score = importance × frequency × exp(-Δt/τ)` ranking.
export const INSTINCT_RENDER_FLOOR = 2;

// v3.4 Lens 4 MF3 — Op A self-consistency CI cap (was "5+" unbounded).
// Caps nightly cost; per-field divergence weighting documented in §8
// phase 2A.1 prose.
export const OP_A_CONSISTENCY_CI_MAX_VECTORS = 12;

// L21 was used in v3.3; v3.4 introduces no new lock numbers (all
// changes ride on existing locks L23/L7/N22/N24/N26/N27/N28).
```

Numbers are educated guesses; reviewers will challenge.

---

## 5. The 3 Grok ops (operations + prompt sketches)

### 5.1 Op A — per-turn fact extraction + match (N15 / N16 / N21)

**Trigger seam (v2 — L1-MF1 fold).** v1 said "hook from
`finishSendingMessage` input handler firing" — but in this codebase the
agent's own messages reach `finishSendingMessage.handler` via a DIRECT
call from `agentFinishSendingMessage` (the agent operation that runs
after Grok generates a reply), NOT via the input dispatcher. So the
hook lives in two places, not one:

| Turn source | Hook site | Mechanism |
|---|---|---|
| **PC turn** | `convex/aiTown/conversation.ts:finishSendingMessage` input handler — same input path C003 patched | After persisting `messages` row, schedule `agentObserve` internalAction with `{conversationId, lastMessageId, ownerAgentId}` for each NPC that is a participant in this conversation. |
| **NPC turn** | `convex/aiTown/agentOperations.ts:agentFinishSendingMessage` — runs after `agentGenerateMessage` for the speaking NPC; calls `finishSendingMessage.handler` directly | After that direct call, schedule the **same** `agentObserve` for **other** NPC participants (the speaker's own self-observation is degenerate — its own utterance is already in mindState from `agentGenerateMessage`). |
| **Perception event** | New `perceptionEvent` input handler (§7) | Schedule `agentObserve` for the perceiving NPC with a synthetic observation payload instead of a messageId. |

This closes L1-MF1: there is no single "every PC and NPC turn"
chokepoint; v1's spec implicitly relied on a misread. The two-site
hook is explicit in 2A's diff list.

**Cost:** 1 Grok call per turn-per-NPC-listener (1 listener for L3
single-NPC trial). At ~1.5s per call, this adds latency between her
reply and her next available reply window — accepted per L9.

**Concurrency / inProgressOpA slot (L1-MF5 / L4-MF1 fold).** Op A runs
in its own `inProgressOpA` slot on `serializedAgent` (§3.1.1) —
distinct from `inProgressOperation` which holds
`agentGenerateMessage` / `agentRememberConversation`. The agent tick's
gate allows them to run in parallel:
- `agentGenerateMessage` reads its mindState snapshot at `queryPromptData` time;
- `agentObserve` (Op A) writes facts + affect to mindState atomically per mutation;
- one-turn staleness on affect during rapid back-to-back chat is acceptable
  (MESSAGE_COOLDOWN already gates this; L3 trial volume is low).

**Coalescing on `inProgressOpA` collision.** If a new Op A is requested
while one is in-flight for the same NPC, the new one is **queued by
appending its source-turn-id to a `pendingInputs` array** in the
`inProgressOpA` slot. When the in-flight one completes its mutation
write, the tick handler immediately schedules a follow-up Op A that
batches the pending inputs into one Grok call (multiple turn texts in
the prompt, one match-tree decision-list output). Caps queue depth at
3; excess is dropped with a warn-log.

**Prompt shape:**
- System: "你在做'感知与记忆登记'。下面是这位角色刚获取的新输入（对话/见闻），以及她目前关于相关对象的短期(ST)和长期(LT)记忆切片。请抽取若干原子事实，并对每条判定其与已有记忆的关系：插入 / 完全相同 / 部分重叠 / 仅长期记忆中存在。**如该事实是对已有记忆的明显否证（如同一人姓名不一致），请把 `isContradiction` 置 true 并在合并文本中保留双方版本。** 同时给出该事实在登记时所唤起的情绪/好恶（写入 `affectImpact`），并给出 `confidence`（0~1，你对这个情绪判断的把握度——把握不大就给低分）。**为每条事实给出 `importance`（1~5整数，5=刻骨铭心 / 4=印象深刻 / 3=值得记得 / 2=普通琐事 / 1=可有可无；一次性的震撼事件可以是5即便频次只有1，反之鸡毛蒜皮即便反复出现也是1）。为每条事实给出2–6个中文短词关键词（≤16字），每个关键词附带一个0~1之间的关联强度数值（独立，非概率分布），表示该事实在以该关键词回想时会被想起的强度。对 `partial` / `lt-only` 决策，请直接给出合并后的关键词列表（你已在 `mergedFactText` 处做了文本合并；关键词同时合并即可）。** 仅输出中文，严格JSON。"
- User: latest turn text(s) + meta (speaker(s), ts) + ST slice for each
  referenced entity + LT slice for each referenced entity (truncated to
  per-entity char budget, default 800 chars per slice).
- Output (strict JSON, no prose around) — **v2 expanded**:
  ```json
  {
    "facts": [
      {
        "entity": "<playerId-or-__general__>",  // display-name → id mapping done by outer code; LLM emits display name only, outer translates
        "entityDisplayName": "<display name as appeared in input>",
        "factText": "<≤200 chars, display-name-only prose, N25>",
        "decision": "insert" | "exact" | "partial" | "lt-only",
        "existingFactId": null | "<row id>",
        "isContradiction": false | true,
        "mergedFactText": null | "<≤200 chars; required iff decision in {partial, lt-only}; the LLM does the merge prose inline>",
        "importance": 1..5,                        // v3.2 (Rec 2 / N27) — required on insert/partial/lt-only; omit allowed on exact; outer clamps
        "affectImpact": {                          // N24 — re-fire signature stored on the row
          "label": "<emotion-or-affect label>",
          "intensity": -1..1,                      // sign carries direction for affection-like; magnitude for emotion-like
          "confidence": 0..1,                      // v3.2 (Rec 6) — gates N24 re-fire per N24_REFIRE_THRESHOLD
          "targetEntity": null | "<playerId>"
        },
        "keywords": [                              // v3 (N26) — associative layer; required on insert/partial/lt-only; optional (omit allowed) on exact
          { "keyword": "<≤16 chinese chars>", "assocRatio": 0..1 }
        ]
      }
    ],
    "affect": {                                    // global per-target affect update for THIS turn (N23 application)
      "emotion": { "label": "...", "intensity": 0..1 } | null,
      "affectionDelta": -1..1 | 0,
      "targetEntity": "<playerId>"
    }
  }
  ```
  **Inline merge prose closes Q3** (single Grok call, not two — saves a
  round-trip per partial-match fact).

- Outer deterministic layer per fact:
  1. Resolve `entityDisplayName → playerId` (lookup against
     playerDescriptions + playerPersona; if no match → `__general__`).
  2. **Normalize keywords (N26):** for each `{keyword, assocRatio}`,
     trim → drop if empty → clamp `assocRatio` to `[0, 1]` →
     truncate `keyword` to `KNOWLEDGE_KEYWORD_MAX_CHARS = 16` chars
     → de-dup (case-insensitive byte-equal; on collision take max
     ratio) → truncate list to `KNOWLEDGE_FACT_MAX_KEYWORDS = 8` by
     descending ratio, tiebreak first-occurrence wins.
  3. **Normalize importance (v3.2 N27):** clamp `fact.importance` to
     `[KNOWLEDGE_IMPORTANCE_MIN=1, KNOWLEDGE_IMPORTANCE_MAX=5]`;
     round to integer; if missing → `KNOWLEDGE_IMPORTANCE_DEFAULT=1`.
  4. **Normalize affectImpact.confidence (v3.2 Rec 6):** clamp to
     `[0, 1]`; if missing → 0.5 (neutral / unknown confidence).
  5. Apply decision:
     - `insert` → new `knowledgeFact` row, tier=`ST`, `frequency=1`,
       `importance=normalized`, `affectImpact=fact.affectImpact` (with
       confidence), `pinned=fact.isContradiction`,
       **`keywords = fact.keywords (normalized)`** (required; Op A's
       prompt requires keywords on insert).
     - `exact` → patch existing row: `frequency++`, `lastUpdatedAt=now`,
       history.append, `affectImpact=fact.affectImpact` (re-applied
       per N24 confidence-gated), **importance: if `fact.importance`
       provided, `max(row.importance, fact.importance)`; if omitted,
       keep existing unchanged**. **keywords: if `fact.keywords`
       provided, apply N26 deterministic merge**
       (`union; max-on-collision; truncate`) against existing
       `row.keywords`; if omitted, keep existing unchanged.
     - `partial` → patch existing row: `factText=fact.mergedFactText`,
       `frequency++`, `lastUpdatedAt=now`, history.append,
       `affectImpact=fact.affectImpact`,
       `importance = max(row.importance, fact.importance)` (N27
       monotonic rise),
       `pinned = pinned || fact.isContradiction`, **`keywords =
       fact.keywords (normalized)`** (Op A emits the post-merge list
       inline per N26 generation contract; outer code stores it
       directly — no extra merge step needed).
     - `lt-only` → L7 refresh: **copy** the LT row into ST (new row,
       same `factText`, `frequency=LT.frequency+1`, `createdAt=now`
       for the ST copy, `lastUpdatedAt=now`,
       `importance = max(LT.importance, fact.importance)`,
       `affectImpact=fact.affectImpact`, **`source: 'op-a'`** (the ST
       copy is op-a-sourced, NOT instinct, even when the LT original
       is — v3.3 N28), **`sourceFactId: LT.id`** (back-pointer
       enabling Op B's instinct-immunity guard later), **`keywords =
       fact.keywords (normalized)`** — Op A re-emits the keyword list
       at refresh time, allowing it to drift). Then per N17, re-pose
       the match-tree restricted to ST for this same fact — if it now
       hits an ST partial, merge them in one extra mutation. (At most
       one re-pose per `lt-only` fact; bounded.)
  6. **N24 re-fire (confidence-gated per v3.2 Rec 6)**: for every
     "remembering" op above (insert / exact / partial / refresh),
     compute `gateValue = affectImpact.confidence × |affectImpact.intensity|`;
     if `gateValue > N24_REFIRE_THRESHOLD` → the row's `affectImpact`
     is fed into mindState following N23's application discipline;
     else → re-fire SKIPPED with debug-log entry (counter incremented
     for trial observation). Insert with above-threshold gate
     immediately re-fires (degenerate first fire). For `partial`, both
     the new turn's affect AND the (possibly-updated) row affectImpact
     apply (each gated independently) — N23 governs.
     **Keywords + importance are written in the SAME mutation per N26
     + N27; touching the keyword list itself is not a separate re-fire
     event in v3.**
  7. Apply `affect` global update per N23 (`emotion`,
     `affectionDelta`, conditional `Affection.Label` write, trivial-
     skip gate). The global update is NOT gated by the N24 confidence
     threshold — that gate applies to row re-fires only; the per-turn
     LLM-judged affect delta on the speaker/talkee pair fires
     unconditionally subject to N23's existing trivial-skip rule.

**Match-slice budgeting (v3.4 — two-budget rule for `__general__` per C7):**
- For each new fact's `entity`:
  - If `entity !== '__general__'`: fetch ST + LT slices using
    `owner_tier_entity` index; truncate to char budget (default 800
    chars per slice). Same as v3.3.
  - If `entity === '__general__'`: fetch ST + LT slices using
    `owner_tier_entity`, then partition the LT slice into instinct
    rows (`source === 'instinct'`) and op-a rows. Apply separate
    budgets: `LT_GENERAL_INSTINCT_BUDGET_CHARS = 2000` for instincts,
    `LT_GENERAL_OPA_BUDGET_CHARS = 800` for op-a. **Within the
    instinct budget, apply a deterministic keyword-overlap pre-filter:**
    score each instinct by `|intersection(instinct.keywords[], input.keywords[])|`
    (where input.keywords are best-effort keywords from the new fact
    if pre-extracted, else empty — falls back to first-N by recency
    if no input keywords). Take instincts in descending overlap order
    until budget exhausted, breaking ties by ascending `createdAt`
    (oldest first, for fairness across the manifest). Pass the union
    of selected instincts + the op-a slice to Grok.
- Pass to Grok. Bounded context size.

**`lastUpdatedAt` refresh on slice inclusion (v3.4 — render-policy
reconcile):** when an instinct LT row IS included in an Op A slice
(any entity), the outer mutation patches that LT row's
`lastUpdatedAt = now` even though no merge fired. This treats "slice
presence" as a recency event, so instincts that the system is actively
reasoning about stay "warm" in §6 render rankings; instincts the
system isn't using fade naturally. (op-a rows do NOT get this
refresh — their `lastUpdatedAt` only ticks on actual
merges/freq++; the spec intent for instincts is specifically that
relevance, not just write traffic, keeps them prominent.)

**Pre-LLM exact-dup short-circuit (v3.4 / R3 mitigation, REC5
clarification):** before issuing Op A's Grok call, the outer code
runs a deterministic `factText`-equality pass against the entity's
ST slice for any input that COULD have been previously emitted by
Op A. **v3.4 — clarification on cache location:** v3.3 prose said
"cached on `messages` row" but the `messages` table has no such
field. Two implementation options for 2A.1:
- (a) **New field** on `messages`: `lastOpAFactTexts: v.optional(v.array(v.string()))`
  populated when Op A emits facts whose source includes that
  messageId. Smallest schema diff; lookup on subsequent Op A by
  `messageId`. Bounded to ~5 facts × 200 chars per message.
- (b) **No cache — pure equality scan** of the entity's ST slice
  `factText[]` against the input text. Slightly more compute per
  Op A invocation but avoids schema diff. Acceptable at ≤30 ST rows.

v3.4 ships (b) as default (no new schema diff); (a) is a future
optimization if (b) shows hot-path overhead.

**`pendingInputs` atomicity sequence (v3.4 / REC4):** the
`inProgressOpA.pendingInputs` array on `serializedAgent` is touched
by two code paths:
- **append path** (new turn arrives while Op A is in-flight): the
  scheduling code patches `inProgressOpA.pendingInputs.push(turnId)`
  via Convex `db.patch` with the explicit array-append idiom. Before
  the append, the code RE-READS `inProgressOpA` to confirm slot is
  still in-flight (`inProgressOpA !== undefined`); if not, falls
  through to fresh `agentEvaluate` schedule (Op A #2 from scratch).
- **completion path** (Op A #1's apply-mutation finishing): atomically
  READS `inProgressOpA.pendingInputs` AND CLEARS the slot (single
  `db.patch` with `pendingInputs = []` AND `inProgressOpA = undefined`),
  then schedules Op A #2 with the batched inputs from the freshly-
  read array. **The read-and-clear MUST be atomic (single mutation);
  otherwise a third turn arriving in the same engine tick as Op A
  #1's completion can land its append AFTER the clear, dropping its
  turnId.**

Cap stays at 3 (warn-log on excess drop). The append-path re-read
prevents the missed-append race; the completion-path atomicity
prevents the lost-clear race.

**Pre-LLM exact-dup short-circuit (R3 mitigation).** Before issuing
Op A's Grok call, the outer code runs a deterministic
`factText`-equality pass against ST for any input that was previously
emitted by Op A (cached on `messages` row). On exact byte-match → bump
frequency, skip Grok. Cheap and catches ~loop traffic for free.

**Op A output write atomicity.** All per-turn outer writes (knowledge
inserts/patches + mindState affect update + N24 re-fires) MUST land in
a single Convex mutation. Two reasons: (a) `agentGenerateMessage`
reading mindState mid-write would see torn state; (b) Convex's
mutation transaction is the only ordering guarantee. The pattern is
the existing `internalAction` (Grok call) → `runMutation`
(deterministic outer apply), per N11.

### 5.2 Op B — periodic ST → LT consolidation

**Trigger seam:**
- Convex cron every `CONSOLIDATION_INTERVAL_MS` (5 min default; 1 min
  under ST pressure per `CONSOLIDATION_INTERVAL_MS_UNDER_PRESSURE`).
  The cron mutation chooses the eligible NPC(s) and `scheduler.runAfter`'s
  an `opBConsolidate` internalAction per NPC.
- Process A acceleration: when ST exceeds soft cap, Op A's outer code
  schedules `opBConsolidate` immediately for that NPC (bypassing cron),
  taking the `opBLock` if available.

**Concurrency lock — `opBLock` field** (separate from `inProgressOpA`
and `inProgressOperation`). Implemented as an optional field on
`serializedAgent` alongside `inProgressOpA`:

```ts
opBLock: v.optional(v.object({ started: v.number(), runId: v.string() })),
```

If acquired by an in-flight Op B for this NPC, additional Op B
requests are skipped (the cron will pick it up next tick). Released
at the end of `opBConsolidate`'s final mutation (or after 5min
timeout — stale lock cleared with a warn-log).

**Behavior (v2 — batched K, L4-MF2 / Q5 fold; v3.3 — instinct immunity):**
1. Pick the K least-frequent ST entries via `owner_tier_freq` index,
   K = `OP_B_BATCH_K_MAX = 5`.
2. Group by `entity`. For each entity, fetch its LT slice
   (`owner_tier_entity` index, truncated to char budget). **v3.3:
   filter the LT slice to exclude `source === 'instinct'` rows from
   the merge-into-existing target set** (those rows can still appear
   in the slice's context window for the LLM's read-only awareness,
   but the post-LLM JS apply step rejects any `merge-into-existing-LT`
   decision pointing at an instinct row — falls back to
   `promote-as-new-LT` for that candidate).
3. **Single Grok call** with shape: "Here are K candidate ST entries
   about various entities, plus the LT slices for the entities they
   reference. For each candidate, decide: `merge-into-existing-LT:<id>`
   (and provide merged prose) | `promote-as-new-LT` | `keep-in-ST`
   (rare: only if Op A would clearly partial-match it within the next
   few turns, e.g., 频繁刷新的话题)." JSON output mirrors Op A's
   `facts[]` shape.
4. Outer code, in **one mutation**, applies all K decisions:
   - **v3.4 (C4 — TOCTOU mitigation):** for each candidate whose
     decision is `merge-into-existing-LT`, RE-READ the target LT row
     inside the mutation and compare `lastUpdatedAt` to the value
     seen pre-Grok-call (stored in the `inProgressOpDE` slot or
     passed through the action's args). If the value has changed
     (Op A landed a write between Op B's read and apply), SKIP this
     merge-into-existing for the candidate and fall back to
     `promote-as-new-LT` for it (treating it the same as the no-
     match path). Warn-log the TOCTOU detection. Preserves §5.1's
     stated parallelism (Op A + Op B on different locks) without
     silent overwrites of Op A's freshly-touched
     `lastUpdatedAt`/`keywords`/`importance` rises.
   - `merge-into-existing-LT` (after TOCTOU check OK) → **v3.3 GUARD**:
     if the target LT row has `source === 'instinct'`, REJECT this
     decision (warn-log) and fall back to `promote-as-new-LT` for
     this candidate UNLESS C1-v3.4-guard applies (see below). Else:
     patch LT row (`frequency += ST.frequency`;
     `factText = merged`; `history = merged`; `lastUpdatedAt = now`;
     **`importance = max(LT.importance, ST.importance)`** — v3.2 N27
     monotonic rise on merge; **`affectImpact = LT.affectImpact`** —
     N24 does NOT re-fire on Op B move ops per L11; **`keywords =
     mergeKeywords(LT.keywords, ST.keywords)` using N26's deterministic
     union+max+truncate contract** — keywords always merge structurally
     even when the Grok prose merge runs on the text side. Op B's Grok
     prompt may OPTIONALLY emit a merged keyword list per candidate,
     in which case the outer code prefers Grok's list over the
     deterministic merge; absent that, the deterministic merge is the
     floor); delete the ST row.
   - **C1 (v3.4) guard for instinct-derived refresh-copies:** if the
     candidate ST row has `sourceFactId !== null` AND the pointed-to
     LT row has `source === 'instinct'`, force `keep-in-ST` for this
     candidate (does NOT promote-as-new-LT even if the standard
     instinct-rejection fall-back would have triggered). See N28's
     L7-refresh paragraph for full rationale. **This is the v3.4
     CONVERGENT FIX** (L1-REC3 + L2-MF3 + L4-MF1) preventing silent
     duplication of instinct concepts in LT.
   - `promote-as-new-LT` (after the two guards above) → flip
     `tier: 'ST' → 'LT'` on the row in place; `lastUpdatedAt = now`.
     No re-fire (move op). Keywords unchanged (same row).
     `importance` unchanged. **v3.4 diagnostic:** if Grok's Op B
     output identified a related-but-unmergeable instinct row (i.e.,
     the candidate was Grok-judged similar to an instinct that Op B
     can't merge into), patch the now-LT row with
     `relatedInstinctId: <instinct row id>` (schema field per v3.4
     C8). No behavior change; lets admin dumps show "this op-a LT
     row is the lived-experience counterpart of instinct X."
   - `keep-in-ST` → no-op this round (frequency bumps via Op A would
     promote it organically). Keywords / importance unchanged.
5. Post-write: if LT now over hard cap → schedule one
   `opCCompact` internalAction (do NOT inline-run Process C inside Op
   B's mutation; Op C may itself need multiple Grok calls and would
   blow the mutation budget).

**N20.1 guard rail (mechanical):** the deletion step in `merge-into-
existing-LT` is allowed because the equivalent content already exists
in LT — the invariant is "no ST row dies without an equivalent LT row
existing first." Unit-tested in 2A.

**Cost:** 1 Grok call per Op B run (down from v1's O(K)). Per-NPC
amortized ~once per 5min ≈ 0.003 calls/sec. Negligible.

### 5.3 Op C — LT-overflow compaction (DELETE-as-last-resort)

**Trigger:** LT total entries OR chars > hard cap, post-Op B (Op B
schedules `opCCompact` if its own writes pushed LT over cap).

**Eligible-set definition (v2 — fold of L2-MF2 + L2-MF3 + N20.1;
v3.3 — instinct exclusion via N22 pinned + defense-in-depth source
filter; v3.4 — restated per L3-MF-3-2 to disambiguate C1 vs C2
filters):**

**v3.4 clarification (C6 fold):** C1 (compaction merge) and C2
(deletion) BOTH use the same eligible-set definition. v3.3's "the pin
semantics generalize" wording silently widened C1 to exclude ALL
pinned rows; v3.4 restores the narrower N22 — `pinned: true` excludes
from C2 deletion, AND from C1 compaction ONLY when ALSO
`source === 'instinct'`. Contradiction-pinned op-a rows CAN
participate in C1 compaction merges (Grok can compact two old
contradiction rows about the same entity into a denser fact-line).

```
// C2 (deletion) eligible-set
c2_eligible = knowledgeFact where
    tier === 'LT'
  AND pinned === false                                          // N22 — C2 excludes all pinned
  AND source !== 'instinct'                                     // v3.3 defense-in-depth
  AND (now - createdAt) > KNOWLEDGE_LT_COMPACT_MIN_AGE_MS       // L2-MF2 floor

// C1 (compaction merge) eligible-set  — v3.4 narrower
c1_eligible = knowledgeFact where
    tier === 'LT'
  AND source !== 'instinct'                                     // C1 excludes instincts (their text stays canonical)
  AND (now - createdAt) > KNOWLEDGE_LT_COMPACT_MIN_AGE_MS       // floor still applies
  // NOTE: `pinned: true` is NOT a C1 filter — contradiction rows
  // can be compaction-merged into denser fact-lines. This is
  // intentional per v3.4 C6 to keep R14 (pin pollution) from
  // calcifying chronically-contradicting topics.
```

**v3.4 trigger threshold (C8 fold — split LT caps; v3.5 2026-05-21 reserve fix-up 18→15):** Op C fires
when `knowledgeFact count for owner WHERE tier === 'LT'` exceeds
`KNOWLEDGE_LT_TOTAL_CAP = KNOWLEDGE_LT_INSTINCT_RESERVE +
KNOWLEDGE_LT_DYNAMIC_CAP` (sum = **45** post-2026-05-21; was 48 when the reserve was 18). The instinct-reserve portion
is pre-occupied by `seedBasicInstincts`; Op C never deletes / merges
those rows; the effective Op-C-eligible pool grows as op-a-sourced
LT rows accumulate. When the op-a-side reaches
`KNOWLEDGE_LT_DYNAMIC_CAP`, Op C fires to reclaim from the eligible
set.

**Strategy (in order; chunked):**

- **C1. Grok merge pass.** Take the M oldest eligible entries grouped
  by entity (`owner_tier_lastUpdated` ascending, filter by eligibility
  in JS). One Grok call per group of 2–5 entries: "压缩这几条同主体的
  长期记忆为更短的合并版本，保留关键信号"; outer code replaces the M
  rows with the merged subset within ONE mutation per group.
  `affectImpact` on the merged row = average of inputs' intensities,
  most-recent label wins, **confidence = max(inputs' confidence) — a
  compacted entry inherits the strongest confidence signal so it
  doesn't accidentally lose its re-fire eligibility**; no N24 re-fire
  (Process C is a "reorganize storage" op per L11, not a "remembering"
  op). **`importance = max(inputs' importance)`** — N27 monotonic
  rise also applies to compaction (compaction must not erase a
  previously-pivotal signal). **Keywords (N26): the Grok prompt MAY
  emit merged keyword lists per output entry; if it does, outer code
  stores them normalized; if it omits, outer code applies the
  deterministic N26 merge (union of all input entries' keywords;
  max-on-collision; truncate) over the corresponding group's inputs.**

- **C2. Last-resort delete.** If LT still over cap after C1: delete
  the K least-frequent eligible entries (`owner_tier_freq` ascending;
  tiebreak by oldest `lastUpdatedAt`). **Sole deletion path** in the
  system per L5. No N24 re-fire (delete is not "remembering").

**Chunking across actions (Convex ACTION_TIMEOUT mitigation).** If C1
needs more than 3 Grok calls (i.e., needs to compact >3 groups), it
processes 3 groups in this action, schedules a follow-up `opCCompact`
via `scheduler.runAfter(0, ...)`, and returns. Same pattern for C2 if
the delete list exceeds 10 rows (one mutation per chunk). Caps each
action invocation at ~5s wall time worst-case.

**`opCLock` field** (analogous to `opBLock`) prevents concurrent Op C
runs on the same NPC. Released at the end of the LAST chunk.

**Logged warning:** every C2 deletion logs the discarded fact + its
freq/age + `affectImpact.label` to convex logs (best-effort
traceability). Every C1 merge logs the input ids + output row id.

**Why Op B / Op C separated** (vs one big "compact" op): Op B is the
RIGHT-sized merge — same-entity ST↔LT alignment. Op C is the WRONG-
sized fallback — irreversible. Keeping them distinct + sequenced
makes "deletion as last resort" auditable (every C2 line in logs
documents real memory pressure, not noise).

---

## 6. ContextAssembler render changes

§5.5 per-target block was: `affection · summary · impressionDelta ·
ring`. Memory v2:

```
·对 <talkeeName>·
当下好恶：<value> (<label>，向长期基线缓回)        ← KEPT (affect-scalar layer, L10)
关于此人的记忆（短期 N条 / 长期 M条）：
  【冲突信息】（待澄清）：                         ← N22: pinned contradictions FIRST
    · 2026-05-20 20:25 [重要4] 据其先后所言，姓名一会儿说是「李平」一会儿说是「李星平」。(×2)
  · 2026-05-20 20:23 [重要5] (×1) 他承认自己背地里偷瞄她。  ← high importance, low freq, still ranks above:
  · 2026-05-20 20:23 [重要2] (×3) 他建议先找木屋安顿。
  · 2026-05-20 20:17 [重要1] (×1) 他询问是否找到线索。
  ... up to RENDER_FACTS_PER_TARGET, sorted by `importance × frequency × recency-decay` (v3.2 Rec 2)
最近交谈（最近N轮）：                              ← KEPT (S10 derived-window ring)
  [刚刚结束的对话]
  李平：你好...
```

Plus a new block (for general-knowledge / cross-entity facts):

```
【对世界的认识】（一般记忆，最近M条）：
  · 2026-05-20 (×5) 这里是一片宁静的乡间小镇。
  · 2026-05-20 (×2) 时间约在午后。
  ... up to RENDER_FACTS_GENERAL
```

**Ranking + render path (deterministic, no Grok at render time):**

- Per-target block: query
  `knowledgeFact.withIndex('owner_tier_entity', q => q.eq(owner).eq(target))`
  for BOTH tiers (two queries — `tier='ST'` and `tier='LT'`), then
  merge in JS and sort.
- Sort order:
  1. `pinned === true` entries FIRST (N22) under the `【冲突信息】`
     sub-header. Internal order among pinned: most-recent
     `lastUpdatedAt` first.
  2. Then non-pinned, sorted by **v3.2 (Rec 2 / Park et al §4.1)
     three-factor score**: `score = importance · frequency ·
     exp(-(now - lastUpdatedAt) / RECENCY_HALFLIFE_MS)` descending,
     taking top `RENDER_FACTS_PER_TARGET - (pinned count clamped to
     half the budget)`. The `importance` factor (1..5) ensures a
     one-shot pivotal event (`importance=5, frequency=1`) outranks
     chatty trivia (`importance=1, frequency=10`) — the gap was
     fixed by adding `importance` to the schema (v3 used freq alone
     as memorability proxy, conflating happened-often with mattered).
  3. Total block size hard-capped at `RENDER_FACTS_PER_TARGET`
     entries; if pinned alone exceeds half the budget, the pinned set
     is itself truncated by recency (the alternative — dropping all
     non-pinned — would hide currently-relevant facts behind stale
     contradictions).
- General-knowledge block: query
  `knowledgeFact.withIndex('owner_tier_entity', q =>
  q.eq(owner).eq(target='__general__'))` for both tiers, merge, sort
  by score, take top `RENDER_FACTS_GENERAL`. No pinned handling
  (general facts are unlikely to have personal-contradiction
  semantics; if a future use case needs it, add symmetrically).
  **v3.4 (render-policy reconcile per L2 MF1 + L4 R-Rec-2):** apply
  the following ordered policy:
  1. Compute `score = importance × frequency × exp(-Δt/τ)` for every
     row in the merged ST+LT general slice.
  2. Sort descending by `score`.
  3. On `score` ties, **`source: 'op-a'` wins over `source: 'instinct'`**
     (Lens 2 REC-3; lived experience surfaces first; defangs the
     "two rows about the same thing both rendered" reading).
  4. Take top `RENDER_FACTS_GENERAL` by sorted score.
  5. **NEW v3.4: enforce `INSTINCT_RENDER_FLOOR = 2`** — if fewer
     than 2 instinct rows are in the top-N selection, evict the
     lowest-scoring non-instinct rows and substitute the highest-
     scoring instinct rows not already selected until 2 instincts
     are in the rendered set OR the entire instinct pool is
     exhausted (whichever first). This prevents Lens 4's "day-2
     instinct invisibility" failure mode while keeping the
     overall block size = `RENDER_FACTS_GENERAL`.

  Combined with the `lastUpdatedAt` refresh on slice-inclusion
  (§5.1 v3.4) AND instincts seeded at `importance=3` (N27 v3.4),
  this reconciliation policy makes instincts naturally surface
  alongside warm op-a content rather than dominating cold-start
  or vanishing once op-a accumulates.

**Why JS-sort vs index ranking:** the index can give `tier`-bucketed
recency or frequency individually, but not the combined `score`
formula. Per-NPC row counts ≤60 → JS sort is O(60 log 60) ≪ 1ms.
Confirmed cheap.

**Render call signature** stays inside
`contextAssembler.buildTalkeeBlock(...)` — same N9-sealed surface
+ N13 display-name-only contract. The only new injected dependency is
a read-only `factsForTarget(targetId): KnowledgeFact[]` helper
returning merged ST+LT.

**Trivial-skip render rule.** If both blocks are empty (cold-start
NPC), render exactly the same skeleton headers with `（暂无）` placeholder,
NOT the omit-block-entirely path — keeps prompt structure stable for
Grok between cold and warm states (avoids a "schema-drift" effect on
the model's expected sections).

---

## 7. Engine integration (multi-modal perception — L8)

The biggest new surface. Conv path is per §5.1's two-site hook
(`finishSendingMessage` input handler for PC turns + post-call from
`agentFinishSendingMessage` for NPC turns). The events below are
NON-conv triggers that ALSO fire Op A with a synthetic observation.

**Per-NPC perception state lives on `serializedAgent`** (§3.1.1) —
`seenPlayers`, `spatialBucket`, `lastTimeOfDayBucket`. This is the
read-side state the per-tick checks compare against.

**Perception event sources (new wiring):**

| Event | Engine seam | Trigger frequency | Coalesce | Initial Op-A throttle |
|---|---|---|---|---|
| `meeting` (first time NPC sees a specific player in range) | `Game.tick` per-agent check: scan `world.players` for `playerId NOT IN agent.seenPlayers`; new IDs → fire event; append to `seenPlayers` (capped at MAX_HUMAN_PLAYERS+nontrivial agents ≈ 16 ids) | Once per (NPC, otherPlayer) pair | Naturally one-shot (the `seenPlayers` write makes it idempotent) | Immediate |
| `spatial` (new surroundings — NPC moved into a different region of the map) | Per-agent region-bucket check on tick; bucket change vs `agent.spatialBucket` → fire event; update bucket | Bursty during pathing | `PERCEPTION_COALESCE_WINDOW_MS = 5s` — same-kind events within 5s collapse to the latest bucket only; outer Op A receives one event with the final bucket | Cap via `PERCEPTION_OP_A_MAX_PER_MINUTE = 6` per NPC |
| `temporal` (time-of-day cross — morning/noon/evening/night) | Engine clock check on tick; current bucket vs `agent.lastTimeOfDayBucket` → fire; update | Up to 4× per game-day | Coalesce within 5s window (degenerate — boundary crossings are atomic but the 5s window catches near-crossing jitter) | Per crossing |
| `ambient` / `hear-new-sound` (activity events — overheard remote conversation, distant fight, arrival) | **Deferred to 2D-2 sub-phase.** Specification skeleton present so the input handler's discriminated union accommodates it; no engine-side emitter wired in 2D-1. Reason: ai-town has no first-class "ambient event" channel today; building one is its own design surface and would balloon 2D. | n/a | n/a | n/a |

**Coalesce mechanism (L4-MF3 fold):** the `Game.tick` per-agent loop
maintains an in-memory `pendingPerception: Map<agentId, {event, ts}>`
keyed by event-kind. Within a coalesce window, same-kind events update
the entry; on next tick after window expiry, the entry is flushed as
ONE `perceptionEvent` input. **Per-NPC volume cap:** the loop tracks a
short ring of recent Op-A fires (≤1 minute window) and drops new
non-meeting events if the count would exceed
`PERCEPTION_OP_A_MAX_PER_MINUTE`. Drops emit a warn-log; meeting
events bypass the cap (one-shot anyway).

**Input handler / action wiring.** New `perceptionEvent` input with
typed payload:

```ts
v.union(
  v.object({ kind: v.literal('meeting'),  newPlayerId: playerId }),
  v.object({ kind: v.literal('spatial'),  bucket: v.object({ bx: v.number(), by: v.number() }) }),
  v.object({ kind: v.literal('temporal'), bucket: v.string() }),
  // 'ambient' shape spec'd but emitter deferred per above:
  v.object({ kind: v.literal('ambient'),  description: v.string() }),
)
```

Its handler does ONLY: update the corresponding `serializedAgent`
state field (already done in `Game.tick` for state-mutation events
that need synchronous write-through; this handler is for the
scheduled-action seam) + schedule `agentObserve` internalAction.
`agentObserve` calls Op A with the synthetic input (a one-liner like
`"她注意到自己已经走到一个安静的院子里"` for spatial — generated
deterministically by a small render function, NOT a Grok call).

**Convex cost (per-tick, single NPC):**
- temporal: O(1)
- meeting: O(|world.players|) ≤ 16 today
- spatial: O(1) (bucket pre-compute on movement, not on tick)
- ambient: not yet implemented

Within engine-tick budget for L3 trial. **Multi-NPC scaling note**
(forward-looking): per-tick cost grows O(N × M) where N=NPCs,
M=players. At 8 NPCs × 16 players × 4 ticks/sec ≈ 512 checks/sec —
still within budget but worth revisiting at multi-NPC.

---

## 8. Phase sequencing

Strictly ordered; each phase independently committable + reviewable
under Mandate B (≥2-lens micro-review per sub-phase, since each
introduces real behavior). 2A also has an explicit Mandate-A consensus
gate (this whole plan) before any code lands.

| Phase | Scope |
|---|---|
| **2A.0 — Pre-cutover data migration** (L1-MF3 fold; v3.4 — C2 fix removes step (5)) | One-shot ordered reset on `wooden-shepherd-675`: (1) snapshot live mindState + (any) v3.2 reflection/impressionDelta values to a JSONL audit file (best-effort archival; not re-imported); (2) `npx convex run testing:wipeAllTables`; (3) `npx convex run init`; (4) `npx convex run persona:seedHumanMemory`. Same pattern as 1D's reset. **v3.4 (C2): step (5) `seedBasicInstincts` REMOVED from this phase** — it required the `knowledgeFact` table (lands in 2A.1) and the `seedBasicInstincts` function (lands in 2A.2). Moved to a final step of phase 2A.2 below. **No knowledgeFact data carries forward** — there isn't any yet to carry, and post-2A 琳娜 starts cold (consistent with single-NPC L3 trial scope; instinct floor lands in 2A.2). Required because 2A.1's schema diff (drops `reflectionSummary` + `impressionDelta` + `globalReflection` from mindState; adds the v3.2/v3.3/v3.4 fields) is schema-breaking on existing rows. |
| **2A.2 — `seedBasicInstincts` implementation + content + one-shot run** (v3.3 L23 / N28; v3.4 — was 2A.0.5, renumbered per C2 fix; depends on 2A.1 schema) | **Renamed from 2A.0.5** to reflect actual phase order (after 2A.0 reset AND after 2A.1 schema lands; the old 2A.0.5 name implied it ran inside 2A.0 which was the C2 ordering bug). **Depends on the instinct-content research deliverable** — `docs/Instinct_Manifest_Research.md` exists (delivered 2026-05-21); §13 of this plan ingests it. Implementation: an internalMutation `seedBasicInstincts` that for each agent inserts the 18 instinct rows from `INSTINCT_MANIFEST` (15 universal + 3 琳娜 overlay; constants file `convex/agent/instincts.ts`). Each row: `source: 'instinct'`, `pinned: true`, **v3.4: `importance: 3`** (reconciled per N27 — was `5` in v3.3), `frequency: 1`, `tier: 'LT'`, `affectImpact: undefined`, `keywords: [...curated 3-4 per row...]`, `entity: '__general__'`, `instinctSlotKey: '<manifest-slot-id>'` (v3.4 C5 field for idempotency). **Engine-async safety (L1-MF1 fold):** `seedBasicInstincts` cannot assume `init`'s scheduled `createAgent` inputs have processed by the time it runs; it must EITHER (a) be hooked into the `createAgent` input handler itself (run synchronously per-agent in the same engine cycle), OR (b) poll until `world.agents.length === Descriptions.length` before iterating. v3.4 ships (b) as default (one-shot script pattern matches the rest of 2A.0); reviewers may prefer (a) for production-on-going seeding. Final step of this phase: `npx convex run persona:seedBasicInstincts` (idempotent). Unit tests: (a) idempotent on re-run (per C5 — query `owner_tier_source` index for existing slot-keys; insert only the missing slots — see test (h) for L7 orphan case); (b) post-seed, queries via `owner_tier_source` index return exactly the manifest's row count per agent; (c) all instinct rows have `pinned: true`, `source: 'instinct'`, `tier: 'LT'`, `importance: 3`, valid `instinctSlotKey`; (d) Op B's filter excludes them as merge-into-existing targets (mock-driven); (e) Op C eligible-set excludes them (mock-driven); (f) **C1 (v3.4): Op B's apply-step forces `keep-in-ST` for ST candidates with `sourceFactId` pointing at instinct rows** (mock-driven; verifies no silent dup); (g) `sourceFactId` preservation across Process A merges (per N28 v3.4 rule); (h) L7 orphan case: instinct LT row exists, ST refresh-copy points to it via `sourceFactId`; re-run `seedBasicInstincts` → ST copy's pointer must still resolve (no orphan id); (i) keyword-overlap pre-filter for §5.1 `__general__` slice budget selects expected instincts on golden vectors. |
| **2A.1 — Schema + Op A skeleton** | Add `knowledgeFact` table + **5 indexes** (`owner_tier_entity`, `owner_tier_freq`, `owner_tier_lastUpdated`, `owner_tier_pinned`, **`owner_tier_source` v3.3**) **including v3 `keywords` + v3.2 `importance` field + v3.2 `affectImpact.confidence` + v3.3 `source` + v3.3 `sourceFactId`**; extend `serializedAgent` with the 4 perception/operation fields (§3.1.1); drop reflection fields from `mindState`; write Op A internalAction + the two-site hook (§5.1 trigger seam table); add the `pendingInputs` queueing on `inProgressOpA`; unit tests for: match-decision-tree outer layer (pure); Grok-output parse layer; N20.1 mechanical guard (ST-row never deleted without LT equivalent first); **N24 confidence-gated re-fire** (insert/exact/partial/refresh re-applies affectImpact ONLY when `confidence × \|intensity\| > N24_REFIRE_THRESHOLD`; move/delete does NOT; below-threshold skip increments a counter); **N27 importance monotonic-rise on merge** (golden vectors); display-name → playerId resolution; **N26 keyword normalization (clamp/dedup/truncate) + deterministic merge (`union; max-on-collision; truncate`) with golden vectors, including the empty-keyword regression test (R18) and admin `dumpKnowledgeFact` keyword surfacing (R19)**; **v3.2 Rec 7 — Op A self-consistency CI check**: a `npm run test:op-a-consistency` script that runs Op A twice on each of 5+ golden-vector inputs with different LLM seeds, compares `decision` / `existingFactId` / `isContradiction` / `importance(±1)` fields, flags divergence rate > 10%; runs nightly (not per-PR — Grok cost). Behaviorally: every turn extracts facts into ST WITH keywords + importance; no compaction yet; no associative READ path (deferred per L12). |
| **2B — Process B + render** | Convex cron + `opBConsolidate` internalAction with `opBLock`; ContextAssembler render rewrite (§6) including `【冲突信息】` pinned-first ordering + general-knowledge block + trivial-skip "（暂无）" placeholders. Behavioral check: 琳娜's prompt shows fact-DB entries; cross-conversation continuity verified live on `wooden-shepherd-675`. |
| **2C — Processes A + C** | ST soft-overflow → Process A (in-place merge or accelerate B); LT hard-overflow → `opCCompact` internalAction with `opCLock`, eligible-set filter (pinned=false AND age > KNOWLEDGE_LT_COMPACT_MIN_AGE_MS), chunked-across-actions guard; C2 logged-deletion verification. Cap-tuning trial on user-reported burn rate. |
| **2D — Multi-modal perception** | Three perception event sources (meeting / spatial / temporal) + `perceptionEvent` input + `agentObserve` action + coalesce window + per-NPC rate cap. Largest surgery on engine seams. **GATED ON 2A–2C green AND its own ≥2-lens Mandate-A-style review** (perception touches engine `Game.tick` — higher-blast-radius surface than Op A's per-input hook; bigger than Mandate B's "every change" threshold). `ambient`/`hear-new-sound` skeleton present but emitter deferred to a 2D-2 sub-phase. |
| **2E — Cleanup** | Remove dead v3.2 code (reflection.ts contents that don't survive; reflection prompts; the old §5.5 render path) — under its own ≥2-lens review since dead-code removal can mask live-call surprises. **v3.4 (REC-3-1 fold) — explicitly rewrite `convex/agent/memory.ts:rememberConversation` body:** the v2.x layer obsoleted its content per §1.1 row, but no prior phase owned the body rewrite. 2E now explicitly owns it. Two body options based on Action plan §6.C: (a) no-op steady state (Op A per-turn already covers in-conv facts; conv-end remember is degenerate); (b) batched-final-turn Op A call (covers any final partner-departure context that didn't trigger per-turn Op A). v3.4 ships (b) for completeness; (a) is a follow-up simplification once trial shows the final-turn path is rarely load-bearing. The `agentRememberConversation` operation seam (N11) is NOT touched. Update Memory v2 plan in place with "shipped" status per phase; write `docs/CHANGES.md` C005-2A through C005-2E entries; **update [docs/HumanMemory_AITown_Plan.md](HumanMemory_AITown_Plan.md) §13 audit** to mark N4/N5/N6/N7/N8/S4/S5/S6/S7/S12 as obsoleted-by-v2 with forward-link to this doc + the C005 series. |

**Estimated work:** 2A.0+2A.1+2B+2C is ~1.2× the size of 1D (the
match-tree + 4 indexes + 4 serializedAgent fields are net-new
complexity vs 1D's reflection-only path). 2D is ~60% of 1D. Plan
phases conservatively; reviewers may insist on splitting 2A.1 further.

---

## 9. Risks & decisions

| # | Item | Disposition |
|---|---|---|
| **R1** | **Per-turn Grok latency** (L9) — every NPC reply now blocks on Op A first (~1.5s). | Documented trade-off per L9. Mitigation: Op A can run *concurrently with* the next continueConversationMessage if structured carefully (Op A writes mindState; continueConversation reads it on next tick). Spec gives priority to correctness in 2A; latency optimization is a 2C polish item. |
| **R2** | **Op A cost** — ~2 Grok calls per conv turn + perception events. With one NPC + occasional convs, total <1 call/sec. With multi-NPC future, scales linearly. | Accept for L3 single-NPC test. Multi-NPC budget concern revisits at deferred multi-NPC phase. |
| **R3** | **LLM-judged matching unreliable** (N21) — Grok may misclassify partial-overlap vs insert vs exact. | Mitigations: (a) deterministic substring/equality pre-check before Grok call (catches exact dupes for free); (b) prompt strict JSON output schema; (c) on parse failure → fall back to `insert` (least destructive). |
| **R4** | **Contradiction detection accuracy** (N22) — Grok may flag false positives (paraphrases) or miss real contradictions. | Same mitigations as R3 + the meta-fact about source reliability is itself an LLM judgment that can be wrong. Acceptable for L3 / non-canon. Tune via post-trial. |
| **R5** | **Process C deletes memory** — only path. Per L5 this is by design (memory-pressure realism). | Logged-deletion (§5.3) for traceability. User can inspect via convex data. |
| **R6** | **Process B reconciliation duplicates** — refresh-memory copies an LT entry into ST; if not handled at Process B time, LT could end up with 2 entries about the same thing. | Op B explicitly matches the migrating ST entry against existing LT entries first (Grok call), merging on hit; this is the only way the no-duplicates invariant holds. Tested with golden vectors. |
| **R7** | **Multi-modal scope creep** — 2D is large + cuts new engine seams. | Phasing isolates risk to its own gate. 2A-2C deliver conv-only value; 2D is an explicit later commitment. |
| **R8** | **C004 agentPrompts legacy still pending** — separate concern from Memory v2; carries through unchanged. | Honor C004 separately when scheduled. |
| **R9** | **Affect-scalar update path** — L10 keeps affect; Op A pass also updates it. Need to preserve v3.2 N8 affect-application discipline (Affection.Label conditional write, baseline preservation) in the new Op A code. | Spec'd in §5.1 Op A output schema and §2 N23. Unit-tested. |
| **R10** | **Convex doc-size budget** — `knowledgeFact` per-NPC rows ≈60 at default caps. Each row ≤300 chars factText+history. ~18 KB/NPC. Within Convex limits. | Confirmed acceptable. |
| **R11** (v2; **v3.4 revised per Lens 4**) | **Cost delta vs v3.2-shipped (1D).** v3.2 ran 1 Grok call per conv-end (reflection) + 0 perception. v2 runs ~1 call per turn (Op A) + Op B periodic (~1/5min) + Op C bursts + perception-event Op-A fires. For a 10-turn conversation: v3.2 = 1 reflection call; v2 = ~10 Op A calls + 0.03 Op B amortized. **v3 v3.1 v3.2 v3.3 v3.4 cumulative additions revise this estimate upward:** v3 keyword layer adds ~+150 chars per fact rendered in slices (instructions ~+200 chars system prompt) — ~+100% Op A input size. v3.2 importance + confidence adds ~+3% input. v3.3 instinct rows in `__general__` slice would have added ~5000 chars unbounded; v3.4 C7 two-budget rule caps this at +2000 chars (~+80% on `__general__` Op A calls). Output JSON grows ~+40% from v3 keywords. **Net call count: ~10–14× (unchanged); net token spend: ~3.3–3.8×** for L3 trial (revised from v2's "~2.7×" estimate). **Peaks ~5–6×** during overlapping Routing v1 calibration trial week (per Routing R-R1). Steady-state once Routing offloads Op B/Op C to Ollama: ~2.5×. | Accepted per L9 ("latency on her replies grows"). Monitor in 2A-2C trial; primary cost-reduction lever now is Routing v1's calibration-gated Ollama offload, NOT further structural cuts to Op A. v3.4 cost ceiling will be tracked via the `op_a_queue_drop_total` + `op_a_token_total` counters (REC4 fold below). |
| **R12** (v2) | **Perception coalesce window may drop signal** — 5s window means a spatial bucket change followed quickly by another bucket change emits only the LAST. NPC "misses" the intermediate observation. | Acceptable: intermediate buckets during fast pathing aren't memorable observations anyway (the NPC is "passing through"). Tunable per `PERCEPTION_COALESCE_WINDOW_MS`. |
| **R13** (v2) | **N24 affect amplification** — every match-tree hit re-fires the stored `affectImpact`. If a single salient fact accumulates many freq++ events (say ×10 over a session), the affect re-fires 10× per session in addition to the per-turn `affect` update. Could push emotion-intensity to saturation faster than v3.2's once-per-conv-end. | This is the user's intended behavior per N24 ("emotion/affection should also be affected by the LT/ST knowledge entry remembering"). v3.2 N7 trivial-skip gate (carried in N23) prevents zero-signal re-fires; clamping (`clamp01` / `clamp(-1,1)`) caps the magnitude. Tunable via the stored `affectImpact.intensity` — Op A's prompt is what controls how aggressive these annotations get. |
| **R14** (v2) | **Pin pollution** — N22 sets `pinned=true` on every contradicting merge. A volatile NPC topic (e.g., name keeps changing) could fill the pinned slot indefinitely; Process C can't reclaim it. | Per-target render budget already clamps pinned to half the per-target block (§6); plus Op A could lower the `pinned` flag when contradictions resolve (the merged-text reconciles). 2B/2C tuning surface; not blocking. |
| **R15** (v2) | **2A.0 pre-cutover reset is user-visible** — on cutover, 琳娜 forgets everything from the v3.2 trial. | Acceptable per L3 trial scope (the user already lived through 1D's identical "fresh world" reset; current `wooden-shepherd-675` data is trial-grade, not heritage). Note in CHANGES.md C005-2A; user explicit consent via Mandate-A permission gate before 2A runs. |
| **R16** (v2) | **Op A queue depth → silent drops** (§5.1 coalescing). Cap=3; excess gets warn-logged and dropped, so a burst of perception events could lose facts. | Drops are logged; in normal L3 trial volume the cap is never hit. If observed in trial, raise cap or extend `pendingInputs` window. |
| **R17** (v3) | **Keyword cardinality drift** — across an L3 trial, the total unique keyword vocabulary across all of 琳娜's entries could grow unboundedly (each new fact may introduce new keywords). Bytes per entry are capped by `KNOWLEDGE_FACT_MAX_KEYWORDS = 8` × `KNOWLEDGE_KEYWORD_MAX_CHARS = 16` ≈ 192 bytes/entry. Across 60 entries ≈ 11 KB. Within Convex doc-size; vocabulary cardinality itself doesn't cost anything until the deferred associative-recall layer wants to index it. | Per-entry bound is tight; total cardinality is a future-decision-layer concern. Re-revisit when the consumer is spec'd. |
| **R18** (v3) | **Keyword merge inconsistency between Grok-emitted and deterministic paths** — Op A `partial`/`lt-only` decisions trust Grok's merged list; Op B's batched-call may or may not emit per-candidate keyword lists; Op C's compaction same. If Grok's merged list silently drops important keywords (vs the deterministic union+max would have preserved them), associations weaken. | Mitigation: in every merge site, if Grok's output OMITS keywords, outer code falls back to the deterministic N26 merge (never an empty-keyword regression). Op A's prompt explicitly requires keyword emission on partial/lt-only; failure to emit there falls back to deterministic merge with a warn-log. |
| **R19** (v3) | **No consumer in v3 → silent rot** — v3 writes keywords + ratios on every fact, but no code reads them. A spec drift (Grok prompt regression, mutation bug) could go undetected because no behavior observably degrades until the future decision layer ships. | Mitigation: unit-test the keyword normalization + merge functions in 2A.1 with golden vectors; add an internal `dumpKnowledgeFact` admin function (already exists for the rest of the row) that surfaces keywords for human inspection during trial. The future decision-layer spec will be a forcing function for end-to-end validation. |
| **R20** (v3.4 — Lens 4 R-Rec-4) | **Affect-staleness contract on `inProgressOpA` concurrent path is implicit.** For high-confidence + high-intensity affect annotations (the ones N24 is designed to propagate), losing one beat between Op A's apply and the next `agentGenerateMessage`'s mindState snapshot is behaviorally noticeable (user-facing tone is one turn behind). | **v3.4 disposition (informational, not a fix):** explicitly document that the steady-state contract is "the reply Right After a high-affect turn may be one beat behind in affect tone." If trial shows this is observably bad, optional 2C polish: make `agentGenerateMessage` await `inProgressOpA` when the in-flight Op A is for the most-recent turn id. v3.4 does NOT mandate the await (preserves §5.1's parallelism win); user can dispose at 2C trial-side observation. |
| **R21** (v3.4 — Lens 1 REC2) | **Op A's ~1.5s call vs `MESSAGE_COOLDOWN = 2000ms` makes "back-to-back chat doesn't happen often" optimistic.** Every PC↔NPC steady-state exchange potentially has the next-turn LLM read stale mindState (Op A still in-flight when next turn arrives). | The `pendingInputs` queue (§5.1, cap 3) catches the burst-coalesce side but not the next-reply-reads-stale-state side. v3.4 acknowledges this is steady-state, not corner-case. Mitigations: (a) accept (R20 contract); (b) raise `MESSAGE_COOLDOWN` above Op A's p95 latency in 2A.1 behavior config (defer to trial); (c) implement the await per R20 (defer). v3.4 ships (a). |
| **R22** (v3.4 — observability for trial debugging) | **Counters needed from day 1 of trial to ground future MFs.** Without counters, trial-side debugging relies on log diving. | **v3.4 (Lens 4 R-Rec-3 + L1-REC4 fold)** — instrument from 2A.1: `op_a_queue_drop_total` (per L1-REC4 + §5.1 pendingInputs cap=3 drops); `op_a_token_total` (total Grok tokens consumed by Op A, for R11 verification); `n24_refire_perf_floor_skip_total` (per N24 v3.4 — how often the floor activates); `maslow_monotonicity_violation_total` (per Action v1.1 N28 — actually lives in Action plan; cross-cited for completeness); `instinct_promote_blocked_total` (per C1 v3.4 — how often Op B forces keep-in-ST due to instinct-derived sourceFactId); `op_b_toctou_skip_total` (per C4 v3.4 — how often Op B's TOCTOU re-read triggers fall-back to promote-as-new-LT). All counters surfaced via the existing `dumpKnowledgeFact` admin helper or a new `dumpCounters` mutation. |

---

## 10. Scope fence — what this is NOT

- Not multi-NPC growth (single NPC remains; multi-NPC capacity-planning is deferred).
- Not battle / INV-8 / RelationshipGraph (already deferred from v3.x).
- Not embeddings (carried L6).
- Not the C004 `agentPrompts()` legacy cleanup (separate change).
- Not the C003 "ST-overflow discomfort" UX response (user-deferred).
- Not "world facts the NPC doesn't directly perceive" (e.g., system-level prompts injecting facts the engine knows but the NPC didn't witness) — only acquired-via-perception facts enter the DB.
- **(v3) Not the decision-making consumer of the associative keyword layer** (L12 / N26). v3 ships keyword storage + merge maintenance only. The consumer is now spec'd as a peer plan: **[Action_Decision_Maslow_Plan.md](Action_Decision_Maslow_Plan.md)** (its Op E-F / Op E-G use this layer per Action plan §5.2-§5.3 and N34-N35). That plan READS `knowledgeFact.keywords` and `knowledgeFact.affectImpact` deterministically and feeds them to its action-generation LLM call — it does NOT modify any Memory v3 row. Memory v3 phases ship independently of (and before) Action v1 phases per Action v1 §8 dependency table.

### 10.1 C003 v2 carry-forward — explicit protection (L1-MF4 fold)

The 1D / C003 conversational machinery survives v2 untouched. Every
2A.1 implementer (and every reviewer of every 2-phase diff) MUST treat
the following as no-touch unless an explicit consensus-approved
follow-up change targets them:

| Surface | Why it survives | What v2 must NOT do |
|---|---|---|
| [convex/agent/conversation.ts](../convex/agent/conversation.ts) `trimContentPrefx` (12-pattern priority-ordered, first-match-wins) + the [convex/agent/conversation.test.ts](../convex/agent/conversation.test.ts) suite | C003 Defect 3 fix — markdown-wrapped speaker prefixes were leaking into stored content. Not memory-related; orthogonal | Do not rewrite the prefix list; do not reorder patterns; do not switch to regex (the byte-equality first-match-wins ordering is what the tests pin) |
| [convex/constants.ts](../convex/constants.ts) `TYPING_TIMEOUT = 60_000`, `DIALOG_TEMPERATURE = 0.85`, `REFLECT_TEMPERATURE = 0.3` | C003 Defect 2 fix (typing throttle) + DIALOG temperature tuning + reflection temperature kept separate | Do not lower TYPING_TIMEOUT (the 10s startTyping refresh pattern in MessageInput.tsx depends on it being well above 10s); v2 adds NEW constants alongside, never edits these |
| [src/components/MessageInput.tsx](../src/components/MessageInput.tsx) — 10s-throttled `startTyping` refresh with the `inflightUuid` re-entrancy guard | C003 Defect 2 fix — replaced the bugged `currentlyTyping ||` short-circuit | Do not reintroduce the `currentlyTyping ||` guard; keep `inflightUuid` |
| Variation hint + positive-frame name-nudge in the three [convex/agent/conversation.ts](../convex/agent/conversation.ts) builders (`startConversation` / `continueConversation` / `leaveConversation`) | C003 Defect 1 fix — 琳娜 was saying "不记得你的名字" despite having `talkeeName` in §3; the positive-frame nudge restored natural use | Do not remove or rephrase the nudge text; the trial confirmed it lands correctly with current persona |
| `mindState` fields **other than** the three removed (`reflectionSummary` / `impressionDelta` / `globalReflection`): `emotion`, `situation`, `surroundings`, `affection` | Per L10 + §3.2 schema diff. Affect-scalar layer survives intact | The §3.2 diff is the ONLY mindState schema change. Do not also drop / rename `emotion`, `situation`, `surroundings`, `affection`. **v3.5 amendment (Action R1 AC3 coordinated fix, 2026-05-21):** `task` previously listed here is **REMOVED** from the protected set — peer plan [Action_Decision_Maslow_Plan.md](Action_Decision_Maslow_Plan.md) v1.3 §3.2 / L18 / N32 drops the `mindState.task` field as part of its Maslow-action design (the task system is supplanted by Maslow-priority + currentIntent surface). Memory plan no longer protects `task`; readers (`convex/agent/conversation.ts:484` `mind?.task ?? talkerPersonaDoc?.defaultTask`, `convex/agent/mindState.ts:60` `renderWorkingMemory` task arg) are rewritten as part of Action plan phase 3A. `persona.defaultTask` schema field stays for now (separate lock review — see Action plan §10.1 task carve-out). |
| [convex/agent/affect.ts](../convex/agent/affect.ts) — N1 decay math (`Affect.Current(now) = Baseline + (Value − Baseline) · exp(−dt/HalfLife)`) | Per N1 carry-forward; N12 read-time decay rendering depends on it | Do not refactor the math; if v2 needs new helpers, add NEXT to the existing ones |
| [convex/agent/worldContext.ts](../convex/agent/worldContext.ts) — S11 base+overlay surroundings | Surviving infrastructure per §1.1 | No edits |
| [convex/agent/persona.ts](../convex/agent/persona.ts) — 琳娜 + 李平 persona content (C002 variant b) | Test-bed content; user-authored | No edits |
| C003-style mandate-discipline ([memory/plan-review-workflow.md](../../../.claude/projects/c--Users-aaronzhong-Documents-Claude-Project-ai-town/memory/plan-review-workflow.md) + PLAN_REVIEW_PLAYBOOK.md) | Mandate A for project-restart-tier; Mandate B for every code change | v2 phases each go through ≥2-lens micro-review per Mandate B before landing |

Any phase whose diff touches a row in this table without an explicit
listed task in this v2 plan or a follow-up plan is OUT OF SCOPE and
MUST be split into its own change.

---

## 11. Open questions for reviewers / user

Status legend: ◯ open · ✅ resolved in v2

- **Q1 ◯ — Cap numbers.** §4 picks 30/30 entries + 3000/3000 chars + 200/fact. Are these the right starting magnitudes for one NPC + one PC trial?
- **Q2 ◯ — `*` general-entity render frequency cap.** Default `RENDER_FACTS_GENERAL = 6` — too many / too few in the prompt?
- **Q3 ✅ — Op A inline-merge.** RESOLVED v2: §5.1 Op A output schema includes `mergedFactText` inline; partial-match decisions return the merged prose in the SAME Grok call. Saves one round-trip per partial fact. Trade-off (output schema slightly fatter) is acceptable for the latency win.
- **Q4 ◯ — Perception event debounce** for spatial events: now `PERCEPTION_COALESCE_WINDOW_MS = 5s` per §4 + `PERCEPTION_OP_A_MAX_PER_MINUTE = 6` rate cap. Reviewers may challenge the 5s window magnitude given typical NPC pathing speed.
- **Q5 ✅ — Process B Grok cost.** RESOLVED v2: §5.2 Op B batches up to `OP_B_BATCH_K_MAX = 5` candidates into ONE Grok call per run instead of K. Per-run cost is O(1) Grok calls.
- **Q6 ✅ — Latency mitigation.** RESOLVED v2: §3.1.1 `inProgressOpA` slot separates Op A from `agentGenerateMessage` so they run concurrently. Acceptable one-turn affect-staleness vs visible latency win.
- **Q7 ◯ (v2 → ✅ v3.2 → ◯ re-opened v3.4 per C9 / Lens 2 MF2)** — N24 affect re-fire. v3.2's gate (`confidence × intensity > 0.25`) caused flicker (mid-tier annotations near the threshold flicker on/off as LLM confidence drifts between fires). v3.4 replaced the gate with multiplicative scaling (`intensity_applied = intensity × confidence`, no threshold; perf-only floor at 0.05). Q7 re-opens in this trial-tunability sense: the perf floor magnitude is a tunable. Behaviorally there is no more gate to revisit.
- **Q8 ◯ ELEVATED (v2 → v3.4 per L3-MF-3-2 reasoning)** — **Pin auto-release.** When Op A's merge prose resolves a previous contradiction (the new text is consistent with the prior fact, not contradictory), should Op A clear the `pinned` flag? Schema supports it; behavior not yet specified. **v3.4 elevates this Q to "trial-critical":** C6 restored the v3.2 narrower N22 (contradiction-pinned rows CAN participate in C1 compaction), which gives one release path for stale contradictions. But explicit pin auto-release on resolution remains the cleanest mechanism. Reviewers may push this from ◯ to a 2A.1 implementation requirement.
- **Q9 ◯** (v2 new) — **`__general__` entity scope per-target render visibility.** General-knowledge facts are rendered in their own block (§6). Should some of them ALSO surface in a per-target block when relevant (e.g., "it's late at night" → could affect how NPC perceives an interaction)? Currently they don't; defer.
- **Q10 ✅ (v3 → resolved v3.1 by user spec 2026-05-20) — Decision-making consumer of `keywords[]` spec'd in [Action_Decision_Maslow_Plan.md](Action_Decision_Maslow_Plan.md).** Answers per the user's Maslow-action spec: (a) Recall is **READ-ONLY** for affect / memory — no N24 re-fire on surfaced entries (Action plan N34). (b) Query shape: LLM picks top-5 keywords from the **superset across this NPC's ST+LT**, each with `effectivenessRatio`; deterministic search + per-row `score = Σ(row.assocRatio × selected.effectivenessRatio)`; sort desc; truncate to 12 (Action plan §5.3 + N35). (c) Does NOT feed Op A's match-tree — feeds the new Op E-Action chain only. (d) Does NOT feed Memory v3 §6 render — feeds Op E-Action's LLM input (which is a different rendering surface). (e) **YES — feeds the new Op E** chain (situation analysis → keyword filter → recall → action generation). Memory v3 itself remains unchanged; the consumer lives in a peer plan.
- **Q11 ◯ (v3 new) — Keyword granularity guidance for Grok.** Op A's prompt asks for "2–6 short Chinese tokens, ≤16 chars." How strict? Should it lean concrete (李平, 偷瞄) or abstract (信任, 警惕)? Trade-off: concrete keywords surface fewer cross-entry associations but are unambiguous; abstract surface more but risk collision noise. Tune in trial; revisit when consumer ships.

---

## 12. Audit trail

### Round 0 (provenance)
Authored from user dictation 2026-05-20 in response to v3.2 / 1D trial
outcome. Replaces the jynew Phase 3D memory model with a tiered
knowledge-DB. v3.2's surviving infrastructure (ContextAssembler shell,
derived-window ring S10, affect scalars with N1 decay, persona /
playerPersona / world surround) carries forward.

### Round 1 — disposition (all 4 lenses → REQUEST CHANGES on v1)

Lens charter (carried to R2 unchanged):
- **Lens 1 — Target-system / Convex architecture** — schema fit, index design, query patterns at scale, action/mutation seams, engine-tick budget for perception checks.
- **Lens 2 — Cognitive realism / design fidelity to user's specification** — does the spec actually match the user's description (L1–L11, refresh-memory, contradiction handling, compaction strategy)? Any silently dropped behaviors?
- **Lens 3 — Scope-discipline / migration / v3.2 inheritance** — is "full replace" cleanly scoped? Are surviving invariants (N1, N9, N11, N12, N13, S10) actually preserved by the spec? No silent regression.
- **Lens 4 — LLM-cost / latency / engine load** — Op A per turn (R1 / L9), Op B periodic + on-demand, Op C bursts; net token spend, Convex action time, per-tick perception overhead. Per-NPC scalable?

| MF / RC | Lens | Issue | v2 disposition |
|---|---|---|---|
| L1-MF1 | 1 | "Hook from `finishSendingMessage` input" misreads engine — NPC turns go via `agentFinishSendingMessage → handler` direct call, NOT through input dispatch | **FOLDED** §5.1 "Trigger seam (v2 — L1-MF1 fold)" — explicit two-site hook table (PC path = input handler; NPC path = direct call from `agentFinishSendingMessage`; perception path = new `perceptionEvent` input handler) |
| L1-MF2 | 1 | Per-NPC perception state (`seenPlayers` / `spatialBucket` / `lastTimeOfDayBucket`) needs to live engine-small; v1 silent on placement | **FOLDED** §3.1.1 `serializedAgent` extensions — diff against `convex/aiTown/agent.ts:271-284`; size-class amendment to N11 |
| L1-MF3 | 1 | Live data migration unaddressed — schema diff drops 3 mindState fields that exist on `wooden-shepherd-675` | **FOLDED** §8 phase 2A.0 — explicit ordered pre-cutover reset (snapshot → wipeAllTables → init → seedHumanMemory); R15 documents user-visible memory loss |
| L1-MF4 | 1 | C003 edits implicit clobber risk during 2A.1 rewrites — `trimContentPrefx` / TYPING_TIMEOUT / variation-hint / MessageInput.tsx | **FOLDED** §10.1 — explicit C003 carry-forward protection table with file paths + no-touch rules |
| L1-MF5 | 1 | `inProgressOperation` slot collision — Op A would race `agentGenerateMessage` / `agentRememberConversation` for the same lock | **FOLDED** §3.1.1 + §5.1 — separate `inProgressOpA` slot; tick allows parallel runs; one-turn affect staleness documented |
| L1-MF6 | 1 | `knowledgeFact.entity` typed as `v.string()` discards `playerId` validation discoverability | **FOLDED** §3.1 — `entityValidator = v.union(v.literal('__general__'), playerId)` discriminated union |
| L1-RC1 | 1 | `KNOWLEDGE_FACT_HISTORY_CAP` enforcement at validator level inflexible | **FOLDED** §3.1 schema comment — enforced in the mutation, not validator |
| L1-RC5 | 1 | Sentinel for cross-entity facts (v1 used bare `*` string) | **FOLDED** §3.1 — `ENTITY_GENERAL = '__general__'` named constant with discoverable validator |
| L2-MF1 | 2 | L7 "refresh memory" copy step skipped the re-match against ST after copy → 2 entries-about-same-thing race | **FOLDED** N17 + §5.1 Op A step 2.4 — outer code re-issues match-tree restricted to ST after LT→ST copy |
| L2-MF2 | 2 | Process C had no minimum-age floor; newly-promoted LT entries could be deleted within minutes | **FOLDED** §4 `KNOWLEDGE_LT_COMPACT_MIN_AGE_MS = 30min` + §5.3 eligible-set filter |
| L2-MF3 | 2 | Contradiction handling (N22) merely "records both values" — doesn't actually protect / surface the contradiction | **FOLDED** N22 — `pinned: boolean` field + Process C exclusion + §6 `【冲突信息】` render-first; new `owner_tier_pinned` index |
| L2-MF4 | 2 | "Affection is one of the emotions" semantic unification missing from L10 | **FOLDED** L10 refinement + L11 N24 — semantic unification noted; v2.0 keeps two-field schema for minimal change; v2.1 may unify |
| L2-MF5 | 2 | User's NEW design rule "remembering triggers affect re-application" missing entirely | **FOLDED** L11 + N24 + §3.1 `affectImpact` field + §5.1 step 3 re-fire wiring (insert/exact/partial/refresh re-fires; move/delete does NOT) |
| L3-MF1 | 3 | v3.2 derived-window ring (S10) carry-forward unclear — is it now Op A input or still render-time surface? | **FOLDED** §1.1 row + §2.1 N20 + §2.1 S10: KEPT as raw input source for Op A's fact extractor; also kept in §6 render (last block) |
| L3-MF2 | 3 | N13 carry-forward not pinned strict — `knowledgeFact.factText` could leak engine-ids if Op A's prompt receives them | **FOLDED** N25 + §3.1 schema comment + §5.1 step 1 — outer code translates display-name → playerId; Op A only ever sees display names |
| L3-R1 | 3 | N7/N8 affect-application detail (Affection.Label conditional write; trivial-skip carry-forward) not preserved in spec | **FOLDED** N23 — verbatim preservation of `Label = emotionLabel` rule + conditional standing-hint write + `\|affDelta\| < AFFECT_DELTA_DEADBAND (0.08)` trivial-skip |
| L4-MF1 | 4 | NPC reply blocks on Op A serially (Op A in same lock as agentGenerateMessage) | **FOLDED** (same as L1-MF5) — separate `inProgressOpA` slot; concurrent runs |
| L4-MF2 | 4 | Op B issues O(K) Grok calls per run — bursty cost | **FOLDED** §5.2 — single batched Grok call per run; `OP_B_BATCH_K_MAX = 5`; resolves Q5 |
| L4-MF3 | 4 | Perception event bursts (spatial pathing) could storm Op A | **FOLDED** §4 + §7 — `PERCEPTION_COALESCE_WINDOW_MS = 5s` + `PERCEPTION_OP_A_MAX_PER_MINUTE = 6` rate cap |

**Net change from v1 → v2:** 18 MFs folded · 8 RECs accepted ·
2 new invariants (N24, N25) · 1 new constant block in §4 · §3.1.1
new sub-section · §5.1/5.2/5.3 substantially rewritten · §6
render path rewritten with pinned-first ordering · §8 gains 2A.0
pre-cutover step + 2D strengthened gate · §9 gains R11-R16 ·
§10.1 new C003 protection table · §11 Q3/Q5/Q6 resolved + Q7-Q9
added.

### Round 1.5 — user-driven mid-cycle addition (between R1 fold and R2 spawn)

The user added one substantive design rule between v2 (R1 fold) and
the R2 spawn: **associative keyword layer** on each knowledge entry.
Captured in v3 as:

| Surface | v3 change |
|---|---|
| Status header | v2 → v3; Round 1.5 noted in opener |
| L0 locks | NEW L12 — Associative keyword layer; storage + maintenance ship in v3, decision-making consumer DEFERRED to a future user-spec'd plan |
| Invariants | NEW N26 — generation contract (Op A emits per-fact), deterministic merge contract (`union; max-on-collision; truncate to KNOWLEDGE_FACT_MAX_KEYWORDS`), N25 carry (keywords are tokens not ids), N24 interaction (touching keywords in v3 is NOT a separate re-fire event; future consumer must explicitly state) |
| §3.1 schema | `keywords: { keyword: string, assocRatio: number }[]` field on `knowledgeFact` (range `[0,1]` per keyword, independent — not normalized) |
| §4 constants | `KNOWLEDGE_FACT_MAX_KEYWORDS = 8`; `KNOWLEDGE_KEYWORD_MAX_CHARS = 16` (mutation-side cap) |
| §5.1 Op A output schema | Per-fact `keywords[]` (required on insert / partial / lt-only; optional on exact); prompt instruction updated; outer apply gains normalization step (clamp / dedup / truncate) + per-decision keyword write rules |
| §5.2 Op B | `merge-into-existing-LT` adds keyword merge (Grok may emit; deterministic merge as floor); `promote-as-new-LT` and `keep-in-ST` unchanged |
| §5.3 Op C C1 | Same pattern — Grok-preferred, deterministic-merge floor on compaction groups |
| §9 risks | NEW R17 (keyword cardinality drift; bounded per-entry, total vocabulary is a future-consumer concern), R18 (Grok-vs-deterministic merge inconsistency; mitigated by deterministic floor + warn-log), R19 (no consumer in v3 → silent rot; mitigated by unit tests + admin dump function) |
| §10 scope fence | Decision-making consumer explicitly OUT OF SCOPE for v3; reviewer-rejection floor stated |
| §11 open Qs | NEW Q10 (consumer dimensions — affect re-fire? query shape? feeds match-tree? feeds render? feeds new op?); NEW Q11 (keyword granularity guidance for Grok — concrete vs abstract) |

**Why captured BEFORE R2 (not after):** the user requested the
addition mid-cycle, before R2 was spawned. Folding now means R2
reviews v3 (R1-fold + keyword layer together) — one review round, not
two. If R2 returns MFs on the keyword layer specifically, the v3-fold
audit table here gets a `Round 2` block.

### Round 1.6 — literature-grounded reviewer (user-approved fold, 2026-05-20)

A single literature-grounded reviewer agent was spawned at user
request to scan the 2023–2026 LLM-NPC / generative-agent literature
and critique v3.1 + the peer Action plan against it. Reviewer
returned **APPROVE WITH FIXES**; user accepted all relevant
recommendations. Folded into v3.2:

| Rec | Surface | Disposition |
|---|---|---|
| **Rec 2** (Park et al 2023 §4.1 — 3rd retrieval factor) | New invariant **N27 importance**; new field `knowledgeFact.importance: 1..5`; new constants `KNOWLEDGE_IMPORTANCE_{MIN,MAX,DEFAULT}`; Op A output schema gains `importance: 1..5`; Op A prompt updated with Chinese 1–5 ladder; outer apply normalizes + clamps; merge sites take `max(a, b)` (monotonic rise); §6 render score becomes `importance × frequency × exp(-Δt/τ)`; Op B/Op C merges preserve importance with max-rule | FOLDED |
| **Rec 6** (Croissant et al 2024 — appraisal-graduated emotion) | New field `affectImpact.confidence: 0..1` on `knowledgeFact`; new constant `N24_REFIRE_THRESHOLD = 0.25`; N24 re-fire gated by `confidence × \|intensity\| > threshold`; Op A output schema gains `affectImpact.confidence`; Op A prompt updated to request confidence judgment; outer apply normalizes confidence; below-threshold skip increments debug counter for trial observation; **resolves existing Q7** | FOLDED |
| **Rec 7** (LLM-judge reliability literature) | Phase 2A.1 scope gains `npm run test:op-a-consistency` nightly CI script: runs Op A twice on golden-vector inputs with different LLM seeds, compares decisions, flags divergence rate >10% | FOLDED |
| **Rec 8** (A-MEM citation) | L12 lock-table commentary cites [A-MEM (Xu et al, NeurIPS 2025)](https://arxiv.org/abs/2502.12110) as prior art; Memory v3 keyword layer is now positioned as a faithful instance of an established pattern rather than invention | FOLDED |

**Net change v3.1 → v3.2:** 4 recommendations folded · 1 new
invariant (N27) · 2 new schema fields (`importance`,
`affectImpact.confidence`) · 3 new constants
(`KNOWLEDGE_IMPORTANCE_*`, `N24_REFIRE_THRESHOLD`) · 1 existing Q
resolved (Q7) · 4 sections updated (§3.1 schema, §4 constants, §5.1
Op A prompt+output+apply, §5.2 Op B merge, §5.3 Op C C1, §6 render,
§8 phase 2A.1, N24 / new N27 in §2.3) · 1 prior-art citation added.

**Other reviewer recommendations** (Rec 1 / Rec 3 / Rec 4 / Rec 5 /
Rec 9 / Rec 10) apply to the peer plan
[Action_Decision_Maslow_Plan.md](Action_Decision_Maslow_Plan.md) —
folded there in its v1 → v1.1 revision (user same-message approval).

### Round 1.7 — v3.3 fold (user-driven addition, 2026-05-20)

User requested two additions in one message; this entry covers
the Memory-side one (the LLM-routing one is folded into the new
peer plan
[LLM_Routing_Calibration_Plan.md](LLM_Routing_Calibration_Plan.md)).

| Surface | v3.3 change |
|---|---|
| Status header | v3.2 → v3.3; user-driven addition described |
| L0 locks | NEW L23 — basic instinct LT entries, pre-seeded, immutable |
| Invariants | N22 strengthened (pin extends to C1 compaction; instinct-pin extends further to Op B merge-into-existing); NEW N28 (full instinct-immutability contract incl. L7 refresh-copy back-pointer semantics) |
| §3.1 schema | NEW `source: 'op-a' \| 'instinct'` field (default 'op-a'); NEW `sourceFactId: v.optional(v.id('knowledgeFact'))` back-pointer; NEW `owner_tier_source` index |
| §5.1 Op A outer apply (L7 refresh step) | ST refresh-copy of an LT row gets `source: 'op-a'` (not 'instinct') + `sourceFactId: <LT.id>` for Op B's downstream guard |
| §5.2 Op B | Filter LT slice to exclude `source === 'instinct'` from merge-into-existing target set; outer apply has a GUARD that rejects `merge-into-existing-LT` decisions pointing at instinct rows and falls back to `promote-as-new-LT` |
| §5.3 Op C eligible-set | Defense-in-depth: `source !== 'instinct'` filter added alongside the existing `pinned: false` filter (technically redundant since all instincts are pinned, but cheap insurance) |
| §8 phase sequencing | NEW phase 2A.0.5 (`seedBasicInstincts` implementation + content authoring); 2A.0 step (5) added (`seedBasicInstincts` runs after `seedHumanMemory`); 2A.1 unit tests extended for source field + Op B instinct-guard + Op C instinct-exclusion + seedBasicInstincts idempotency |
| §13 (NEW below) | Instinct categories scaffold; deferred content-research task |

### 13. Basic instinct manifest — v3.4 ingests research deliverable

**v3.4 update:** the v3.3 scaffold (categories + format + open
research questions) has been answered by a delivered research pass.
**Canonical source: [docs/Instinct_Manifest_Research.md](Instinct_Manifest_Research.md)** — 16
cited findings (F1–F16), honest evaluation of the user-flagged
"only-available-male" candidate, draft `INSTINCT_MANIFEST` constant
with 15 universal entries (research §3). The research's §4 (3 琳娜-
specific overlay rows) is **REJECTED-BY-USER-SCOPE per the
2026-05-21 decision** — the basic-instinct floor must be universal
to "any 18yo (girl) reacting to any situation," not character-
or game-specific. §4 is preserved in the research doc as an audit
trail of considered-and-deferred research, not for transcription.

**v3.4 user-disposition of the research findings (locked, with 2026-05-21 scope fix):**
- **Universal manifest: 15 entries** (3 physio + 5 safety + 3 belonging + 2 esteem + 2 selfActual). All keyword-overlap-verified against `PRIORITY_SEED_TERMS` (Action v1.1 §4). This is the entire seeded instinct floor — `KNOWLEDGE_LT_INSTINCT_RESERVE = 15` (was 18 pre-decision).
- ~~**琳娜 overlay: 3 entries**~~ **REJECTED-BY-USER-SCOPE (2026-05-21)** — character-specific overlays do not belong in the basic-instinct floor. Face-culture, displacement-meaning-seeking, and default-courtesy posture move to `persona.personality` / `defaultTask` instead. See `Instinct_Manifest_Research.md` §4 banner.
- **`I-SAF-2` familiarity-under-threat (universal, sex-neutral, Bowlby/Mikulincer-Shaver):** SHIPS as universal — encodes the empirically-supported attachment-figure-seeking heuristic without sex-keying.
- **`I-SAF-3` elevated-male-wariness (universal, Öhman/Mineka + Campbell + stranger-danger lit):** SHIPS as universal per user disposition 2026-05-21. Research flagged as "most contestable" claim (R1 of research) but empirically defensible; user accepted ship-as-universal over demote-to-overlay.
- **User-flagged "rely on only-available-familiar-male for safety": REJECTED as sex-keyed instinct** per research §2 evidence (Campbell "Staying Alive", McLean/Anderson gender×fear meta, stranger-danger lit show OPPOSITE signal — unfamiliar males are wariness cue for young women, not safety cue). The 琳娜→李平 application is left for Op E decision-time given world state (李平 being the only weakly-familiar candidate), NOT hardcoded as instinct. **This converges with Lens 2 REC-L2-R2-1 (cognitive review independently concluded the same — strong dual-signal).**

**Rollout per research §6 (post-2026-05-21 scope fix):** ship-all-**15** universal entries with per-level flag for ablation debugging. `seedBasicInstincts` accepts a `levels?: MaslowLevel[]` arg; default = all levels. Trial harness can pass a subset to ablate. (Research §4's 3 persona-overlay rows are not transcribed.)

**§3.1 schema additions reflected (v3.4):** every instinct row carries `instinctSlotKey: '<manifest-slot-id>'` (universal-only, e.g., `'I-PHY-1'`, `'I-SAF-2'`, `'I-BEL-1'`) for `seedBasicInstincts` idempotency per C5.

The original §13.1 format / §13.2 category coverage / §13.3 deferred-research task / §13.4 open Qs are now historical scaffold; the canonical content lives in the research deliverable. Implementer (phase 2A.2) authors `convex/agent/instincts.ts` constants by importing the research deliverable's **§3 only** (15 universal entries) verbatim, transcribing into TypeScript with `instinctSlotKey` annotations. **§4 (3 persona-overlay rows) is NOT transcribed** per 2026-05-21 user scope decision.

#### 13.1 Format

Each entry in `INSTINCT_MANIFEST` is a partial `knowledgeFact` row
(with `source: 'instinct'`, `pinned: true`, `tier: 'LT'`,
`importance: 5`, `frequency: 1`, `affectImpact: undefined`,
`createdAt: now` auto-filled by `seedBasicInstincts`). Each entry
specifies:

```ts
type InstinctSeed = {
  // Maslow level this instinct primarily serves (for routing /
  // documentation; not stored on the row).
  primaryLevel: 'physiological' | 'safety' | 'belonging' | 'esteem' | 'selfActualization';

  // The fact text the NPC "knows" — written from the NPC's first-
  // person knowing-it perspective, Chinese, ≤200 chars.
  factText: string;

  // Keywords with assocRatios — must overlap with the PRIORITY_SEED_TERMS
  // (Action v1.1 §4) for the primaryLevel so Op E-G's recall surfaces
  // this instinct under the right priority.
  keywords: { keyword: string; assocRatio: number }[];

  // Entity scope. Mostly '__general__' (universal heuristics);
  // occasionally a persona-specific entity (e.g., the only-available-
  // male heuristic could be scoped to '__general__' but with the
  // text mentioning gender-coded survival prior).
  entity: '__general__' | string;
};
```

#### 13.2 Required category coverage (per Maslow level)

| Level | Coverage target | Examples (PLACEHOLDER — research pass writes the actual content) |
|---|---|---|
| physiological (生理) | 2–4 instincts | "饥饿时优先寻找可食之物" · "极度疲倦时身体会自行停下" · "寒冷时身体会自发蜷缩取暖" |
| safety (安全) | 4–6 instincts | "在陌生环境中先观察出入口与可避之处" · "夜间独处的不安比白日更甚" · "陌生人靠近时本能保持距离" · "**待研究 — 弱势个体在陌生环境是否倾向依附唯一可见的熟人/男性以求短期安全？**" (user-flagged candidate; needs evolutionary-psych + cross-cultural grounding before seeding) |
| belonging (归属与爱) | 2–3 instincts | "长时间无人交谈会感到孤独不安" · "被理解时会产生亲近感" |
| esteem (尊重) | 2–3 instincts | "被当众贬低会本能反击或回避" · "受到合理认可会愿意付出更多" |
| selfActualization (自我实现) | 1–2 instincts | "好奇心会驱使探索新事物" · "做有意义的事会产生持久满足" |

Total: ~13–18 instincts per NPC.

#### 13.3 Deferred research task

Before phase 2A.0.5 implementation lands, a **separate research
pass** must produce:

1. **Literature scan** of evolutionary-psychology / cross-cultural-
   psychology / social-cognition findings on universal human
   survival/affiliation/esteem instincts (e.g., Bowlby attachment
   theory, Bargh automaticity, Cialdini influence priors, gender-
   coded safety-seeking literature).
2. **Specific evaluation of the user-flagged candidate** ("for a
   young female in an unknown environment, the heuristic to
   short-term-affiliate with the only-available-known-male for
   safety") — does the literature support this as a UNIVERSAL
   instinct vs a CULTURALLY-CODED one? If culturally-coded, what's
   the appropriate scoping (persona-specific instinct manifest, not
   universal)?
3. **Draft `INSTINCT_MANIFEST` constant** (13–18 entries) covering
   §13.2's required categories, each with:
   - faithfully-translated Chinese `factText`
   - 3–5 keywords (using tokens that overlap with
     `PRIORITY_SEED_TERMS[primaryLevel]` per Action v1.1 §4)
   - citation back to the literature finding (in a parallel
     `INSTINCT_CITATIONS` doc, not stored on the row).
4. **Per-persona variant manifest** for 琳娜 specifically if the
   universal manifest doesn't cover her 18yo-female-displaced
   profile adequately.

Research deliverable lives at `docs/Instinct_Manifest_Research.md`
(to be created). When complete, its `INSTINCT_MANIFEST` constant
gets imported into `convex/agent/instincts.ts` and consumed by
`seedBasicInstincts`.

#### 13.4 Open Qs raised by L23 / N28

- **Q12 ◯** — Render distinction: should §6 visually tag instinct
  rows in the per-target block (e.g., `[本能]` prefix), or render
  them indistinguishable from learned facts? v3.3 ships without
  visual distinction (instincts surface naturally via
  importance-weighted ranking); reviewers may push back.
- **Q13 ◯** — Per-persona instinct customization: should the
  manifest be a single universal list, or per-persona overlays?
  v3.3 ships single universal; per-persona is a future enhancement.
- **Q14 ◯ (v3.3 → partially addressed v3.4 per Lens 2 MF4)** — Whether instincts can EVOLVE: if the NPC's lived
  experience contradicts an instinct (e.g., she repeatedly finds
  shelter to be unsafe), should the instinct's `factText` be
  updated, or should a new `source: 'op-a'` row co-exist? v3.3
  ships: instinct text never changes; op-a rows accumulate
  separately; the per-target render's importance ranking handles
  the surfacing decision. **v3.4 partial-mitigation:** the
  reconciled render policy (importance=3 for instincts +
  `INSTINCT_RENDER_FLOOR = 2` floor + score-tie tiebreak preferring
  op-a) means a contradicted instinct DOES fade from visible
  prominence as lived op-a accumulates (instinct: `3×1×exp(-Δt/τ)`
  drops below op-a `3×4×1`). It still surfaces via the floor (≥2
  instincts guaranteed), but other instincts ahead of it in
  keyword-overlap will tend to push contradicted ones out of the
  floor selection. Lens 2 MF4's proposed `subdued: boolean` field +
  slice-time filter remains a possible 2C+ enhancement if the
  trial-side observation shows contradicted instincts pollute the
  general-block too much. Tracking as ◯ for now.

---

### Round 2 — complete (2026-05-21)

All 4 R2 lenses returned **APPROVE WITH FIXES**. Total: 13 MFs (10
distinct after cross-lens de-dup) + 16 RECs. v3.4 folds all of them.

**Per-lens summary:**
- **Lens 1 (Convex / engine architecture):** 4 MFs + 5 RECs. Standouts: engine-async race in 2A.0 step (5) [MF1 — convergent with L3-MF-3-1]; opBLock/opCLock missing from §3.1.1 [MF3]; Op B TOCTOU vs Op A [MF4]; seedBasicInstincts idempotency contract [MF2].
- **Lens 2 (cognitive realism):** 4 MFs + 3 RECs. Standouts: instinct cold-start render dominance [MF1 → reconciled with L4 R-Rec-2]; N24 confidence-gate flicker [MF2]; L7 refresh-copy spec wording + sourceFactId-loss-on-Process-A [MF3 — convergent with L1-REC3 + L4-MF1]; Q14 stale-instinct pollution [MF4]; "exclude only-available-male" [REC-1 — convergent with research §2].
- **Lens 3 (scope/inheritance):** 2 MFs + 4 RECs. Standouts: phase 2A.0 step (5) ordering bug [MF-3-1 — convergent with L1-MF1]; N22 silent contradiction-pin widening [MF-3-2]; rememberConversation body rewrite unscheduled [REC-3-1].
- **Lens 4 (cost/latency/behavior):** 3 MFs + 4 RECs. Standouts: R11 cost estimate revision 2.7× → 3.3-3.8× [R-Rec-1]; instinct slice saturation in `__general__` [MF2]; LT effective capacity halved by instincts pre-occupying [MF1 — convergent with L1-REC3 + L2-MF3]; Op A CI cost ceiling unbounded [MF3]; render-policy reconcile [R-Rec-2 — converse direction from L2 MF1, both reconciled in v3.4].

**v3.4 disposition table (cross-lens consolidated, 10 distinct MFs):**

| # | Theme | Lenses | v3.4 fix |
|---|---|---|---|
| C1 | L7-refresh-of-instinct → silent-dup pathway | L1-REC3 + L2-MF3 + L4-MF1 | Op B forces `keep-in-ST` for instinct-derived refresh-copies (§5.2 + N28); §3.1 schema `relatedInstinctId` for diagnostic visibility on the no-sourceFactId promote-as-new-LT path |
| C2 | Phase 2A.0 step (5) cannot execute | L1-MF1 + L3-MF-3-1 | Phase 2A.0 stops at step (4); renamed 2A.0.5 → **2A.2**; seedBasicInstincts runs at end of 2A.2 (after 2A.1 schema) with engine-async safety (poll for `world.agents.length === Descriptions.length`) |
| C3 | opBLock + opCLock missing from §3.1.1 | L1-MF3 | Added both to `serializedAgent` validator diff with implementation-note about mirroring runtime `Agent.serialize()` |
| C4 | Op B TOCTOU vs Op A | L1-MF4 | Op B apply mutation re-reads target LT `lastUpdatedAt` pre-patch; mismatch → skip merge-into-existing, fall back to promote-as-new-LT; warn-log |
| C5 | seedBasicInstincts idempotency unspecified | L1-MF2 | NEW `instinctSlotKey: v.string()` schema field; seedBasicInstincts queries `owner_tier_source` index for existing slot-keys, inserts only missing slots; repurposes the previously-diagnostic-only index to load-bearing |
| C6 | N22 silent contradiction-pin widening | L3-MF-3-2 | Restored narrower N22: `pinned: true` → C2-exempt only; `pinned: true AND source: 'instinct'` → C1+C2+OpB-exempt. §5.3 eligible-set restated explicitly with separate `c1_eligible` and `c2_eligible` definitions |
| C7 | `__general__` Op A slice instinct-saturated | L4-MF2 | NEW `LT_GENERAL_INSTINCT_BUDGET_CHARS = 2000` + `LT_GENERAL_OPA_BUDGET_CHARS = 800` two-budget rule with deterministic keyword-overlap pre-filter for instinct selection |
| C8 | LT effective capacity halved | L4-MF1 | NEW `KNOWLEDGE_LT_INSTINCT_RESERVE = 15` (was 18 pre-2026-05-21; user scope fix dropped the 3 琳娜 overlays from the reserve) + `KNOWLEDGE_LT_DYNAMIC_CAP = 30` split; total cap = 45; Op C trigger math adjusted; `relatedInstinctId` diagnostic field |
| C9 | N24 confidence-gate flicker | L2-MF2 | Multiplicative scaling (Croissant-faithful) replaces all-or-nothing gate: `intensity_applied = intensity × confidence`. Perf-only floor `N24_REFIRE_PERF_FLOOR = 0.05` for skip-the-work optimization |
| C10 | rememberConversation body rewrite unscheduled | L3-REC-3-1 | Phase 2E explicitly owns rewrite; v3.4 ships option (b) batched-final-turn Op A call |

**Render-policy reconciliation (L2 MF1 + L4 R-Rec-2 — opposite-direction proposals on same root):**
- Instincts seed at `importance=3` (not 5) per Lens 2 — importance ladder is *episodic* not *procedural*
- NEW `INSTINCT_RENDER_FLOOR = 2` per Lens 4 — guarantees ≥2 instincts surface in general block
- NEW `lastUpdatedAt` refresh on Op A slice-inclusion per Lens 4 — instincts stay warm while relevant, fade when not
- Score-tie tiebreak: `source: 'op-a'` wins over `source: 'instinct'` per Lens 2 REC-3
- Combined: solves BOTH cold-start dominance AND day-2 invisibility with one consistent policy

**RECs folded:**
- L1-REC1 (owner_tier_source dead-weight) → repurposed for C5 idempotency, now load-bearing
- L1-REC4 (pendingInputs atomicity) → §5.1 atomic read-clear-schedule sequence spec'd
- L1-REC5 (exact-dup short-circuit cache location) → §5.1 clarified; ships option (b) pure equality scan, no schema diff
- L3-REC-3-2 (audit gaps) → this Round 2 entry's per-lens summary above is the gap fill
- L3-REC-3-3 (L7 refresh-copy affectImpact flow) → N24 v3.4 paragraph clarifies (ST copy may carry fresh affectImpact emitted by Op A; LT original stays null)
- L3-REC-3-4 (Action `task` drop forward-link) → §10.1 row 5 to be updated in v3.5 if needed (Action plan ships after Memory)
- L4-MF3 (Op A CI cost ceiling) → `OP_A_CONSISTENCY_CI_MAX_VECTORS = 12` constant + per-field divergence weighting documented in phase 2A.1 prose
- L4-R-Rec-1 (R11 update) → R11 revised inline
- L4-R-Rec-3 (op_a_queue_drop_total counter) → folded into NEW R22 observability counters list
- L4-R-Rec-4 (affect-staleness contract) → NEW R20 explicitly documents it

**Instinct content (research deliverable ingest, post-2026-05-21 scope fix):**
- **15 universal entries** authored per [docs/Instinct_Manifest_Research.md](Instinct_Manifest_Research.md) §3 (3 physio + 5 safety + 3 belonging + 2 esteem + 2 selfActual)
- Research §4's 3 persona-overlay rows (O-LINA-1/-2/-3) are **REJECTED-BY-USER-SCOPE per the 2026-05-21 decision** (basic instinct floor must be universal to any 18yo, not character-specific). Research doc §4 banner preserves them as audit trail; not transcribed
- User-flagged "rely on only-available-male" decomposed: familiarity-not-sex (I-SAF-2 universal) + elevated-male-wariness (I-SAF-3 universal per user disposition) + per-character application (e.g., 琳娜→李平) left for Op E decision-time (NOT hardcoded into the instinct floor)
- Strong dual-signal: cognitive review (Lens 2 REC-L2-R2-1) and research (§2) independently concluded same on "rely-on-male"

**Net change v3.3 → v3.4:** 10 distinct MFs + 13 distinct RECs folded · 4 new constants (`KNOWLEDGE_LT_INSTINCT_RESERVE`, `KNOWLEDGE_LT_DYNAMIC_CAP`, `KNOWLEDGE_LT_TOTAL_CAP`, `LT_GENERAL_INSTINCT_BUDGET_CHARS`, `LT_GENERAL_OPA_BUDGET_CHARS`, `INSTINCT_RENDER_FLOOR`, `OP_A_CONSISTENCY_CI_MAX_VECTORS`, `N24_REFIRE_PERF_FLOOR` replacing `N24_REFIRE_THRESHOLD`) · 4 new schema fields (`instinctSlotKey`, `relatedInstinctId`, `opBLock`, `opCLock`) · 1 phase renumbered (2A.0.5 → 2A.2) · 3 new risks (R20-R22) · 0 new locks (rides on existing L23/L7/N22/N24/N26/N27/N28) · 4 Qs status-changed (Q7 ◯ re-opens, Q8 elevated, Q14 partially-addressed, Q12 unchanged) · §13 scaffold replaced with research-deliverable pointer.

### Round 2.5 — cross-plan amendment v3.4 → v3.5 (no fresh review needed)

Action v1.2 R1's 4-lens review (concurrent with Memory v3.4 R2) surfaced one cross-plan contradiction needing Memory-side correction:

| Source | Finding |
|---|---|
| Action R1 A1-MF5 | Memory v3.4 §10.1 row 5 protects `task`; Action plan's §3.2 drops it. Reader-rewrite sites enumerated (`conversation.ts:484`, `mindState.ts:60`). |
| Action R1 A3-MF3 | Same cross-plan contradiction noted from integration-lens angle; carve-out paragraph needed. |
| Memory v3.4 R2 §12 audit | L3-REC-3-4 already flagged as deferred follow-up — "§10.1 row 5 to be updated in v3.5 if needed." |

**v3.5 disposition:** drop `task` from §10.1 row 5 protected set + add explicit cross-plan note about `persona.defaultTask` schema field staying (separate lock review surface). Action plan v1.3 owns the reader-rewrite sites + the carve-out paragraph in its own §10.1. Single-line change to Memory plan; no other content modified.

**Why no fresh Memory R3:** the amendment is (a) single-paragraph in scope, (b) had unanimous 3-source reviewer convergence (A1 + A3 + Memory's own R2 audit), (c) introduces no new risk vector — it removes a protection that was already in conflict with a peer plan that ships AFTER Memory. Mandate B (≥2-lens) is satisfied by the Action R1 reviewer-pair (A1 + A3) plus the Memory R2 audit citation. **Memory v3.5 reaches consensus.**

### Round 3 — pending (against v3.5)
Pending consensus on v3.5. If R3 returns 0 MFs across all 4 lenses,
Memory v3.5 reaches **consensus** and proceeds to user permission
gate → Memory phase 2A.0. Sequentially, Action v1.3 R1.5 (re-review
on the substantial Action fold) and Routing v1.1 R1 (4 lenses)
follow per user mandate. If R3 returns new MFs, fold to v3.6 and
re-R-round.
