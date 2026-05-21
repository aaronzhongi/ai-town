import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { insertInput } from './aiTown/insertInput';
import { conversationId, playerId } from './aiTown/ids';
import { internal } from './_generated/api';
import { Id } from './_generated/dataModel';

export const listMessages = query({
  args: {
    worldId: v.id('worlds'),
    conversationId,
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) => q.eq('worldId', args.worldId).eq('conversationId', args.conversationId))
      .collect();
    const out = [];
    for (const message of messages) {
      const playerDescription = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', message.author))
        .first();
      if (!playerDescription) {
        throw new Error(`Invalid author ID: ${message.author}`);
      }
      out.push({ ...message, authorName: playerDescription.name });
    }
    return out;
  },
});

export const writeMessage = mutation({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    messageUuid: v.string(),
    playerId,
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      author: args.playerId,
      messageUuid: args.messageUuid,
      text: args.text,
      worldId: args.worldId,
    });
    await insertInput(ctx, args.worldId, 'finishSendingMessage', {
      conversationId: args.conversationId,
      playerId: args.playerId,
      timestamp: Date.now(),
    });
    // v3.5 — Op A trigger seam (PC side): schedule per-turn fact
    // extraction for each NPC participant in this conversation so
    // they observe the PC's just-spoken turn. Fire-and-forget; Op A
    // runs after this mutation commits.
    await scheduleOpAForNpcs(ctx, args.worldId, args.conversationId, args.playerId, messageId);
  },
});

/**
 * v3.5 Op A trigger-seam helper (Memory plan §5.1 trigger table).
 * Enumerate NPCs participating in `conversationId` whose playerId is
 * NOT the just-spoken player; schedule one `opAExtract` per such NPC
 * with the (messageId, otherPlayerId=speaker) pair. Single-NPC trial:
 * fires exactly once per PC turn (the NPC observes). For 2+ NPCs in a
 * conversation it fires once per non-speaker NPC.
 */
async function scheduleOpAForNpcs(
  ctx: any,
  worldId: Id<'worlds'>,
  conversationIdArg: string,
  speakerPlayerId: string,
  messageId: Id<'messages'>,
) {
  const world = await ctx.db.get(worldId);
  if (!world) return;
  const conv = world.conversations.find((c: any) => c.id === conversationIdArg);
  if (!conv) return;
  const npcAgentByPlayerId = new Map<string, { id: string; playerId: string }>();
  for (const agent of world.agents) {
    npcAgentByPlayerId.set(agent.playerId, { id: agent.id, playerId: agent.playerId });
  }
  for (const participant of conv.participants) {
    if (participant.playerId === speakerPlayerId) continue;
    const agent = npcAgentByPlayerId.get(participant.playerId);
    if (!agent) continue; // PC participant — no Op A on the PC side
    await ctx.scheduler.runAfter(0, internal.agent.opA.opAExtract, {
      worldId,
      ownerPlayerId: agent.playerId,
      ownerAgentId: agent.id,
      otherPlayerId: speakerPlayerId,
      conversationId: conversationIdArg,
      messageId,
    });
  }
}
