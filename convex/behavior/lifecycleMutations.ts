// Memory v3.5 — behavioral-test orchestrator: Convex primitives.
//
// Internal mutations + queries that the lifecycle Port calls into.
// Kept in a separate file from lifecycle.ts so the state machine stays
// runner-agnostic (no Convex imports).
//
// All functions here are scoped to the DEFAULT world (testing.ts
// pattern). The orchestrator never operates on a non-default world.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { insertInput } from '../aiTown/insertInput';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import { playerId as playerIdValidator, agentId as agentIdValidator } from '../aiTown/ids';
import { ENTITY_GENERAL } from '../agent/schema';

// ─────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────

async function getDefaultWorld(ctx: any) {
  const worldStatus = await ctx.db
    .query('worldStatus')
    .filter((q: any) => q.eq(q.field('isDefault'), true))
    .first();
  if (!worldStatus) throw new Error('No default world found');
  const world = await ctx.db.get(worldStatus.worldId);
  if (!world) throw new Error(`World ${worldStatus.worldId} not found`);
  const engine = await ctx.db.get(worldStatus.engineId);
  if (!engine) throw new Error(`Engine ${worldStatus.engineId} not found`);
  return { worldStatus, world, engine };
}

const TEST_PC_CHARACTER = 'f1';
const TEST_PC_DESCRIPTION = 'Dedicated test PC for the Memory v3.5 behavioral suite. Created idempotently.';

// ─────────────────────────────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────────────────────────────

/** Engine-running precondition (lens-2 IMPORTANT #7). */
export const getEngineStatusQuery = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { worldStatus, engine } = await getDefaultWorld(ctx);
    return {
      worldId: worldStatus.worldId as string,
      worldStatus: worldStatus.status as string,
      engineRunning: !!engine.running,
    };
  },
});

/** Find a player by name in the default world's playerDescriptions.
 *  Returns null if missing. Used for both NPC lookup and idempotent
 *  test-PC lookup (lens-2 IMPORTANT #5). */
export const findPlayerByNameQuery = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const { worldStatus, world } = await getDefaultWorld(ctx);
    const desc = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q: any) => q.eq('worldId', worldStatus.worldId))
      .filter((q: any) => q.eq(q.field('name'), args.name))
      .first();
    if (!desc) return null;
    // Confirm the player is still live in the world doc (not archived
    // mid-scenario).
    const player = (world.players as any[]).find((p) => p.id === desc.playerId);
    if (!player) return null;
    return { playerId: desc.playerId as string };
  },
});

/** Resolve the NPC's agentId given its playerId (scan world.agents). */
export const findAgentForPlayerQuery = internalQuery({
  args: { npcPlayerId: playerIdValidator },
  handler: async (ctx, args) => {
    const { world } = await getDefaultWorld(ctx);
    const agent = (world.agents as any[]).find((a) => a.playerId === args.npcPlayerId);
    if (!agent) return null;
    return { agentId: agent.id as string };
  },
});

/** Read an input row's returnValue. Used for polling 'join' /
 *  'startConversation' input completion. */
export const getInputResultQuery = internalQuery({
  args: { inputId: v.id('inputs') },
  handler: async (ctx, args) => {
    const input = await ctx.db.get(args.inputId);
    if (!input) return null;
    return input.returnValue ?? null;
  },
});

/** Read participants[].status for a specific conversation in the
 *  default world. Returns null if the conversation no longer exists. */
export const getConversationStateQuery = internalQuery({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const { world } = await getDefaultWorld(ctx);
    const conv = (world.conversations as any[]).find((c) => c.id === args.conversationId);
    if (!conv) return null;
    return {
      id: conv.id as string,
      numMessages: conv.numMessages as number,
      participants: (conv.participants as any[]).map((p) => ({
        playerId: p.playerId as string,
        status: p.status as
          | { kind: 'invited' }
          | { kind: 'walkingOver' }
          | { kind: 'participating'; started: number },
      })),
    };
  },
});

/** Find any conversation in the world that contains the given player.
 *  Used to detect "already in a conversation" state before bouncing. */
export const findConversationContainingPlayerQuery = internalQuery({
  args: { playerId: playerIdValidator },
  handler: async (ctx, args) => {
    const { world } = await getDefaultWorld(ctx);
    const conv = (world.conversations as any[]).find((c) =>
      (c.participants as any[]).some((p) => p.playerId === args.playerId),
    );
    if (!conv) return null;
    return { id: conv.id as string };
  },
});

/** Poll for an NPC-authored message in `conversationId` whose _id is
 *  strictly greater than `afterMessageId` (lens-1 IMPORTANT #5 fix —
 *  id-based, not creationTime-based, to avoid same-ms races).
 *  Returns the first matching message or null. */
export const findNpcReplyQuery = internalQuery({
  args: {
    conversationId: v.string(),
    npcPlayerId: playerIdValidator,
    afterMessageId: v.id('messages'),
  },
  handler: async (ctx, args) => {
    const { worldStatus } = await getDefaultWorld(ctx);
    const messages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q: any) =>
        q.eq('worldId', worldStatus.worldId).eq('conversationId', args.conversationId),
      )
      .collect();
    // Convex _id strings are monotone-allocated within a table, but
    // we don't rely on lexicographic compare — instead, find the
    // trigger message's index and take the first NPC-authored message
    // after it.
    const triggerIdx = messages.findIndex((m: any) => m._id === args.afterMessageId);
    if (triggerIdx < 0) return null;
    for (let i = triggerIdx + 1; i < messages.length; i++) {
      if (messages[i].author === args.npcPlayerId) {
        return {
          messageId: messages[i]._id as string,
          text: messages[i].text as string,
          creationTime: messages[i]._creationTime as number,
        };
      }
    }
    return null;
  },
});

/** Count Op A scheduled functions targeting `npcPlayerId`, split by
 *  state. Lifecycle uses `pending` + `inProgress` for quiescence
 *  polling (lens-2 IMPORTANT #6), and surfaces `failed` + `canceled`
 *  in the result so B2 deterministic scoring can route around
 *  scenarios where Op A crashed (B1-reviewer Lens-B IMPORTANT #3).
 *
 *  Returns: { pending, inProgress, failed, canceled, success }.
 *
 *  The `_scheduled_functions` system table includes EVERY scheduled
 *  function ever — including the engine's runStep self-rescheduling
 *  (~4/sec), which means on a moderately-used dev deployment this
 *  table holds tens of thousands of entries. A naive `.collect()`
 *  blew the action's 64 MB isolate limit (see B2 dev-trial 1). We
 *  page in chunks and stop early once we've scanned far enough back
 *  to be confident no pending Op A is older than the window. */
export const countOpAByStateQuery = internalQuery({
  args: { npcPlayerId: playerIdValidator },
  handler: async (ctx, args) => {
    const counts = { pending: 0, inProgress: 0, failed: 0, canceled: 0, success: 0 };
    // GROK_CALL_TIMEOUT_MS (constants.ts) = 30s, so any Op A older
    // than ~60s ago is definitively settled (success/failed/canceled).
    // We only need pending+inProgress, so look at the last 60s of
    // scheduled functions. Pad to 120s as safety.
    const sinceMs = Date.now() - 120_000;
    const cursor: any = null;
    let scanned = 0;
    const MAX_SCAN = 2000; // hard cap to prevent OOM under any pathology
    let q = ctx.db.system
      .query('_scheduled_functions')
      .withIndex('by_creation_time', (qb: any) => qb.gt('_creationTime', sinceMs))
      .order('desc');
    // paginate to bound per-page memory
    const PAGE_SIZE = 200;
    let nextCursor: string | null = cursor;
    let isDone = false;
    while (!isDone && scanned < MAX_SCAN) {
      const page = await q.paginate({ cursor: nextCursor, numItems: PAGE_SIZE });
      for (const fn of page.page) {
        scanned++;
        if (!String(fn.name).includes('opAExtract')) continue;
        const argsAny = fn.args as any;
        const owner = Array.isArray(argsAny) ? argsAny[0]?.ownerPlayerId : argsAny?.ownerPlayerId;
        if (owner !== args.npcPlayerId) continue;
        const k = fn.state.kind as keyof typeof counts;
        if (k in counts) counts[k]++;
      }
      isDone = page.isDone;
      nextCursor = page.continueCursor;
    }
    return counts;
  },
});

/** Read the (NPC, PC) mindState row. Returns null if no row exists. */
export const readMindStateQuery = internalQuery({
  args: {
    npcPlayerId: playerIdValidator,
    pcPlayerId: playerIdValidator,
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('mindState')
      .withIndex('owner_target', (q: any) =>
        q.eq('ownerPlayerId', args.npcPlayerId).eq('targetPlayerId', args.pcPlayerId),
      )
      .first();
    if (!row) return null;
    return {
      emotionLabel: row.emotion?.label ?? null,
      emotionValue: row.emotion?.value ?? null,
      affectionValue: row.affection?.value ?? null,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────
// MUTATIONS
// ─────────────────────────────────────────────────────────────────────

/** Idempotent test-PC creation. If a player named `pcName` already
 *  exists, returns its playerId immediately. Otherwise dispatches a
 *  `join` input and returns the inputId for the caller to poll. */
export const ensureTestPCMutation = internalMutation({
  args: { pcName: v.string() },
  handler: async (ctx, args): Promise<{ playerId: string } | { inputId: Id<'inputs'> }> => {
    const { worldStatus, world } = await getDefaultWorld(ctx);
    const existing = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q: any) => q.eq('worldId', worldStatus.worldId))
      .filter((q: any) => q.eq(q.field('name'), args.pcName))
      .first();
    if (existing) {
      // Confirm live in world doc (defensive — if archived, the
      // caller should treat this as a missing PC and re-create).
      const live = (world.players as any[]).find((p) => p.id === existing.playerId);
      if (live) return { playerId: existing.playerId as string };
    }
    const inputId = await insertInput(ctx, worldStatus.worldId, 'join', {
      name: args.pcName,
      character: TEST_PC_CHARACTER,
      description: TEST_PC_DESCRIPTION,
    });
    return { inputId };
  },
});

/** Wipe (NPC, PC) state for a fresh scenario. Idempotent.
 *
 *  Deletes:
 *  - knowledgeFact rows where ownerPlayerId=NPC AND entity ∈ {PC, __general__}
 *  - mindState row (NPC, PC)
 *  - messages rows for any (NPC, PC) conversation currently in the world
 *
 *  Does NOT close conversations — that's handled separately via
 *  `leaveConversationsMutation` so the engine-input race (lens-2 B1)
 *  can be sequenced explicitly by the orchestrator. */
export const resetScenarioStateMutation = internalMutation({
  args: {
    npcPlayerId: playerIdValidator,
    pcPlayerId: playerIdValidator,
  },
  handler: async (ctx, args) => {
    const { worldStatus, world } = await getDefaultWorld(ctx);

    // 1. knowledgeFact: (owner=NPC, entity ∈ {PC, __general__}).
    // Use owner_tier_entity index per tier × per entity scope.
    for (const tier of ['ST', 'LT'] as const) {
      for (const entity of [args.pcPlayerId, ENTITY_GENERAL] as const) {
        const rows = await ctx.db
          .query('knowledgeFact')
          .withIndex('owner_tier_entity', (q: any) =>
            q.eq('ownerPlayerId', args.npcPlayerId).eq('tier', tier).eq('entity', entity),
          )
          .collect();
        for (const row of rows) {
          await ctx.db.delete(row._id);
        }
      }
    }

    // 2. mindState (NPC, PC).
    const mind = await ctx.db
      .query('mindState')
      .withIndex('owner_target', (q: any) =>
        q.eq('ownerPlayerId', args.npcPlayerId).eq('targetPlayerId', args.pcPlayerId),
      )
      .first();
    if (mind) await ctx.db.delete(mind._id);

    // 3. messages for any (NPC, PC) live conversation.
    const conv = (world.conversations as any[]).find(
      (c) =>
        (c.participants as any[]).some((p) => p.playerId === args.npcPlayerId) &&
        (c.participants as any[]).some((p) => p.playerId === args.pcPlayerId),
    );
    if (conv) {
      const msgs = await ctx.db
        .query('messages')
        .withIndex('conversationId', (q: any) =>
          q.eq('worldId', worldStatus.worldId).eq('conversationId', conv.id),
        )
        .collect();
      for (const m of msgs) {
        await ctx.db.delete(m._id);
      }
    }
  },
});

/** If either player is currently in a conversation, dispatch
 *  `leaveConversation` for them. Returns the count of leave inputs
 *  dispatched. Lifecycle polls until conversations clear. */
export const leaveConversationsMutation = internalMutation({
  args: {
    npcPlayerId: playerIdValidator,
    pcPlayerId: playerIdValidator,
  },
  handler: async (ctx, args) => {
    const { worldStatus, world } = await getDefaultWorld(ctx);
    let count = 0;
    for (const pid of [args.npcPlayerId, args.pcPlayerId]) {
      const conv = (world.conversations as any[]).find((c) =>
        (c.participants as any[]).some((p) => p.playerId === pid),
      );
      if (conv) {
        await insertInput(ctx, worldStatus.worldId, 'leaveConversation', {
          playerId: pid,
          conversationId: conv.id,
        });
        count++;
      }
    }
    return { dispatched: count };
  },
});

/** Dispatch startConversation input for (NPC, PC). Returns the inputId
 *  for the caller to poll for the resulting conversationId. */
export const startConversationMutation = internalMutation({
  args: {
    npcPlayerId: playerIdValidator,
    pcPlayerId: playerIdValidator,
  },
  handler: async (ctx, args) => {
    const { worldStatus } = await getDefaultWorld(ctx);
    // Per Conversation.start (convex/aiTown/conversation.ts:147), the
    // FIRST playerId is the inviter (walkingOver) and the SECOND is
    // the invitee (invited). Putting the PC first makes the test PC
    // initiate, matching the "PC walks up to NPC" production frame.
    const inputId = await insertInput(ctx, worldStatus.worldId, 'startConversation', {
      playerId: args.pcPlayerId,
      invitee: args.npcPlayerId,
    });
    return { inputId };
  },
});

/** Test backdoor: directly patch the world doc so both participants
 *  of `conversationId` are in `participating` status. Bypasses BOTH
 *  the walk-over flow AND the 0.8 INVITE_ACCEPT_PROBABILITY gate
 *  (constants.ts:36) so the orchestrator's establishment step is
 *  deterministic. This is intentionally a localized test backdoor —
 *  the production walk-over + accept-probability path is not what
 *  the behavioral suite is testing, the message-response behavior
 *  GIVEN a conversation is.
 *
 *  Also (B2.2): clears `lastConversation`/`lastInviteAttempt` for any
 *  test-NPC agent in this conversation so CONVERSATION_COOLDOWN +
 *  MESSAGE_COOLDOWN don't block back-to-back scenarios. Without this,
 *  the second scenario after a successful first one consistently
 *  hit npc-reply-timeout because the NPC's agent loop was still in
 *  cooldown from the prior conversation. */
export const forceParticipatingMutation = internalMutation({
  args: { conversationId: v.string() },
  handler: async (ctx, args) => {
    const { world } = await getDefaultWorld(ctx);
    const now = Date.now();
    const conversations = (world.conversations as any[]).map((c: any) => {
      if (c.id !== args.conversationId) return c;
      const participants = (c.participants as any[]).map((p: any) => ({
        ...p,
        status: { kind: 'participating', started: now },
      }));
      const patched: any = { ...c, participants, numMessages: 0 };
      delete patched.lastMessage;
      delete patched.isTyping;
      return patched;
    });
    // Clear all stale-state gates for any agent that's a participant
    // in this conversation. Without these clears, the agent.tick logic
    // (convex/aiTown/agent.ts:90+) silently blocks the agent from
    // responding to the trigger message:
    //   - inProgressOperation: if set (e.g., from a killed prior run
    //     mid-operation), agent does NOTHING until ACTION_TIMEOUT
    //     auto-clears (line 95). Our test 90s budget runs out first.
    //   - toRemember: if set (from a prior conversation needing
    //     memory consolidation), agent fires agentRememberConversation
    //     INSTEAD of responding to the trigger (line 132).
    //   - lastConversation / lastInviteAttempt: CONVERSATION_COOLDOWN
    //     gates back-to-back scenarios.
    // forceParticipating is the localized test backdoor; these clears
    // are part of that contract.
    const conv = (conversations as any[]).find((c: any) => c.id === args.conversationId);
    const participantIds = new Set<string>(
      conv ? (conv.participants as any[]).map((p: any) => p.playerId) : [],
    );
    const agents = (world.agents as any[]).map((a: any) => {
      if (!participantIds.has(a.playerId)) return a;
      const patched: any = { ...a };
      delete patched.lastConversation;
      delete patched.lastInviteAttempt;
      delete patched.inProgressOperation;
      delete patched.toRemember;
      return patched;
    });
    await ctx.db.patch(world._id, { conversations, agents });
  },
});

/** Apply scenario setup hooks:
 *  - knowledgeFactSeeds → direct insert with source='op-a' (so they
 *    look like normal Op-A-extracted facts to the renderer).
 *  - mindStateInit → direct insert/patch.
 *  - priorMessages → direct insert into messages table (B1 limitation:
 *    does NOT update conversation.lastMessage / numMessages; Op A reads
 *    messages directly via conversationId, so visibility for §6
 *    rendering is preserved. Engine-side state may be stale; revisit
 *    in B2 if a scenario needs the consistency).
 */
export const applySetupHooksMutation = internalMutation({
  args: {
    npcPlayerId: playerIdValidator,
    npcAgentId: agentIdValidator,
    pcPlayerId: playerIdValidator,
    conversationId: v.string(),
    setup: v.optional(
      v.object({
        seedInstincts: v.optional(v.array(v.string())),
        knowledgeFactSeeds: v.optional(
          v.array(
            v.object({
              factText: v.string(),
              entity: v.union(v.literal('__general__'), v.literal('PC')),
              tier: v.union(v.literal('ST'), v.literal('LT')),
              importance: v.optional(v.number()),
            }),
          ),
        ),
        priorMessages: v.optional(
          v.array(
            v.object({
              speaker: v.union(v.literal('PC'), v.literal('NPC')),
              text: v.string(),
            }),
          ),
        ),
        mindStateInit: v.optional(
          v.object({
            affectionValue: v.optional(v.number()),
            emotionLabel: v.optional(v.string()),
            emotionValue: v.optional(v.number()),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (!args.setup) return;
    const { worldStatus } = await getDefaultWorld(ctx);
    const now = Date.now();

    // knowledgeFactSeeds
    if (args.setup.knowledgeFactSeeds) {
      for (const seed of args.setup.knowledgeFactSeeds) {
        const entity = seed.entity === 'PC' ? args.pcPlayerId : ENTITY_GENERAL;
        await ctx.db.insert('knowledgeFact', {
          ownerPlayerId: args.npcPlayerId,
          ownerAgentId: args.npcAgentId,
          tier: seed.tier,
          entity,
          factText: seed.factText,
          history: [],
          frequency: 1,
          createdAt: now,
          lastUpdatedAt: now,
          importance: seed.importance ?? 3,
          pinned: false,
          source: 'op-a',
          keywords: [],
        });
      }
    }

    // priorMessages — direct insert (B1 limitation noted in docstring).
    if (args.setup.priorMessages) {
      let i = 0;
      for (const msg of args.setup.priorMessages) {
        const author = msg.speaker === 'PC' ? args.pcPlayerId : args.npcPlayerId;
        await ctx.db.insert('messages', {
          conversationId: args.conversationId,
          author,
          messageUuid: `behavior-seed-${args.conversationId}-${i}`,
          text: msg.text,
          worldId: worldStatus.worldId,
        });
        i++;
      }
    }

    // mindStateInit
    if (args.setup.mindStateInit) {
      const init = args.setup.mindStateInit;
      const existing = await ctx.db
        .query('mindState')
        .withIndex('owner_target', (q: any) =>
          q.eq('ownerPlayerId', args.npcPlayerId).eq('targetPlayerId', args.pcPlayerId),
        )
        .first();
      const affectBase = (label: string, value: number) => ({
        label,
        value,
        baseline: 0,
        lastSetMs: now,
        halfLifeMs: 60_000,
      });
      const patch: any = {};
      if (init.affectionValue !== undefined) {
        patch.affection = affectBase('好感', init.affectionValue);
      }
      if (init.emotionLabel !== undefined || init.emotionValue !== undefined) {
        patch.emotion = affectBase(init.emotionLabel ?? '平静', init.emotionValue ?? 0);
      }
      if (existing) {
        await ctx.db.patch(existing._id, patch);
      } else if (Object.keys(patch).length > 0) {
        await ctx.db.insert('mindState', {
          ownerPlayerId: args.npcPlayerId,
          ownerAgentId: args.npcAgentId,
          targetPlayerId: args.pcPlayerId,
          ...patch,
        });
      }
    }
  },
});

/** Write the scenario's PC trigger message. Mirrors messages.writeMessage's
 *  contract (insert + finishSendingMessage input + Op A schedule) so the
 *  NPC's agent loop reacts as it would in production. */
export const writeTriggerMessageMutation = internalMutation({
  args: {
    pcPlayerId: playerIdValidator,
    conversationId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const { worldStatus } = await getDefaultWorld(ctx);
    const messageId = await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      author: args.pcPlayerId,
      messageUuid: `behavior-trigger-${args.conversationId}-${Date.now()}`,
      text: args.text,
      worldId: worldStatus.worldId,
    });
    await insertInput(ctx, worldStatus.worldId, 'finishSendingMessage', {
      conversationId: args.conversationId,
      playerId: args.pcPlayerId,
      timestamp: Date.now(),
    });
    // Schedule Op A for the NPC (mirror of messages.ts:scheduleOpAForNpcs).
    const worldDoc: any = await ctx.db.get(worldStatus.worldId);
    if (worldDoc) {
      const conv = (worldDoc.conversations as any[]).find((c: any) => c.id === args.conversationId);
      if (conv) {
        for (const participant of conv.participants as any[]) {
          if (participant.playerId === args.pcPlayerId) continue;
          const agent = (worldDoc.agents as any[]).find((a: any) => a.playerId === participant.playerId);
          if (!agent) continue;
          await ctx.scheduler.runAfter(0, internal.agent.opA.opAExtract, {
            worldId: worldStatus.worldId,
            ownerPlayerId: agent.playerId,
            ownerAgentId: agent.id,
            otherPlayerId: args.pcPlayerId,
            conversationId: args.conversationId,
            messageId,
          });
        }
      }
    }
    return { messageId: messageId as string, writeTimestampMs: Date.now() };
  },
});
