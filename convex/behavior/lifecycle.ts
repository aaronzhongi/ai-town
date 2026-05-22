// Memory v3.5 — behavioral-test orchestrator: pure state machine.
//
// This module is runner-agnostic. It defines a `Port` interface that
// abstracts every Convex-side side-effect the lifecycle needs (mutation
// dispatch, query reads, polling, sleep), and exposes
// `runScenarioLifecycle(port, scenario, opts)` which drives one
// scenario through:
//
//   RESET → SETUP → TRIGGER → POLL → READ → emit raw result
//
// Scoring + judge integration are deliberately NOT here — they land in
// B2 (judge integration + calibration). B1's job is just to produce the
// raw artifacts (NPC reply text + pre/post mindState) honestly, and to
// emit explicit `unverifiable` markers for any deterministic check the
// orchestrator cannot yet evaluate (per the lens-3 "no false-pass"
// principle).
//
// The Port boundary also keeps the future external-Node-runner switch
// open (lens-1 IMPORTANT #2): swap the Convex-backed port for an HTTP
// port and the lifecycle reuses unchanged.

import type { Scenario } from './parseScenarios';

// ─────────────────────────────────────────────────────────────────────
// Port interface
// ─────────────────────────────────────────────────────────────────────

export type MindStateSnapshot = {
  emotionLabel: string | null;
  emotionValue: number | null;
  affectionValue: number | null;
} | null;

/** Lifecycle wrapper for {NPC, PC} identities the orchestrator works with. */
export type ScenarioActors = {
  npcPlayerId: string;
  npcAgentId: string;
  pcPlayerId: string;
};

/** Runner-agnostic port: every operation the lifecycle needs. All
 *  methods are async and return JSON-shaped values (no Convex types in
 *  the interface — keeps external runners and the meta-test clean). */
export type Port = {
  /** Check engine.running on the default world's engine. Returns true
   *  iff engine exists and is running. Throws if no default world. */
  getEngineRunning(): Promise<boolean>;

  /** Resolve actor playerIds + agentId. Throws if NPC fixture missing.
   *  If test PC missing, creates it idempotently and waits for join to
   *  land (polls up to pcCreateTimeoutMs). */
  ensureActors(opts: { npcName: string; pcName: string; pcCreateTimeoutMs: number }): Promise<ScenarioActors>;

  /** Wipe (NPC, PC) state: knowledgeFact rows where ownerPlayerId=NPC
   *  and entity in {PC playerId, '__general__'}; mindState row where
   *  (NPC, PC); messages for any (NPC,PC) conversation; close any
   *  conversation either is in. Atomic mutation. */
  resetScenarioState(actors: ScenarioActors): Promise<void>;

  /** Wait for any pending Op A scheduled functions targeting `npcPlayerId`
   *  to finish or timeout. Polls `_scheduled_functions` system table.
   *  Returns `{ quiesced, failed, canceled }`:
   *  - `quiesced` = true if `pending`+`inProgress` reached 0 within
   *    the deadline; false on timeout.
   *  - `failed` / `canceled` = COUNTS observed at the final poll. The
   *    lifecycle surfaces these in the result so B2 deterministic
   *    scoring can route around scenarios where Op A crashed (B1
   *    Lens-B IMPORTANT #3 — without this signal, a crashed Op A
   *    looks identical to "no affect change" in the post-snapshot). */
  waitForOpAQuiescence(opts: { npcPlayerId: string; timeoutMs: number; pollIntervalMs: number }): Promise<{
    quiesced: boolean;
    failed: number;
    canceled: number;
  }>;

  /** Establish a fresh (NPC, PC) conversation: send startConversation
   *  input, wait for the engine to process it AND for BOTH participants
   *  to transition to `participating` (the engine handles walk-over).
   *  Returns the new conversationId. Throws on timeout or engine error. */
  establishConversation(opts: {
    actors: ScenarioActors;
    timeoutMs: number;
    pollIntervalMs: number;
  }): Promise<string>;

  /** Apply scenario setup hooks: knowledgeFactSeeds, mindStateInit,
   *  priorMessages. priorMessages are inserted directly into the
   *  messages table AND conversation.lastMessage/numMessages are
   *  patched so engine state stays consistent (lens-2 B4). */
  applySetupHooks(opts: {
    actors: ScenarioActors;
    conversationId: string;
    setup: Scenario['setup'];
  }): Promise<void>;

  /** Snapshot the (NPC, PC) mindState row. Returns null if no row
   *  exists yet (fresh-world case). */
  readMindStateSnapshot(actors: ScenarioActors): Promise<MindStateSnapshot>;

  /** Write the scenario's `input` as a PC message via the canonical
   *  writeMessage path (which schedules Op A as a side-effect — that's
   *  the production behavior we want to exercise). Returns the
   *  messageId of the inserted PC message. */
  writeTriggerMessage(opts: {
    actors: ScenarioActors;
    conversationId: string;
    inputText: string;
  }): Promise<{ messageId: string; writeTimestampMs: number }>;

  /** Poll the messages table for a new message authored by `npcPlayerId`
   *  in `conversationId` whose _id is strictly greater than
   *  `afterMessageId` (lens-1 IMPORTANT #5 — id-based, not time-based,
   *  to avoid same-ms collisions). Returns the reply text and meta on
   *  success, or null on timeout. */
  pollForNpcReply(opts: {
    actors: ScenarioActors;
    conversationId: string;
    afterMessageId: string;
    timeoutMs: number;
    pollIntervalMs: number;
  }): Promise<{ messageId: string; text: string; creationTime: number } | null>;

  /** Sleep helper. The Convex-backed port uses setTimeout in action
   *  context; the meta-test port advances mock time. */
  sleep(ms: number): Promise<void>;
};

// ─────────────────────────────────────────────────────────────────────
// Lifecycle options + result types
// ─────────────────────────────────────────────────────────────────────

export type LifecycleOpts = {
  /** Player name to query in playerDescriptions for the NPC under test.
   *  Default: '琳娜' (the Memory v3.5 trial NPC). */
  npcName?: string;
  /** Player name for the dedicated test PC. Created idempotently if
   *  not present. Default: '__behavior_test_pc__'. */
  pcName?: string;
  /** Engine-precondition + actor-resolution budget. Default: 30s. */
  actorTimeoutMs?: number;
  /** Op A quiescence wait between reset and conversation establishment.
   *  Default: 35s (a hair above GROK_CALL_TIMEOUT_MS=30s in
   *  convex/constants.ts to allow the timeout-abort path to land). */
  opAQuiescenceTimeoutMs?: number;
  /** Wait for both participants to reach `participating` status after
   *  startConversation input. Default: 60s (covers walk-over time on
   *  far-apart spawn positions). */
  conversationTimeoutMs?: number;
  /** Wait for NPC reply after PC trigger message. Default: 90s (NPC
   *  agent loop + Grok roundtrip + safety margin). */
  npcReplyTimeoutMs?: number;
  /** Poll interval for any of the above waits. Default: 1000ms. */
  pollIntervalMs?: number;
};

const DEFAULT_OPTS: Required<LifecycleOpts> = {
  npcName: '琳娜',
  pcName: '__behavior_test_pc__',
  actorTimeoutMs: 30_000,
  opAQuiescenceTimeoutMs: 35_000,
  conversationTimeoutMs: 60_000,
  npcReplyTimeoutMs: 90_000,
  pollIntervalMs: 1_000,
};

/** Per-step error tag. Lets the report distinguish *which* lifecycle
 *  step failed without parsing free-text. */
export type LifecycleErrorStep =
  | 'engine-not-running'
  | 'actor-resolution'
  | 'reset'
  | 'op-a-quiescence'
  | 'conversation-establish'
  | 'setup-hooks'
  | 'trigger-message'
  | 'npc-reply-timeout'
  | 'read-mindstate'
  | 'unexpected';

export type LifecycleError = {
  step: LifecycleErrorStep;
  message: string;
};

/** Raw artifacts the lifecycle produces per scenario. B2 will consume
 *  these to compute pass/fail (rubric via judge + deterministic via
 *  the snapshots here). */
export type LifecycleResult = {
  scenarioId: string;
  status: 'ok' | 'error';
  conversationId?: string;
  npcReply?: { messageId: string; text: string; creationTime: number };
  preMindState?: MindStateSnapshot;
  postMindState?: MindStateSnapshot;
  /** Op A failure observability (B1 Lens-B IMPORTANT #3; refined in
   *  B2 per Plan-Lens 1 IMPORTANT #5 — split pre vs post).
   *
   *  `pre` = failures observed during the pre-trigger quiescence wait
   *  (orphaned Op A from the prior scenario). These do NOT invalidate
   *  the post-trigger snapshot, since the trigger turn's own Op A is
   *  independent. Captured for diagnostic visibility only.
   *
   *  `post` = failures observed during the post-reply quiescence wait
   *  (Op A on the trigger turn itself crashed or timed out). These DO
   *  invalidate the post-snapshot — affect deltas and emotion-floor
   *  checks become unverifiable per scoring.evaluateDeterministic. */
  opAFailuresObserved?: {
    pre: { failed: number; canceled: number };
    post: { failed: number; canceled: number };
  };
  /** Timings per step in ms (since lifecycle start). Useful for
   *  diagnosing slow steps. */
  timings?: Partial<Record<LifecycleErrorStep | 'lifecycle', number>>;
  error?: LifecycleError;
};

// ─────────────────────────────────────────────────────────────────────
// Lifecycle driver
// ─────────────────────────────────────────────────────────────────────

/** Run one scenario through the full lifecycle. Returns a raw
 *  result; the caller (orchestrator or test) is responsible for
 *  scoring against the rubric / deterministic checks. */
export async function runScenarioLifecycle(
  port: Port,
  scenario: Scenario,
  opts: LifecycleOpts = {},
): Promise<LifecycleResult> {
  const o = { ...DEFAULT_OPTS, ...opts };
  const t0 = Date.now();
  const timings: LifecycleResult['timings'] = {};

  const stamp = (step: LifecycleErrorStep | 'lifecycle') => {
    timings[step] = Date.now() - t0;
  };

  // ── Precondition: engine running ────────────────────────────────
  let running: boolean;
  try {
    running = await port.getEngineRunning();
  } catch (e) {
    stamp('lifecycle');
    return errorResult(scenario.id, 'engine-not-running', String(e), timings);
  }
  if (!running) {
    stamp('lifecycle');
    return errorResult(
      scenario.id,
      'engine-not-running',
      'Engine is not running. Resume the world before running the suite.',
      timings,
    );
  }

  // ── Actor resolution + idempotent test-PC ───────────────────────
  let actors: ScenarioActors;
  try {
    actors = await port.ensureActors({
      npcName: o.npcName,
      pcName: o.pcName,
      pcCreateTimeoutMs: o.actorTimeoutMs,
    });
    stamp('actor-resolution');
  } catch (e) {
    stamp('lifecycle');
    return errorResult(scenario.id, 'actor-resolution', String(e), timings);
  }

  // ── RESET ───────────────────────────────────────────────────────
  try {
    await port.resetScenarioState(actors);
    stamp('reset');
  } catch (e) {
    stamp('lifecycle');
    return errorResult(scenario.id, 'reset', String(e), timings);
  }

  // ── Op A quiescence (lens-2 B1 race fix) ────────────────────────
  // Any in-flight Op A from a prior scenario could write orphan
  // knowledgeFact rows after our reset. Wait for the scheduler queue
  // to drain before continuing. We log a warning on timeout but
  // continue — preferable to failing the whole scenario, since the
  // RESET already wiped what would have been orphaned.
  //
  // Failures here are pre-trigger — orphans from a prior scenario.
  // They do NOT invalidate this scenario's post-snapshot.
  let opAFailuresPre = { failed: 0, canceled: 0 };
  let opAFailuresPost = { failed: 0, canceled: 0 };
  const q1 = await port.waitForOpAQuiescence({
    npcPlayerId: actors.npcPlayerId,
    timeoutMs: o.opAQuiescenceTimeoutMs,
    pollIntervalMs: o.pollIntervalMs,
  });
  opAFailuresPre.failed += q1.failed;
  opAFailuresPre.canceled += q1.canceled;
  stamp('op-a-quiescence');
  if (!q1.quiesced) {
    // Best-effort second reset to catch any rows that landed during
    // the quiescence wait. If this also fails, surface the error.
    try {
      await port.resetScenarioState(actors);
    } catch (e) {
      stamp('lifecycle');
      return errorResult(
        scenario.id,
        'reset',
        `Op A failed to quiesce within ${o.opAQuiescenceTimeoutMs}ms; cleanup reset threw: ${e}`,
        timings,
      );
    }
  }

  // ── Conversation establish ──────────────────────────────────────
  let conversationId: string;
  try {
    conversationId = await port.establishConversation({
      actors,
      timeoutMs: o.conversationTimeoutMs,
      pollIntervalMs: o.pollIntervalMs,
    });
    stamp('conversation-establish');
  } catch (e) {
    stamp('lifecycle');
    return errorResult(scenario.id, 'conversation-establish', String(e), timings);
  }

  // ── Setup hooks ─────────────────────────────────────────────────
  if (scenario.setup) {
    try {
      await port.applySetupHooks({
        actors,
        conversationId,
        setup: scenario.setup,
      });
      stamp('setup-hooks');
    } catch (e) {
      stamp('lifecycle');
      return errorResult(scenario.id, 'setup-hooks', String(e), timings);
    }
  }

  // ── Pre-trigger mindState snapshot ──────────────────────────────
  let preMindState: MindStateSnapshot = null;
  try {
    preMindState = await port.readMindStateSnapshot(actors);
  } catch (e) {
    stamp('lifecycle');
    return errorResult(scenario.id, 'read-mindstate', String(e), timings);
  }

  // ── Trigger message ─────────────────────────────────────────────
  let trigger: { messageId: string; writeTimestampMs: number };
  try {
    trigger = await port.writeTriggerMessage({
      actors,
      conversationId,
      inputText: stripPcPrefix(scenario.input),
    });
    stamp('trigger-message');
  } catch (e) {
    stamp('lifecycle');
    return errorResult(scenario.id, 'trigger-message', String(e), timings);
  }

  // ── Poll for NPC reply ──────────────────────────────────────────
  const reply = await port.pollForNpcReply({
    actors,
    conversationId,
    afterMessageId: trigger.messageId,
    timeoutMs: o.npcReplyTimeoutMs,
    pollIntervalMs: o.pollIntervalMs,
  });
  if (!reply) {
    stamp('lifecycle');
    return errorResult(
      scenario.id,
      'npc-reply-timeout',
      `No NPC reply observed within ${o.npcReplyTimeoutMs}ms after trigger message ${trigger.messageId}`,
      timings,
      { conversationId, preMindState },
    );
  }

  // ── Wait for Op A on the reply turn to settle, then snapshot ────
  // Failures here are post-reply — Op A for the trigger turn itself
  // crashed or timed out. These INVALIDATE the post-snapshot for any
  // mindState-reading deterministic check (see scoring.ts).
  const q2 = await port.waitForOpAQuiescence({
    npcPlayerId: actors.npcPlayerId,
    timeoutMs: o.opAQuiescenceTimeoutMs,
    pollIntervalMs: o.pollIntervalMs,
  });
  opAFailuresPost.failed += q2.failed;
  opAFailuresPost.canceled += q2.canceled;

  let postMindState: MindStateSnapshot = null;
  try {
    postMindState = await port.readMindStateSnapshot(actors);
    stamp('read-mindstate');
  } catch (e) {
    stamp('lifecycle');
    return errorResult(
      scenario.id,
      'read-mindstate',
      String(e),
      timings,
      { conversationId, preMindState, npcReply: reply },
    );
  }

  stamp('lifecycle');
  return {
    scenarioId: scenario.id,
    status: 'ok',
    conversationId,
    npcReply: reply,
    preMindState,
    postMindState,
    opAFailuresObserved: { pre: opAFailuresPre, post: opAFailuresPost },
    timings,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/** Strip the "PC: " prefix from scenario.input. The YAML keeps the
 *  prefix verbatim so judge prompts see the speaker frame, but the
 *  trigger message itself is just the body. */
export function stripPcPrefix(input: string): string {
  return input.replace(/^PC:\s*/, '');
}

function errorResult(
  scenarioId: string,
  step: LifecycleErrorStep,
  message: string,
  timings: LifecycleResult['timings'],
  partial: Partial<LifecycleResult> = {},
): LifecycleResult {
  return {
    scenarioId,
    status: 'error',
    timings,
    error: { step, message },
    ...partial,
  };
}
