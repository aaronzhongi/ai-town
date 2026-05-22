#!/usr/bin/env node
// Memory v3.5 — behavioral-test suite runner (2B2 — full scoring).
//
// Loads convex/behavior/scenarios.yaml, invokes Convex actions per
// scenario, scores, and optionally writes per-scenario calibration
// state to convex/behavior/calibration-state.json.
//
// All scoring math lives Convex-side (convex/behavior/scoring.ts +
// orchestrator.ts actions); this Node script handles only:
//   - YAML / JSON file IO
//   - process orchestration (loop + invoke convex run)
//   - terminal output formatting
//   - calibration-state merge (inline diff, ~15 LOC)
//
// Modes:
//   scored (default) — 1 lifecycle + 1 judge call per scenario.
//   calibrate        — 1 lifecycle + N judge calls per scenario;
//                      computes per-bullet + per-scenario self-agreement.
//
// Usage:
//   node scripts/runBehaviorSuite.mjs                                    # all, scored
//   node scripts/runBehaviorSuite.mjs --ids B01,B04                      # filter
//   node scripts/runBehaviorSuite.mjs --confirm                          # required for >1
//   node scripts/runBehaviorSuite.mjs --dry-run                          # plan only
//   node scripts/runBehaviorSuite.mjs --verbose                          # per-bullet rationale on failures
//   node scripts/runBehaviorSuite.mjs --calibrate 5 --ids B01            # calibration on one scenario
//   node scripts/runBehaviorSuite.mjs --calibrate 5 --confirm \
//     --write-calibration                                                # full calibration + persist state

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { parse as parseYAML } from 'yaml';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const SCENARIOS_PATH = join(REPO_ROOT, 'convex', 'behavior', 'scenarios.yaml');
const CALIBRATION_PATH = join(REPO_ROOT, 'convex', 'behavior', 'calibration-state.json');
const DEFAULT_JUDGE_MODEL = 'grok-4.20-non-reasoning'; // mirrors judge.ts DEFAULT_MODEL

// ─────────────────────────────────────────────────────────────────────
// Arg parsing
// ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    ids: null,
    confirm: false,
    dryRun: false,
    verbose: false,
    calibrate: null,
    writeCalibration: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--write-calibration') out.writeCalibration = true;
    else if (a === '--ids') {
      out.ids = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--calibrate') {
      const n = parseInt(argv[++i] ?? '', 10);
      if (!Number.isFinite(n) || n < 1) {
        console.error(`--calibrate requires a positive integer N`);
        process.exit(2);
      }
      out.calibrate = n;
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Convex CLI invocation
// ─────────────────────────────────────────────────────────────────────

function runConvexAction(actionPath, argsObj) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'npx.cmd' : 'npx';
    const args = ['convex', 'run', actionPath, JSON.stringify(argsObj)];
    const child = spawn(cmd, args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `convex run ${actionPath} exited ${code}\nstderr:\n${stderr}\nstdout:\n${stdout}`,
          ),
        );
        return;
      }
      try {
        resolve(extractLastJsonValue(stdout));
      } catch (e) {
        reject(new Error(`Failed to parse action result: ${e}\nraw stdout:\n${stdout}`));
      }
    });
    child.on('error', (e) => reject(e));
  });
}

function extractLastJsonValue(text) {
  // Walk right-to-left looking for the last balanced JSON object or
  // string ending. Tries objects first, then strings.
  for (let end = text.length; end > 0; end--) {
    const ch = text[end - 1];
    if (ch === '}') {
      let depth = 0;
      let start = -1;
      for (let i = end - 1; i >= 0; i--) {
        const c = text[i];
        if (c === '}') depth++;
        else if (c === '{') {
          depth--;
          if (depth === 0) {
            start = i;
            break;
          }
        }
      }
      if (start >= 0) {
        try {
          return JSON.parse(text.slice(start, end));
        } catch {
          /* keep walking */
        }
      }
    }
  }
  throw new Error('no JSON value found in stdout');
}

// ─────────────────────────────────────────────────────────────────────
// Calibration state IO + inline merge (Plan-Lens 1 IMPORTANT #5)
// ─────────────────────────────────────────────────────────────────────

function readCalibrationState() {
  if (!existsSync(CALIBRATION_PATH)) {
    return { version: 1, generated: null, scenarios: {} };
  }
  try {
    return JSON.parse(readFileSync(CALIBRATION_PATH, 'utf-8'));
  } catch (e) {
    console.error(`Failed to read calibration-state.json: ${e}`);
    return { version: 1, generated: null, scenarios: {} };
  }
}

function writeCalibrationState(state) {
  writeFileSync(CALIBRATION_PATH, JSON.stringify(state, null, 2) + '\n');
}

/** Inline mirror of scoring.mergeCalibrationEntry — diff against
 *  existing entry, return changed=false when only timestamp would
 *  change, so we don't dirty the working tree on every run.
 *
 *  KEEP IN SYNC with convex/behavior/scoring.ts:mergeCalibrationEntry.
 *  If you change the diff threshold or add a compared field there,
 *  update here too (Lens-A NIT #5). The duplication is the cost of
 *  this script being Node-side without a TypeScript loader. */
function mergeEntry(state, scenarioId, fresh) {
  const existing = state.scenarios[scenarioId];
  const changed =
    !existing ||
    existing.passesGate !== fresh.passesGate ||
    existing.rubricHash !== fresh.rubricHash ||
    existing.blockedReason !== fresh.blockedReason ||
    existing.judgeModel !== fresh.judgeModel ||
    existing.n !== fresh.n ||
    Math.abs(existing.perBulletAgreement - fresh.perBulletAgreement) > 0.01 ||
    Math.abs(existing.perScenarioAgreement - fresh.perScenarioAgreement) > 0.01;
  if (!changed) return { state, changed: false };
  return {
    state: {
      ...state,
      generated: new Date().toISOString(),
      scenarios: { ...state.scenarios, [scenarioId]: fresh },
    },
    changed: true,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Output rendering
// ─────────────────────────────────────────────────────────────────────

function renderVerdictLine(verdict, dt) {
  const v = verdict;
  const overall = v.overall.toUpperCase();
  const tag =
    v.overall === 'pass'
      ? `\x1b[32m[${overall}]\x1b[0m`
      : v.overall === 'fail'
        ? `\x1b[31m[${overall}]\x1b[0m`
        : v.overall === 'skipped'
          ? `\x1b[33m[${overall}]\x1b[0m`
          : `\x1b[35m[${overall}]\x1b[0m`;
  const dtStr = dt !== undefined ? ` ${(dt / 1000).toFixed(1)}s` : '';
  let body = '';
  if (v.rubric) {
    const r = v.rubric;
    body = ` must ${r.mustPass}/${r.mustPass + r.mustFail}, mustNot ${r.mustNotPass}/${r.mustNotPass + r.mustNotFail}, should ${r.shouldPass}/${r.shouldPass + r.shouldFail}`;
  }
  const detCount = v.deterministic?.checks?.length ?? 0;
  if (detCount > 0) {
    const passes = v.deterministic.checks.filter((c) => c.status === 'pass').length;
    const fails = v.deterministic.checks.filter((c) => c.status === 'fail').length;
    const unver = v.deterministic.checks.filter((c) => c.status === 'unverifiable').length;
    body += `, det ${passes}/${detCount}${unver > 0 ? ` (${unver} UNVERIFIABLE)` : ''}${fails > 0 ? ` (${fails} FAILED)` : ''}`;
  }
  return `${tag} ${v.scenarioId}${body}${dtStr}${v.reason ? `\n    ${v.reason}` : ''}`;
}

function renderVerbose(verdict) {
  const lines = [];
  if (verdict.rubric) {
    const failures = verdict.rubric.verdicts.filter((b) => !b.pass);
    for (const f of failures) {
      lines.push(`    [${f.tier}] FAIL "${f.bullet}"`);
      lines.push(`      judge: ${f.rationale}`);
    }
  }
  for (const c of verdict.deterministic?.checks ?? []) {
    if (c.status === 'fail') {
      lines.push(`    [det] FAIL ${c.name}: expected ${c.expected}, actual ${c.actual ?? '<none>'}`);
    } else if (c.status === 'unverifiable') {
      lines.push(`    [det] UNVERIFIABLE ${c.name}: ${c.reason} (expected ${c.expected})`);
    }
  }
  return lines.join('\n');
}

function renderCalibrationSummary(state, currentScenarioIds) {
  const lines = ['', '──── Calibration gate status ────'];
  for (const id of currentScenarioIds) {
    const entry = state.scenarios[id];
    if (!entry) {
      lines.push(`  ${id}: \x1b[90m✗ not calibrated\x1b[0m`);
      continue;
    }
    if (entry.passesGate) {
      lines.push(
        `  ${id}: \x1b[32m✓ gated\x1b[0m  (perBullet=${entry.perBulletAgreement.toFixed(2)}, perScenario=${entry.perScenarioAgreement.toFixed(2)}, n=${entry.n})`,
      );
    } else {
      // Lens-B IMPORTANT #5 — make B06's permanent-block status
      // visually distinct from a transient calibration miss so an
      // operator doesn't try to "fix" it by re-calibrating.
      const reason = entry.blockedReason ?? 'no reason';
      const isPermP6 = reason.includes('no-action-log');
      const tag = isPermP6
        ? `\x1b[35m⊘ permanently blocked\x1b[0m`
        : `\x1b[31m✗ blocked\x1b[0m`;
      const suffix = isPermP6 ? ` (P6 body-action-log not wired)` : '';
      lines.push(`  ${id}: ${tag}  ${reason}${suffix}`);
    }
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const yamlContent = readFileSync(SCENARIOS_PATH, 'utf-8');
  const spec = parseYAML(yamlContent);
  const allScenarios = spec.scenarios ?? [];
  const scenarios = args.ids ? allScenarios.filter((s) => args.ids.includes(s.id)) : allScenarios;

  if (scenarios.length === 0) {
    console.error('No scenarios matched the filter.');
    process.exit(2);
  }
  if (scenarios.length > 1 && !args.confirm && !args.dryRun) {
    const extraCost = args.calibrate ? args.calibrate - 1 : 0;
    const perScenarioCalls = 2 + extraCost; // NPC reply + 1 judge + (N-1) extra judges in calibrate
    console.error(
      `Refusing to run ${scenarios.length} scenarios without --confirm.\n` +
        `Mode: ${args.calibrate ? `calibrate (N=${args.calibrate})` : 'scored'}.\n` +
        `Estimated cost: ${scenarios.length * perScenarioCalls} LLM calls.`,
    );
    process.exit(2);
  }

  const mode = args.calibrate ? `calibrate (N=${args.calibrate})` : 'scored';
  console.log(
    `Behavioral suite — 2B2.\n` +
      `Scenarios: ${scenarios.map((s) => s.id).join(', ')}\n` +
      `Mode: ${args.dryRun ? 'DRY RUN' : mode}\n`,
  );

  if (args.dryRun) {
    for (const s of scenarios) {
      console.log(`  - ${s.id} (${s.category}): "${s.input}"`);
    }
    return;
  }

  let calibrationState = readCalibrationState();
  let calibrationDirty = false;

  const results = [];
  for (const s of scenarios) {
    process.stdout.write(`▶ ${s.id} ... `);
    const t0 = Date.now();
    try {
      // 1. Always run scenario once via runScenario (lifecycle + 1 judge call).
      const scored = await runConvexAction('behavior/orchestrator:runScenario', { scenario: s });
      const dt = Date.now() - t0;
      results.push(scored);
      console.log();
      console.log(renderVerdictLine(scored.verdict, dt));
      if (args.verbose && scored.verdict.overall !== 'pass' && scored.verdict.overall !== 'error') {
        const v = renderVerbose(scored.verdict);
        if (v) console.log(v);
      }

      // 2. Calibration mode: (N-1) more judgeOnly calls on the SAME reply.
      if (args.calibrate && scored.lifecycleResult.status === 'ok' && scored.lifecycleResult.npcReply) {
        const replyText = scored.lifecycleResult.npcReply.text;
        const judgeRuns = [scored.judgeResult].filter(Boolean);
        for (let i = 1; i < args.calibrate; i++) {
          process.stdout.write(`    judge ${i + 1}/${args.calibrate} ... `);
          try {
            const j = await runConvexAction('behavior/orchestrator:judgeOnly', {
              rubric: s.rubric,
              replyText,
            });
            if (j.judgeResult) {
              judgeRuns.push(j.judgeResult);
              console.log(`[${j.judgeResult.passed ? 'pass' : 'fail'}]`);
            } else {
              console.log(`[error: ${j.judgeError}]`);
            }
          } catch (e) {
            console.log(`[exception: ${e.message ?? e}]`);
          }
        }
        if (judgeRuns.length >= 2) {
          // Delegate calibration-entry computation to Convex (avoids
          // needing to load scoring.ts from this .mjs script).
          const entry = await runConvexAction(
            'behavior/orchestrator:computeCalibrationFromRuns',
            {
              scenario: s,
              judgeRuns,
              verdict: scored.verdict,
              judgeModel: DEFAULT_JUDGE_MODEL,
            },
          );
          console.log(
            `    calibration: perBullet=${entry.perBulletAgreement.toFixed(2)} perScenario=${entry.perScenarioAgreement.toFixed(2)} → ${entry.passesGate ? 'GATED' : `BLOCKED (${entry.blockedReason})`}`,
          );
          const merged = mergeEntry(calibrationState, s.id, entry);
          if (merged.changed) {
            calibrationState = merged.state;
            calibrationDirty = true;
          }
        }
      }
    } catch (e) {
      console.log(`[exception]`);
      console.log(`    ${e.message ?? e}`);
      results.push({
        verdict: {
          scenarioId: s.id,
          overall: 'error',
          errorSource: 'lifecycle',
          reason: String(e),
          deterministic: { checks: [], anyUnverifiable: false, anyFailed: false },
        },
      });
    }
  }

  // ── Summary ─────────────────────────────────────────────────────
  console.log('\n──── Summary ────');
  const counts = { pass: 0, fail: 0, skipped: 0, error: 0 };
  for (const r of results) {
    const o = r.verdict?.overall ?? 'error';
    counts[o] = (counts[o] ?? 0) + 1;
  }
  console.log(
    `Pass: ${counts.pass}  Fail: ${counts.fail}  Skipped: ${counts.skipped}  Error: ${counts.error}`,
  );

  // Drift-detect on read: recompute hashes for stored entries via
  // Convex action, mark drifted ones as blocked in-memory.
  const currentScenarioIds = scenarios.map((s) => s.id);
  for (const id of currentScenarioIds) {
    const entry = calibrationState.scenarios[id];
    if (!entry) continue;
    const scenario = scenarios.find((s) => s.id === id);
    if (!scenario) continue;
    try {
      const { hash } = await runConvexAction('behavior/orchestrator:computeRubricHash', {
        rubric: scenario.rubric,
      });
      if (hash !== entry.rubricHash) {
        calibrationState = {
          ...calibrationState,
          scenarios: {
            ...calibrationState.scenarios,
            [id]: {
              ...entry,
              passesGate: false,
              blockedReason: `rubric-changed-since-calibration (stored=${entry.rubricHash.slice(0, 8)}, current=${hash.slice(0, 8)})`,
            },
          },
        };
      }
    } catch (e) {
      // Drift check failure shouldn't abort the run; just warn.
      console.error(`    [warn] rubric-hash check for ${id} failed: ${e.message ?? e}`);
    }
  }
  console.log(renderCalibrationSummary(calibrationState, currentScenarioIds));

  // ── Persist calibration state ───────────────────────────────────
  if (args.writeCalibration && calibrationDirty) {
    writeCalibrationState(calibrationState);
    console.log(`\n✓ Updated ${CALIBRATION_PATH}`);
  } else if (args.writeCalibration && !calibrationDirty) {
    console.log(
      `\nNo material calibration changes — skipping write (Plan-Lens 1 IMPORTANT #5).`,
    );
  } else if (args.calibrate && !args.writeCalibration) {
    console.log(
      `\nCalibration data computed but NOT persisted. Re-run with --write-calibration to update calibration-state.json.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
