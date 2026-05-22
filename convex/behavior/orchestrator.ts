// Memory v3.5 — behavioral-test orchestrator: Convex action entry +
// Port binding.
//
// This module is a thin wrapper over the runner-agnostic state machine
// in `lifecycle.ts`. It exposes ONE internalAction
// (`runScenarioLifecycle`) that takes a single scenario object as args
// and drives the full lifecycle, returning the raw artifacts as JSON.
//
// The Node-side runner `scripts/runBehaviorSuite.mjs` is responsible
// for loading scenarios.yaml and invoking this action per scenario
// (via `npx convex run`). Keeping the YAML out of the Convex runtime
// means no filesystem dependency and no schema-generation step.
//
// Scoring + judge integration are deferred to B2 — this action returns
// raw artifacts only.

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import type { Scenario } from './parseScenarios';
import {
  Port,
  LifecycleOpts,
  LifecycleResult,
  ScenarioActors,
  MindStateSnapshot,
  runScenarioLifecycle,
} from './lifecycle';

// ─────────────────────────────────────────────────────────────────────
// Convex-backed Port
// ─────────────────────────────────────────────────────────────────────

/** Build a Port wired to a Convex action context. All side-effects
 *  delegate to internal mutations / queries in lifecycleMutations.ts. */
export function createConvexPort(ctx: any): Port {
  return {
    async getEngineRunning() {
      const status = await ctx.runQuery(internal.behavior.lifecycleMutations.getEngineStatusQuery, {});
      return !!status.engineRunning;
    },

    async ensureActors(opts) {
      // NPC must exist (fixture).
      const npc = await ctx.runQuery(internal.behavior.lifecycleMutations.findPlayerByNameQuery, {
        name: opts.npcName,
      });
      if (!npc) {
        throw new Error(
          `NPC fixture '${opts.npcName}' not found in playerDescriptions. Seed the default world before running the suite.`,
        );
      }
      const agentRes = await ctx.runQuery(
        internal.behavior.lifecycleMutations.findAgentForPlayerQuery,
        { npcPlayerId: npc.playerId },
      );
      if (!agentRes) {
        throw new Error(`No agent found for NPC playerId ${npc.playerId} in world.agents`);
      }

      // PC: idempotent ensure.
      const ensureResult = await ctx.runMutation(
        internal.behavior.lifecycleMutations.ensureTestPCMutation,
        { pcName: opts.pcName },
      );
      let pcPlayerId: string;
      if ('playerId' in ensureResult) {
        pcPlayerId = ensureResult.playerId;
      } else {
        // Poll for join input completion + playerDescription presence.
        const deadline = Date.now() + opts.pcCreateTimeoutMs;
        let resolved: string | null = null;
        while (Date.now() < deadline) {
          const inputRes = await ctx.runQuery(
            internal.behavior.lifecycleMutations.getInputResultQuery,
            { inputId: ensureResult.inputId as Id<'inputs'> },
          );
          if (inputRes) {
            if (inputRes.kind === 'error') {
              throw new Error(`Test PC join input failed: ${inputRes.message}`);
            }
            // Input processed; look up the playerId by name.
            const found = await ctx.runQuery(
              internal.behavior.lifecycleMutations.findPlayerByNameQuery,
              { name: opts.pcName },
            );
            if (found) {
              resolved = found.playerId;
              break;
            }
          }
          await sleep(500);
        }
        if (!resolved) {
          throw new Error(
            `Test PC '${opts.pcName}' did not appear within ${opts.pcCreateTimeoutMs}ms after join input dispatched`,
          );
        }
        pcPlayerId = resolved;
      }

      return {
        npcPlayerId: npc.playerId,
        npcAgentId: agentRes.agentId,
        pcPlayerId,
      };
    },

    async resetScenarioState(actors) {
      // Leave any prior conversations FIRST (engine processes the
      // leave on the next tick) — the message wipe happens regardless,
      // but freshly clearing live conversations avoids the
      // forceParticipating step trampling existing membership.
      await ctx.runMutation(internal.behavior.lifecycleMutations.leaveConversationsMutation, {
        npcPlayerId: actors.npcPlayerId,
        pcPlayerId: actors.pcPlayerId,
      });
      // Brief settle for engine to process the leave input.
      await sleep(1500);
      await ctx.runMutation(internal.behavior.lifecycleMutations.resetScenarioStateMutation, {
        npcPlayerId: actors.npcPlayerId,
        pcPlayerId: actors.pcPlayerId,
      });
    },

    async waitForOpAQuiescence(opts) {
      const deadline = Date.now() + opts.timeoutMs;
      let last = { pending: 0, inProgress: 0, failed: 0, canceled: 0, success: 0 };
      while (Date.now() < deadline) {
        last = await ctx.runQuery(
          internal.behavior.lifecycleMutations.countOpAByStateQuery,
          { npcPlayerId: opts.npcPlayerId },
        );
        if (last.pending === 0 && last.inProgress === 0) {
          return { quiesced: true, failed: last.failed, canceled: last.canceled };
        }
        await sleep(opts.pollIntervalMs);
      }
      return { quiesced: false, failed: last.failed, canceled: last.canceled };
    },

    async establishConversation(opts) {
      // 1. startConversation input — PC is inviter (walkingOver),
      //    NPC is invitee (invited).
      const startRes = await ctx.runMutation(
        internal.behavior.lifecycleMutations.startConversationMutation,
        { npcPlayerId: opts.actors.npcPlayerId, pcPlayerId: opts.actors.pcPlayerId },
      );
      // 2. Poll for input completion → conversationId.
      const deadline = Date.now() + opts.timeoutMs;
      let conversationId: string | null = null;
      while (Date.now() < deadline) {
        const inputRes = await ctx.runQuery(
          internal.behavior.lifecycleMutations.getInputResultQuery,
          { inputId: startRes.inputId as Id<'inputs'> },
        );
        if (inputRes) {
          if (inputRes.kind === 'error') {
            throw new Error(`startConversation input failed: ${inputRes.message}`);
          }
          conversationId = String(inputRes.value);
          break;
        }
        await sleep(opts.pollIntervalMs);
      }
      if (!conversationId) {
        throw new Error(`startConversation input did not complete within ${opts.timeoutMs}ms`);
      }
      // 3. Force both participants to `participating` via the test
      //    backdoor (bypasses walk-over + INVITE_ACCEPT_PROBABILITY).
      await ctx.runMutation(internal.behavior.lifecycleMutations.forceParticipatingMutation, {
        conversationId,
      });
      // 4. Verify state landed (one query — should be instant since we
      //    just patched in the same action chain).
      const state = await ctx.runQuery(
        internal.behavior.lifecycleMutations.getConversationStateQuery,
        { conversationId },
      );
      if (!state) {
        throw new Error(`Conversation ${conversationId} vanished after forceParticipating`);
      }
      const allParticipating = state.participants.every((p: any) => p.status.kind === 'participating');
      if (!allParticipating) {
        throw new Error(
          `Conversation ${conversationId} participants not all participating after forceParticipating: ${JSON.stringify(state.participants)}`,
        );
      }
      return conversationId;
    },

    async applySetupHooks(opts) {
      // applySetupHooksMutation requires the npcAgentId — fetch it
      // (cached via actors but the mutation needs it in args directly).
      const agentRes = await ctx.runQuery(
        internal.behavior.lifecycleMutations.findAgentForPlayerQuery,
        { npcPlayerId: opts.actors.npcPlayerId },
      );
      if (!agentRes) throw new Error(`Agent missing for NPC ${opts.actors.npcPlayerId} during setup`);
      await ctx.runMutation(internal.behavior.lifecycleMutations.applySetupHooksMutation, {
        npcPlayerId: opts.actors.npcPlayerId,
        npcAgentId: agentRes.agentId,
        pcPlayerId: opts.actors.pcPlayerId,
        conversationId: opts.conversationId,
        setup: opts.setup,
      });
    },

    async readMindStateSnapshot(actors): Promise<MindStateSnapshot> {
      const row = await ctx.runQuery(internal.behavior.lifecycleMutations.readMindStateQuery, {
        npcPlayerId: actors.npcPlayerId,
        pcPlayerId: actors.pcPlayerId,
      });
      return row;
    },

    async writeTriggerMessage(opts) {
      const res = await ctx.runMutation(
        internal.behavior.lifecycleMutations.writeTriggerMessageMutation,
        {
          pcPlayerId: opts.actors.pcPlayerId,
          conversationId: opts.conversationId,
          text: opts.inputText,
        },
      );
      return { messageId: res.messageId, writeTimestampMs: res.writeTimestampMs };
    },

    async pollForNpcReply(opts) {
      const deadline = Date.now() + opts.timeoutMs;
      while (Date.now() < deadline) {
        const reply = await ctx.runQuery(
          internal.behavior.lifecycleMutations.findNpcReplyQuery,
          {
            conversationId: opts.conversationId,
            npcPlayerId: opts.actors.npcPlayerId,
            afterMessageId: opts.afterMessageId as Id<'messages'>,
          },
        );
        if (reply) return reply;
        await sleep(opts.pollIntervalMs);
      }
      return null;
    },

    async sleep(ms) {
      await sleep(ms);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────
// Entry-point action
// ─────────────────────────────────────────────────────────────────────

/** Run one behavioral scenario end-to-end against the default world.
 *
 *  Invocation (operator-facing):
 *    npx convex run behavior/orchestrator:runScenario '{"scenario": {...}}'
 *
 *  The scripts/runBehaviorSuite.mjs Node helper loads scenarios.yaml,
 *  iterates, and calls this action per scenario.
 *
 *  Returns a `LifecycleResult` JSON. status='ok' means lifecycle ran
 *  cleanly + raw artifacts captured; status='error' means a specific
 *  step failed (see error.step). B2 will consume these artifacts to
 *  produce pass/fail verdicts via the judge + deterministic checks.
 */
export const runScenario = internalAction({
  args: {
    scenario: v.any(),
    opts: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<LifecycleResult> => {
    const port = createConvexPort(ctx);
    const scenario = args.scenario as Scenario;
    const opts = (args.opts ?? {}) as LifecycleOpts;
    return await runScenarioLifecycle(port, scenario, opts);
  },
});
