// Memory v3.5 — behavioral-test orchestrator: Convex action entry +
// Port binding.
//
// This module is a thin wrapper over the runner-agnostic state machine
// in `lifecycle.ts` plus the scoring layer in `scoring.ts`. Exposes
// two internalActions (B2 surface):
//
//   - `runScenario` — lifecycle + ONE judge call + scoring → scored
//     result. Default operator entry point.
//   - `judgeOnly` — single judge call on a fixed (rubric, reply) pair.
//     Used by the runner to amortize calibration's N judge calls
//     across separate Convex actions (a single action would exceed
//     ACTION_TIMEOUT=120s with N=5 serial Grok roundtrips —
//     Plan-Lens 2 BLOCKING #1).
//
// The Node-side runner `scripts/runBehaviorSuite.mjs` loads
// scenarios.yaml, invokes `runScenario` once per scenario, and for
// calibration mode invokes `judgeOnly` an additional (N-1) times
// against the same cached `npcReply.text`. The lifecycle runs ONCE
// per scenario in all modes — Plan-Lens 2 BLOCKING #2 contract.

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import type { Scenario, Rubric } from './parseScenarios';
import {
  Port,
  LifecycleOpts,
  LifecycleResult,
  ScenarioActors,
  MindStateSnapshot,
  runScenarioLifecycle,
} from './lifecycle';
import { judgeReply, JudgeResult } from './judge';
import {
  aggregateScenarioVerdict,
  ScenarioVerdict,
  computeSelfAgreement,
  buildCalibrationEntry,
  hashRubric,
  CalibrationEntry,
} from './scoring';

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

/** Combined result of one scored scenario run: the raw lifecycle
 *  artifacts + the single judge run + the aggregated verdict. The
 *  Node runner caches `lifecycleResult.npcReply.text` from this
 *  result and reuses it for any additional `judgeOnly` calls in
 *  calibration mode. */
export type ScoredScenarioResult = {
  lifecycleResult: LifecycleResult;
  judgeResult: JudgeResult | null;
  judgeError: string | null;
  verdict: ScenarioVerdict;
};

/** Run one behavioral scenario end-to-end against the default world,
 *  with judge + scoring applied.
 *
 *  Invocation (operator-facing):
 *    npx convex run behavior/orchestrator:runScenario '{"scenario": {...}}'
 *
 *  Pipeline: lifecycle → judge (1 call) → scoring → ScoredScenarioResult.
 *  For calibration mode (N>1 judge calls), the Node runner calls this
 *  ONCE per scenario then calls `judgeOnly` (N-1) more times against
 *  the cached `npcReply.text`.
 *
 *  Verdict aggregation order (scoring.aggregateScenarioVerdict):
 *  lifecycle-error → judge-error → rubric-fail → deterministic-fail →
 *  unverifiable-skipped → pass. The rubric channel beats unverifiable
 *  per Plan-Lens 1 BLOCKING #1 — this is the B06 honesty fix.
 */
export const runScenario = internalAction({
  args: {
    scenario: v.any(),
    opts: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<ScoredScenarioResult> => {
    const port = createConvexPort(ctx);
    const scenario = args.scenario as Scenario;
    const opts = (args.opts ?? {}) as LifecycleOpts;
    const lifecycleResult = await runScenarioLifecycle(port, scenario, opts);

    // Judge call — only attempt if lifecycle produced an NPC reply.
    let judgeResult: JudgeResult | null = null;
    let judgeError: Error | null = null;
    if (lifecycleResult.status === 'ok' && lifecycleResult.npcReply) {
      try {
        judgeResult = await judgeReply(scenario.rubric, lifecycleResult.npcReply.text);
      } catch (e) {
        judgeError = e instanceof Error ? e : new Error(String(e));
      }
    }

    const verdict = aggregateScenarioVerdict(scenario, lifecycleResult, judgeResult, judgeError);

    return {
      lifecycleResult,
      judgeResult,
      judgeError: judgeError ? judgeError.message : null,
      verdict,
    };
  },
});

/** Judge a fixed (rubric, replyText) pair without running the
 *  lifecycle. Used by the runner for calibration mode: after one
 *  `runScenario` call captures the NPC reply, additional `judgeOnly`
 *  calls re-judge the SAME reply to measure judge self-agreement
 *  (Plan-Lens 2 BLOCKING #2 contract — same reply, N judge runs).
 *
 *  Each call is its own Convex action so the per-action timeout
 *  (ACTION_TIMEOUT=120s) is not breached by serial N=5 judge calls. */
export const judgeOnly = internalAction({
  args: {
    rubric: v.any(),
    replyText: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ judgeResult: JudgeResult | null; judgeError: string | null }> => {
    try {
      const judgeResult = await judgeReply(args.rubric as Rubric, args.replyText);
      return { judgeResult, judgeError: null };
    } catch (e) {
      return { judgeResult: null, judgeError: e instanceof Error ? e.message : String(e) };
    }
  },
});

/** Compute a CalibrationEntry from a scenario + N judge runs + the
 *  latest verdict. Exposed as an action so the Node runner doesn't
 *  need to import scoring.ts (which Node can't load directly without
 *  a TypeScript loader). Pure-logic delegation; no LLM call. */
export const computeCalibrationFromRuns = internalAction({
  args: {
    scenario: v.any(),
    judgeRuns: v.any(), // JudgeResult[]
    verdict: v.any(), // ScenarioVerdict
    judgeModel: v.string(),
  },
  handler: async (ctx, args): Promise<CalibrationEntry> => {
    const judgeRuns = args.judgeRuns as JudgeResult[];
    const verdict = args.verdict as ScenarioVerdict;
    const scenario = args.scenario as Scenario;
    const selfAgreement = computeSelfAgreement(judgeRuns);
    const rubricHash = await hashRubric(scenario.rubric);
    return buildCalibrationEntry({
      selfAgreement,
      latestVerdict: verdict,
      judgeModel: args.judgeModel,
      rubricHash,
    });
  },
});

/** Compute the SHA-256 rubric hash for a given rubric. Exposed as an
 *  action so the Node runner can detect rubric drift against stored
 *  calibration entries without needing a TypeScript loader. */
export const computeRubricHash = internalAction({
  args: { rubric: v.any() },
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const hash = await hashRubric(args.rubric as Rubric);
    return { hash };
  },
});
