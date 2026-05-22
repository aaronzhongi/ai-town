// Memory v3.5 — meta-test for the behavioral lifecycle state machine.
//
// Per lens-3 IMPORTANT #4 ("no meta-test for the orchestrator
// itself"): the lifecycle is going to become load-bearing for the
// methodology gate ("suite replaces user trials"). Without a test
// harness, it can silently regress. This file exercises the pure
// state machine in `lifecycle.ts` against a mock `Port` and asserts:
//
//   - happy path produces an `ok` result with raw artifacts populated
//   - each per-step failure mode produces an `error` result with the
//     correct `error.step` tag (no silent pass-through)
//   - reset-then-quiescence path runs in the expected order
//   - setup hooks are skipped when scenario.setup is absent
//   - NPC reply timeout produces a clean error (not an exception)
//
// All Convex types are abstracted away by the Port interface; this
// file imports nothing from Convex.

import {
  Port,
  ScenarioActors,
  MindStateSnapshot,
  runScenarioLifecycle,
  stripPcPrefix,
} from './lifecycle';
import type { Scenario } from './parseScenarios';

// ─────────────────────────────────────────────────────────────────────
// Mock port factory
// ─────────────────────────────────────────────────────────────────────

type CallLog = string[];

type MockOverrides = Partial<{
  engineRunning: boolean;
  ensureActorsThrows: string;
  resetThrows: string;
  opAQuiescenceReturns: boolean;
  opAFailedPerCall: number;
  opACanceledPerCall: number;
  establishThrows: string;
  setupThrows: string;
  triggerThrows: string;
  npcReplyReturns: { messageId: string; text: string; creationTime: number } | null;
  preMindState: MindStateSnapshot;
  postMindState: MindStateSnapshot;
  readMindStateThrows: string;
}>;

function makeMockPort(overrides: MockOverrides = {}, callLog: CallLog = []): Port {
  const actors: ScenarioActors = {
    npcPlayerId: 'p:npc',
    npcAgentId: 'a:1',
    pcPlayerId: 'p:pc',
  };
  return {
    async getEngineRunning() {
      callLog.push('getEngineRunning');
      return overrides.engineRunning ?? true;
    },
    async ensureActors() {
      callLog.push('ensureActors');
      if (overrides.ensureActorsThrows) throw new Error(overrides.ensureActorsThrows);
      return actors;
    },
    async resetScenarioState() {
      callLog.push('resetScenarioState');
      if (overrides.resetThrows) throw new Error(overrides.resetThrows);
    },
    async waitForOpAQuiescence() {
      callLog.push('waitForOpAQuiescence');
      return {
        quiesced: overrides.opAQuiescenceReturns ?? true,
        failed: overrides.opAFailedPerCall ?? 0,
        canceled: overrides.opACanceledPerCall ?? 0,
      };
    },
    async establishConversation() {
      callLog.push('establishConversation');
      if (overrides.establishThrows) throw new Error(overrides.establishThrows);
      return 'c:1';
    },
    async applySetupHooks() {
      callLog.push('applySetupHooks');
      if (overrides.setupThrows) throw new Error(overrides.setupThrows);
    },
    async readMindStateSnapshot() {
      callLog.push('readMindStateSnapshot');
      if (overrides.readMindStateThrows) throw new Error(overrides.readMindStateThrows);
      // First call returns pre, second returns post (lifecycle reads
      // it twice — once before trigger, once after reply).
      const calls = callLog.filter((c) => c === 'readMindStateSnapshot').length;
      return calls === 1 ? (overrides.preMindState ?? null) : (overrides.postMindState ?? null);
    },
    async writeTriggerMessage() {
      callLog.push('writeTriggerMessage');
      if (overrides.triggerThrows) throw new Error(overrides.triggerThrows);
      return { messageId: 'm:trigger', writeTimestampMs: Date.now() };
    },
    async pollForNpcReply() {
      callLog.push('pollForNpcReply');
      return overrides.npcReplyReturns === undefined
        ? { messageId: 'm:reply', text: '你好', creationTime: Date.now() }
        : overrides.npcReplyReturns;
    },
    async sleep() {
      // No-op in tests.
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

const baseScenario: Scenario = {
  id: 'T01',
  category: 'privacy',
  context: 'test',
  input: 'PC: hello',
  rubric: { must: ['x'] },
};

const scenarioWithSetup: Scenario = {
  ...baseScenario,
  id: 'T02',
  setup: {
    knowledgeFactSeeds: [
      { factText: 'prior fact', entity: '__general__', tier: 'LT', importance: 3 },
    ],
  },
};

// Use tiny timeouts so tests don't actually wait. The mock port
// returns instantly anyway, but lifecycle still respects the budget.
const FAST_OPTS = {
  actorTimeoutMs: 100,
  opAQuiescenceTimeoutMs: 100,
  conversationTimeoutMs: 100,
  npcReplyTimeoutMs: 100,
  pollIntervalMs: 10,
};

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('stripPcPrefix', () => {
  test('strips "PC: " prefix', () => {
    expect(stripPcPrefix('PC: 你好')).toBe('你好');
    expect(stripPcPrefix('PC:   你好')).toBe('你好');
  });
  test('no-op when no prefix', () => {
    expect(stripPcPrefix('你好')).toBe('你好');
  });
});

describe('runScenarioLifecycle — happy path', () => {
  test('produces ok result with all artifacts populated', async () => {
    const log: CallLog = [];
    const port = makeMockPort(
      {
        preMindState: { emotionLabel: '平静', emotionValue: 0, affectionValue: 0 },
        postMindState: { emotionLabel: '谨慎', emotionValue: 0.3, affectionValue: 0.1 },
      },
      log,
    );
    const result = await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    expect(result.status).toBe('ok');
    expect(result.scenarioId).toBe('T01');
    expect(result.conversationId).toBe('c:1');
    expect(result.npcReply?.text).toBe('你好');
    expect(result.preMindState?.emotionLabel).toBe('平静');
    expect(result.postMindState?.affectionValue).toBe(0.1);
    expect(result.error).toBeUndefined();
  });

  test('runs lifecycle steps in the expected order', async () => {
    const log: CallLog = [];
    const port = makeMockPort({}, log);
    await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    // Engine precondition → actor resolution → reset → quiesce →
    // establish → (no setup on baseScenario) → read pre → trigger →
    // poll → quiesce (post-reply) → read post.
    expect(log).toEqual([
      'getEngineRunning',
      'ensureActors',
      'resetScenarioState',
      'waitForOpAQuiescence',
      'establishConversation',
      'readMindStateSnapshot', // pre
      'writeTriggerMessage',
      'pollForNpcReply',
      'waitForOpAQuiescence', // post-reply settle
      'readMindStateSnapshot', // post
    ]);
  });

  test('applySetupHooks is called when scenario.setup is present', async () => {
    const log: CallLog = [];
    const port = makeMockPort({}, log);
    await runScenarioLifecycle(port, scenarioWithSetup, FAST_OPTS);
    expect(log).toContain('applySetupHooks');
    // applySetupHooks should fire AFTER establish but BEFORE pre-snapshot.
    const establishIdx = log.indexOf('establishConversation');
    const setupIdx = log.indexOf('applySetupHooks');
    const preReadIdx = log.indexOf('readMindStateSnapshot');
    expect(establishIdx).toBeLessThan(setupIdx);
    expect(setupIdx).toBeLessThan(preReadIdx);
  });

  test('applySetupHooks is skipped when scenario.setup is absent', async () => {
    const log: CallLog = [];
    const port = makeMockPort({}, log);
    await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    expect(log).not.toContain('applySetupHooks');
  });
});

describe('runScenarioLifecycle — per-step failure modes', () => {
  test('engine-not-running short-circuits before any other step', async () => {
    const log: CallLog = [];
    const port = makeMockPort({ engineRunning: false }, log);
    const result = await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    expect(result.status).toBe('error');
    expect(result.error?.step).toBe('engine-not-running');
    expect(log).toEqual(['getEngineRunning']);
  });

  test('engine-precondition throw is reported as engine-not-running', async () => {
    const port: Port = {
      ...makeMockPort(),
      async getEngineRunning() {
        throw new Error('connection lost');
      },
    };
    const result = await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    expect(result.status).toBe('error');
    expect(result.error?.step).toBe('engine-not-running');
    expect(result.error?.message).toContain('connection lost');
  });

  test('actor-resolution failure produces correct error.step', async () => {
    const port = makeMockPort({ ensureActorsThrows: 'NPC missing' });
    const result = await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    expect(result.error?.step).toBe('actor-resolution');
    expect(result.error?.message).toContain('NPC missing');
  });

  test('reset failure produces correct error.step', async () => {
    const port = makeMockPort({ resetThrows: 'db unavailable' });
    const result = await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    expect(result.error?.step).toBe('reset');
  });

  test('Op A quiescence timeout triggers second-reset attempt (lens-2 B1 path)', async () => {
    const log: CallLog = [];
    const port = makeMockPort({ opAQuiescenceReturns: false }, log);
    const result = await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    // The second reset (cleanup after failed quiescence) should fire,
    // and overall lifecycle should still continue (the mock reset
    // doesn't throw, so we proceed).
    const resets = log.filter((c) => c === 'resetScenarioState');
    expect(resets.length).toBe(2);
    expect(result.status).toBe('ok');
  });

  test('Op A quiescence timeout + second-reset failure surfaces as reset error', async () => {
    let resetCalls = 0;
    const port: Port = {
      ...makeMockPort({ opAQuiescenceReturns: false }),
      async resetScenarioState() {
        resetCalls++;
        if (resetCalls === 2) throw new Error('cleanup wipe failed');
      },
    };
    const result = await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    expect(result.error?.step).toBe('reset');
    expect(result.error?.message).toContain('cleanup wipe failed');
  });

  test('conversation establish failure produces correct error.step', async () => {
    const port = makeMockPort({ establishThrows: 'invite rejected' });
    const result = await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    expect(result.error?.step).toBe('conversation-establish');
  });

  test('setup-hooks failure produces correct error.step', async () => {
    const port = makeMockPort({ setupThrows: 'fact insert failed' });
    const result = await runScenarioLifecycle(port, scenarioWithSetup, FAST_OPTS);
    expect(result.error?.step).toBe('setup-hooks');
  });

  test('trigger-message failure produces correct error.step', async () => {
    const port = makeMockPort({ triggerThrows: 'writeMessage threw' });
    const result = await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    expect(result.error?.step).toBe('trigger-message');
  });

  test('NPC reply timeout produces npc-reply-timeout error (not exception)', async () => {
    const port = makeMockPort({ npcReplyReturns: null });
    const result = await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    expect(result.status).toBe('error');
    expect(result.error?.step).toBe('npc-reply-timeout');
    // Partial artifacts should be preserved on this specific failure
    // (conversationId + preMindState are captured before the timeout).
    expect(result.conversationId).toBe('c:1');
    expect(result.preMindState).toBeDefined();
    expect(result.npcReply).toBeUndefined();
  });

  test('read-mindstate failure on PRE snapshot reports correct step', async () => {
    const port = makeMockPort({ readMindStateThrows: 'mindstate query crash' });
    const result = await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    expect(result.error?.step).toBe('read-mindstate');
  });

  test('timings record per-step elapsed (ms since lifecycle start)', async () => {
    const port = makeMockPort();
    const result = await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    expect(result.timings).toBeDefined();
    expect(typeof result.timings?.['lifecycle']).toBe('number');
    expect(result.timings?.['actor-resolution']).toBeGreaterThanOrEqual(0);
    expect(result.timings?.['reset']).toBeGreaterThanOrEqual(0);
  });
});

describe('runScenarioLifecycle — Op A failure observability (Lens-B IMPORTANT #3 + B2 split)', () => {
  test('opAFailuresObserved splits pre vs post (B2 Plan-Lens 1 IMPORTANT #5)', async () => {
    // Both quiescence waits return failed=2, canceled=1. The pre and
    // post buckets are recorded separately so scoring can route
    // pre-trigger failures (don't invalidate post-snapshot) vs
    // post-reply failures (do invalidate it).
    const port = makeMockPort({ opAFailedPerCall: 2, opACanceledPerCall: 1 });
    const result = await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    expect(result.status).toBe('ok');
    expect(result.opAFailuresObserved).toEqual({
      pre: { failed: 2, canceled: 1 },
      post: { failed: 2, canceled: 1 },
    });
  });

  test('opAFailuresObserved is zero on clean run', async () => {
    const port = makeMockPort();
    const result = await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    expect(result.opAFailuresObserved).toEqual({
      pre: { failed: 0, canceled: 0 },
      post: { failed: 0, canceled: 0 },
    });
  });
});

describe('runScenarioLifecycle — partial-artifact preservation', () => {
  // Per lifecycle.ts contract: when npc-reply-timeout happens, we
  // should still surface conversationId + preMindState. This makes
  // post-mortem easier: the operator can inspect the in-flight state
  // even on failure.
  test('npc-reply-timeout preserves conversationId and preMindState', async () => {
    const port = makeMockPort({
      preMindState: { emotionLabel: '平静', emotionValue: 0, affectionValue: 0 },
      npcReplyReturns: null,
    });
    const result = await runScenarioLifecycle(port, baseScenario, FAST_OPTS);
    expect(result.status).toBe('error');
    expect(result.conversationId).toBe('c:1');
    expect(result.preMindState?.emotionLabel).toBe('平静');
  });
});
