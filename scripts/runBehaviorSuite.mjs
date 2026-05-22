#!/usr/bin/env node
// Memory v3.5 — behavioral-test suite runner.
//
// Loads convex/behavior/scenarios.yaml, then invokes the
// `runScenarioLifecycle_action` internalAction per scenario via
// `npx convex run`, and prints a summary.
//
// Usage:
//   node scripts/runBehaviorSuite.mjs                  # all scenarios
//   node scripts/runBehaviorSuite.mjs --ids B01,B04   # filter
//   node scripts/runBehaviorSuite.mjs --confirm       # required for >1
//   node scripts/runBehaviorSuite.mjs --dry-run       # print plan only
//
// NOTE: this is B1 — lifecycle-only. Each scenario triggers two real
// LLM calls (NPC reply + Op A); the judge integration + scoring lands
// in B2. For now, output is raw artifacts per scenario (JSON), with no
// pass/fail aggregation.

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { parse as parseYAML } from 'yaml';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);
const SCENARIOS_PATH = join(REPO_ROOT, 'convex', 'behavior', 'scenarios.yaml');

// ─────────────────────────────────────────────────────────────────────
// Arg parsing
// ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { ids: null, confirm: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') out.confirm = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--ids') {
      out.ids = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
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

function runConvexAction(scenario) {
  return new Promise((resolve, reject) => {
    // Use cmd wrapper on Windows so npx is found via PATH; on POSIX,
    // direct exec is fine.
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'npx.cmd' : 'npx';
    const argsJson = JSON.stringify({ scenario });
    const args = ['convex', 'run', 'behavior/orchestrator:runScenario', argsJson];
    const child = spawn(cmd, args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`convex run exited ${code}\nstderr:\n${stderr}\nstdout:\n${stdout}`));
        return;
      }
      // The CLI prints the action's return value to stdout. Try to
      // parse the LAST JSON object printed (convex CLI may interleave
      // logs before the result).
      try {
        const parsed = extractLastJsonObject(stdout);
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Failed to parse action result: ${e}\nraw stdout:\n${stdout}`));
      }
    });
    child.on('error', (e) => reject(e));
  });
}

function extractLastJsonObject(text) {
  // Walk the text right-to-left looking for the last '}' and try to
  // parse a balanced JSON object ending there. Stops at first parse
  // success. Handles convex CLI prefixing.
  for (let end = text.length; end > 0; end--) {
    if (text[end - 1] !== '}') continue;
    let depth = 0;
    let start = -1;
    for (let i = end - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === '}') depth++;
      else if (ch === '{') {
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
        // keep walking
      }
    }
  }
  throw new Error('no JSON object found in stdout');
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const yamlContent = readFileSync(SCENARIOS_PATH, 'utf-8');
  const spec = parseYAML(yamlContent);
  const allScenarios = spec.scenarios ?? [];
  const scenarios = args.ids
    ? allScenarios.filter((s) => args.ids.includes(s.id))
    : allScenarios;

  if (scenarios.length === 0) {
    console.error('No scenarios matched the filter.');
    process.exit(2);
  }
  if (scenarios.length > 1 && !args.confirm && !args.dryRun) {
    console.error(
      `Refusing to run ${scenarios.length} scenarios without --confirm.\n` +
        `Each scenario triggers 1 NPC-reply LLM call + 1 Op A call. ` +
        `Pass --confirm if you intend to burn ~${scenarios.length * 2} LLM calls.`,
    );
    process.exit(2);
  }

  console.log(
    `Behavioral suite — B1 lifecycle-only (no judge, no scoring).\n` +
      `Scenarios: ${scenarios.map((s) => s.id).join(', ')}\n` +
      `Mode: ${args.dryRun ? 'DRY RUN' : 'EXECUTE'}\n`,
  );

  if (args.dryRun) {
    for (const s of scenarios) {
      console.log(`  - ${s.id} (${s.category}): "${s.input}"`);
    }
    return;
  }

  const results = [];
  for (const s of scenarios) {
    process.stdout.write(`▶ ${s.id} ... `);
    const t0 = Date.now();
    try {
      const result = await runConvexAction(s);
      const dt = Date.now() - t0;
      results.push(result);
      console.log(`[${result.status}] ${dt}ms`);
      if (result.status === 'error') {
        console.log(`    step=${result.error?.step} message=${result.error?.message}`);
      } else if (result.npcReply) {
        const preview = result.npcReply.text.slice(0, 60).replace(/\n/g, ' ');
        console.log(`    reply: "${preview}${result.npcReply.text.length > 60 ? '…' : ''}"`);
      }
    } catch (e) {
      console.log(`[exception]`);
      console.log(`    ${e.message ?? e}`);
      results.push({ scenarioId: s.id, status: 'error', error: { step: 'unexpected', message: String(e) } });
    }
  }

  console.log('\n──── Summary ────');
  const ok = results.filter((r) => r.status === 'ok').length;
  const err = results.length - ok;
  console.log(`Total: ${results.length}    OK: ${ok}    Error: ${err}`);
  console.log('\nRaw artifacts (JSON):\n' + JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
