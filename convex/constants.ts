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
export const IMPRESSION_DELTA_MAX_ENTRIES = 3;
export const IMPRESSION_DELTA_MAX_CHARS = 600;
