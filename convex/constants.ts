export const ACTION_TIMEOUT = 120_000; // more time for local dev
// export const ACTION_TIMEOUT = 60_000;// normally fine

export const IDLE_WORLD_TIMEOUT = 5 * 60 * 1000;
export const WORLD_HEARTBEAT_INTERVAL = 60 * 1000;

export const MAX_STEP = 10 * 60 * 1000;
export const TICK = 16;
export const STEP_INTERVAL = 1000;

export const PATHFINDING_TIMEOUT = 60 * 1000;
export const PATHFINDING_BACKOFF = 1000;
export const CONVERSATION_DISTANCE = 1.3;
export const MIDPOINT_THRESHOLD = 4;
// C003: bumped 15s → 60s. The MessageInput refresh ping (lastTypingPing
// 10s time-throttle) extends `since: now` while the user keeps typing;
// the 60s ceiling is a safety net for true-abandonment scenarios.
// Reviewer-confirmed FSM-safe (agent.ts:163 pre-gate prevents any
// setIsTyping throw under the stretched bound).
export const TYPING_TIMEOUT = 60 * 1000;
export const COLLISION_THRESHOLD = 0.75;

// How many human players can be in a world at once.
export const MAX_HUMAN_PLAYERS = 8;

// Don't talk to anyone for 15s after having a conversation.
export const CONVERSATION_COOLDOWN = 15000;

// Don't do another activity for 10s after doing one.
export const ACTIVITY_COOLDOWN = 10_000;

// Don't talk to a player within 60s of talking to them.
export const PLAYER_CONVERSATION_COOLDOWN = 60000;

// Invite 80% of invites that come from other agents.
export const INVITE_ACCEPT_PROBABILITY = 0.8;

// Wait for 1m for invites to be accepted.
export const INVITE_TIMEOUT = 60000;

// Wait for another player to say something before jumping in.
export const AWKWARD_CONVERSATION_TIMEOUT = 60_000; // more time locally
// export const AWKWARD_CONVERSATION_TIMEOUT = 20_000;

// Leave a conversation after participating too long.
export const MAX_CONVERSATION_DURATION = 10 * 60_000; // more time locally
// export const MAX_CONVERSATION_DURATION = 2 * 60_000;

// Leave a conversation if it has more than 8 messages;
export const MAX_CONVERSATION_MESSAGES = 8;

// Wait for 1s after sending an input to the engine. We can remove this
// once we can await on an input being processed.
export const INPUT_DELAY = 1000;

// How many memories to get from the agent's memory.
// This is over-fetched by 10x so we can prioritize memories by more than relevance.
export const NUM_MEMORIES_TO_SEARCH = 3;

// Wait for at least two seconds before sending another message.
export const MESSAGE_COOLDOWN = 2000;

// Don't run a turn of the agent more than once a second.
export const AGENT_WAKEUP_THRESHOLD = 1000;

// How old we let memories be before we vacuum them
export const VACUUM_MAX_AGE = 2 * 7 * 24 * 60 * 60 * 1000;
export const DELETE_BATCH_SIZE = 64;

// Fix B (HumanMemory_AITown_Plan trial): bumped 5min → 30min so a tester
// who steps away briefly is not auto-kicked from the world. Combined
// with the `lastInput` update on chat messages (conversation.ts
// finishSendingMessage), this should eliminate the post-conversation
// disappear that the trial surfaced.
export const HUMAN_IDLE_TOO_LONG = 30 * 60 * 1000;

export const ACTIVITIES = [
  { description: 'reading a book', emoji: '📖', duration: 60_000 },
  { description: 'daydreaming', emoji: '🤔', duration: 60_000 },
  { description: 'gardening', emoji: '🥕', duration: 60_000 },
];

export const ENGINE_ACTION_DURATION = 30000;

// Bound the number of pathfinding searches we do per game step.
export const MAX_PATHFINDS_PER_STEP = 16;

export const DEFAULT_NAME = 'Me';

// ─────────────────────────────────────────────────────────────────────
// Human-memory port (HumanMemory_AITown_Plan v2, N10) — jynew AI Tavern
// Phase 3D constants, carried VERBATIM from AITavernConstants.cs /
// MemoryCompactor.cs (see docs/_jynew_phase3d_extract.md §7). Do not
// retune without re-opening the plan review.
// ─────────────────────────────────────────────────────────────────────

// ContextAssembler section budgets (chars). §1/§4 are unseeded this
// iteration (lore stripped) but the constants are retained verbatim.
export const SECT_WORLD_BUDGET = 1500; // §1 (unseeded — S1)
export const SECT_SELFBIO_BUDGET = 600; // §2 talker self-bio
export const SECT_TALKEE_BUDGET = 400; // §3 talkee first-impression surface
export const SECT_LONGTERM_BUDGET = 3000; // §4 (unseeded — S2)
export const SECT_SHORTTERM_BUDGET = 4000; // §5.x (all of 5.0–5.5)

// Affect decay (lazy exp via Affect.Current; N1).
export const EMOTION_HALFLIFE_MS = 90_000; // ~1.5 min, reverts to 平静/0
export const EMOTION_FLOOR = 0.12; // below → omit §5.4 (N12)
export const AFFECTION_HALFLIFE_MS = 900_000; // ~15 min, reverts to baseline

// Episodic ring (derived window over `messages`, S10) + reflection.
export const MEMORY_RING_CAP = 10; // anchor + last-9 (N2)
export const AFFECT_DELTA_DEADBAND = 0.08; // salience gate (N6)
export const EMOTION_DEFAULT_INTENSITY = 0.5; // ParseEmotion default (N5)
export const GLOBAL_REFLECTION_MAX_CHARS = 300; // FoldGlobalReflection cap (S4)

// Grok reflection-consolidation call (N10).
export const REFLECT_MAX_TOKENS = 500;
export const REFLECT_TEMPERATURE = 0.3;
// C003: dialog completion temperature (vs reflection's 0.3 for
// deterministic slot parsing). 0.85 matches jynew's documented dialog
// default; encourages turn-to-turn variety in conversational replies.
export const DIALOG_TEMPERATURE = 0.85;

// ImpressionDelta overlay bounds (jynew AppendImpressionDelta; extract §3).
// Cap on number of dated overlay entries kept and total char length.
// v3.5: still referenced by reflection.ts dead-path tests (kept for them);
// no live code path uses these in v3.5 (semantic memory is in knowledgeFact).
export const IMPRESSION_DELTA_MAX_ENTRIES = 3;
export const IMPRESSION_DELTA_MAX_CHARS = 600;

// ─────────────────────────────────────────────────────────────────────
// Memory v3.5 — Tiered Knowledge-DB caps (Memory plan §4, N10 additions).
// ST and LT have EQUAL nominal char/entry budgets (L4). Numbers are
// reviewer-checked educated guesses; tunable in trial.
// ─────────────────────────────────────────────────────────────────────

// Per-owner totals across ALL entities (per NPC) — ST tier.
export const KNOWLEDGE_ST_MAX_ENTRIES = 30; // soft (Op A "in-place merge or accelerate B" trigger)
export const KNOWLEDGE_ST_MAX_CHARS = 3000; // soft
export const KNOWLEDGE_LT_MAX_CHARS = 3000; // hard

// Per-fact cap (each entry's factText soft cap) + history depth.
export const KNOWLEDGE_FACT_MAX_CHARS = 200;
export const KNOWLEDGE_FACT_HISTORY_CAP = 5;

// Op B periodic consolidation interval (ms). ST pressure shortens this
// dynamically (Memory plan §5.2).
export const CONSOLIDATION_INTERVAL_MS = 5 * 60 * 1000; // 5 min
export const CONSOLIDATION_INTERVAL_MS_UNDER_PRESSURE = 60 * 1000; // 1 min when ST over soft cap

// §6 render — per-target / general slice (how many fact rows shown).
export const RENDER_FACTS_PER_TARGET = 8;
export const RENDER_FACTS_GENERAL = 6;

// L2-MF2 — new-entries-protected floor. Op C's eligible-set is
// LT rows where pinned=false AND (now - createdAt) > this. Prevents
// the pathological "fact arrives, gets promoted to LT in 5min, deleted
// at 6min" oscillation.
export const KNOWLEDGE_LT_COMPACT_MIN_AGE_MS = 30 * 60 * 1000; // 30 min

// L4-MF3 — perception event coalescing window + outer rate-limit safety
// net per NPC. Meeting events do NOT coalesce (each new player is its
// own event); seenPlayers keeps it one-shot anyway.
export const PERCEPTION_COALESCE_WINDOW_MS = 5 * 1000;
export const PERCEPTION_OP_A_MAX_PER_MINUTE = 6;

// L4-MF2 / Q5 — Op B batch cap: at most this many least-frequent ST
// entries per run, batched into ONE Grok call. Bounds Op B's worst-case
// cost and prevents convex action timeout on large ST sets.
export const OP_B_BATCH_K_MAX = 5;

// §6 render — fact ranking recency half-life. Newer facts weighted
// higher in `frequency × exp(-Δt/τ)` ordering. Default τ ≈ 1 day
// (NPCs reason over recent days, not lifetimes).
export const RECENCY_HALFLIFE_MS = 24 * 60 * 60 * 1000;

// v3 (L12 / N26) — associative keyword layer. Per-entry cap on
// keyword-list size (truncation rule: highest assocRatio wins, tiebreak
// older keyword for stability) + per-keyword char cap.
export const KNOWLEDGE_FACT_MAX_KEYWORDS = 8;
export const KNOWLEDGE_KEYWORD_MAX_CHARS = 16;

// v3.2 (Rec 2 / Park et al 2023 §4.1) — importance bounds.
export const KNOWLEDGE_IMPORTANCE_MIN = 1;
export const KNOWLEDGE_IMPORTANCE_MAX = 5;
export const KNOWLEDGE_IMPORTANCE_DEFAULT = 1; // when Op A omits the field

// v3.2 (Rec 6) / v3.4 (C9) — N24 re-fire **perf-only skip** floor.
// REPLACES the v3.3 all-or-nothing threshold (which caused emotionally-
// inconsistent flicker as confidence drifted). Croissant-faithful pattern
// is MULTIPLICATIVE SCALING: every re-fire fires at
// `intensity_applied = intensity × confidence`. This floor only skips
// re-fires whose product is below the noise threshold (cheap perf win,
// not a cognitive contract). Default 0.05; trial-tunable.
export const N24_REFIRE_PERF_FLOOR = 0.05;

// L23 (v3.3) / C8 (v3.4) — LT capacity split. Pre-v3.4 had a single
// hard cap of 30. v3.4 separates instinct floor from dynamic (op-a)
// capacity so instinct pre-occupation does not silently halve effective
// lived-experience capacity. Hard cap (Op C trigger) = INSTINCT_RESERVE
// + DYNAMIC_CAP. Soft cap (Op A pressure) inherits DYNAMIC_CAP only;
// instinct rows never live in ST so they do not count toward Op A
// pressure.
//
// v3.5 2A.1 fix-up (2026-05-21 user scope decision, see memory note
// `basic-instincts-scope`): the seeded instinct manifest is UNIVERSAL
// ONLY — 15 entries grounded in cross-cultural literature, NO
// character-specific overlays. Research deliverable §4 (3 琳娜-overlay
// rows) is marked REJECTED-BY-USER-SCOPE in place; reserve drops 18→15.
export const KNOWLEDGE_LT_INSTINCT_RESERVE = 15; // 15 universal entries (research deliverable §3 only)
export const KNOWLEDGE_LT_DYNAMIC_CAP = 30; // lived-experience LT capacity (was KNOWLEDGE_LT_MAX_ENTRIES in v3.3)
export const KNOWLEDGE_LT_TOTAL_CAP =
  KNOWLEDGE_LT_INSTINCT_RESERVE + KNOWLEDGE_LT_DYNAMIC_CAP; // Op C trigger threshold (= 45)

// L23 (v3.3) / C7 (v3.4) — `__general__` Op A LT slice two-budget rule.
// Pre-v3.4, all __general__ rows competed for one ~800-char budget;
// with 15-18 instincts each ~250-350 chars the slice was instinct-
// saturated. v3.4 separates instinct-side from op-a-side budgets;
// deterministic keyword-overlap pre-filter selects which instincts are
// included. Per-entity budget for non-__general__ entities is
// unchanged (800 chars total).
export const LT_GENERAL_INSTINCT_BUDGET_CHARS = 2000; // room for ~6-8 most-relevant instincts via keyword pre-filter
export const LT_GENERAL_OPA_BUDGET_CHARS = 800;

// L23 (v3.3) / render reconcile (v3.4) — render-time floor on instinct
// surfacing in the §6 general-knowledge block. Prevents Lens 4's
// "instincts invisible after 1-2 days" failure mode by guaranteeing at
// least N instinct rows surface in the general block regardless of the
// `score = importance × frequency × exp(-Δt/τ)` ranking.
export const INSTINCT_RENDER_FLOOR = 2;

// v3.4 Lens 4 MF3 — Op A self-consistency CI cap (was "5+" unbounded).
// Caps nightly cost; per-field divergence weighting documented in
// Memory plan §8 phase 2A.1 prose.
export const OP_A_CONSISTENCY_CI_MAX_VECTORS = 12;

// Op A LLM call bounds (temperature low for deterministic JSON output;
// matches reflection's pattern). REFLECT_TEMPERATURE was 0.3; Op A
// produces structured JSON so we keep deterministic output here.
// 2A.10 (Bug B): bumped 800 → 1500. Trial-3 logs showed Grok hitting
// the 800 ceiling mid-response (post-2A.8 prompt expansion + Grok's
// verbose emission style with full affectImpact + keyword arrays).
// safeParseOpAResponse now has a truncation-recovery walker as a
// belt-and-suspenders backstop, but the token bump removes the
// failure mode at source for typical-size batches (2-5 facts).
export const OP_A_MAX_TOKENS = 1500;
export const OP_A_TEMPERATURE = 0.2;

// 2A.12: per-call Grok timeout. Trial-5 surfaced a Grok-side hang
// where one `agentGenerateMessage` chatCompletion ran 139 seconds
// (well past Convex's ACTION_TIMEOUT=120s), leaving the NPC silent
// for ~2 minutes until the engine timed out the in-progress operation
// and recovered.
//
// Two-part fix:
//   (a) chatCompletion uses an AbortController to give up after 30s
//       (this constant); throws a non-retryable timeout error.
//   (b) agentGenerateMessage (aiTown/agentOperations.ts) wraps the
//       call in try/catch + dispatches `agentAbortOperation` input on
//       failure. The input handler clears `inProgressOperation` AND
//       the conversation's `isTyping` flag — engine schedules a
//       fresh operation on the very next tick (~1s).
// Net NPC-visible recovery on a Grok hang: ~32s instead of ~120s.
//
// Op A (`opA.ts:opAExtract`) was already independently fire-and-
// forget (no inProgressOperation slot), so part (a) alone gives it
// the same ~32s recovery — its own try/catch surfaces a
// `[Op A] grok call failed` warn-log without further engine action.
//
// Timeout errors are flagged non-retryable in retryWithBackoff —
// otherwise the 3-retry chain (1s + 10s + 20s backoff) could push
// total wall-time WORSE than the original ACTION_TIMEOUT. We accept
// the dropped call rather than chain-retry on hung Grok. Theoretical
// pathological case (5xx-then-hang on every retry) is bounded by
// ACTION_TIMEOUT regardless.
//
// Typical observed call times (trial 1-5): agentGenerateMessage
// 1-3s, Op A 12-17s, occasional Op A 57s (Grok-side slowness
// window). 30s catches genuine hangs without false-aborting
// typical Op A or any agentGenerateMessage. The 57s outlier would
// now abort + drop one Op A turn's facts; acceptable trade for
// hang protection.
//
// Limitation: streaming-body consumption (post-fetch) is NOT covered
// by this AbortController — only the initial response fetch. No live
// caller uses `body.stream: true`; re-audit if streaming is revived.
export const GROK_CALL_TIMEOUT_MS = 30_000;

// Op A scheduling — minimum elapsed time after the prior Op A
// completion before a new turn-fire is allowed for the same NPC.
// Coalesces back-to-back turns and bounds outer Op A action volume.
// Defensive ceiling complementing PERCEPTION_OP_A_MAX_PER_MINUTE.
export const OP_A_MIN_INTERVAL_MS = 1500;
