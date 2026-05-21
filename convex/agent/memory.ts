// Human-memory port (HumanMemory_AITown_Plan v3.5 — tiered knowledge-DB).
// `rememberConversation` is the agent's post-conversation hook, called
// from `agentRememberConversation` (convex/aiTown/agentOperations.ts).
//
// v3.5 cutover state (phase 2A.1 schema-diff landing):
//   - The 1D 4-slot reflection consolidation (writes to mindState's
//     reflectionSummary / impressionDelta / globalReflection) is GONE.
//     Those fields have been removed from the schema (§3.2). Semantic
//     memory now lives entirely in the `knowledgeFact` table.
//   - Per-turn fact extraction is owned by **Op A** (Memory plan §5.1),
//     which fires from `agentGenerateMessage` and from PC turns — not
//     here. rememberConversation is the conversation-end seam only.
//   - Phase 2A.1 leaves this hook as a thin **stub** that logs and
//     returns. The optional batched-final-turn Op A call lands when
//     Op A's internalAction is wired in the next pass; until then any
//     facts from the conversation's tail will be picked up on the next
//     conversation's first turn via the §6 read of existing
//     knowledgeFact rows. Affect (emotion / affection) decay continues
//     to be a read-time concern in the assembler, not a write here.
//
// Op B (ST→LT consolidation) + Op C (LT-overflow compaction) are
// scheduled via cron in phase 2B/2C, NOT from this seam.

import { ActionCtx } from '../_generated/server';
import { Id } from '../_generated/dataModel';
import { GameId } from '../aiTown/ids';
import { SerializedPlayer } from '../aiTown/player';

// ──────────────────────────────────────────────────────────────────
// rememberConversation — v3.5 conversation-end hook.
// Op A owns per-turn extraction; this seam is currently a no-op
// (logged for observability). Future enhancement: dispatch a batched
// Op A call here for the conversation's final state. Best-effort:
// failure must not propagate (matches the 1D N4/S4 discipline).
// ──────────────────────────────────────────────────────────────────
export async function rememberConversation(
  _ctx: ActionCtx,
  _worldId: Id<'worlds'>,
  agentIdArg: GameId<'agents'>,
  playerIdArg: GameId<'players'>,
  conversationIdArg: GameId<'conversations'>,
): Promise<void> {
  // v3.5 phase 2A.1 stub: no-op until Op A's batched-final-turn dispatch
  // lands. Logged so operators can see the hook still fires on
  // conversation end (smoke-test signal that the engine path is alive).
  console.log(
    `[rememberConversation v3.5 stub] agent=${agentIdArg} player=${playerIdArg} conversation=${conversationIdArg}` +
      ` — Op A owns extraction per-turn; no consolidation work at conversation-end seam.`,
  );
}

// Backwards-compat re-export of SerializedPlayer (kept for any external import).
export type { SerializedPlayer };
