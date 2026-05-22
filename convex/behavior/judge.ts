// Memory v3.5 — LLM judge for behavioral rubric scoring.
//
// Given a scenario rubric + the NPC's actual reply, ask a judge LLM
// (Grok by default) to score each bullet Pass/Fail with rationale.
//
// Design choices:
//   - Pure function except for the fetch call; fetch is a dependency
//     injection point so jest tests can mock it without making real
//     LLM calls.
//   - Judge prompt is structured (returns JSON) so we can parse
//     per-bullet verdicts without prose-tolerant heuristics.
//   - Judge model defaults to a non-reasoning Grok variant for speed +
//     cost; configurable via env / arg for higher-stakes runs.
//   - The judge is told the rubric and reply; it does NOT see the
//     setup context. The rubric MUST be self-contained for the
//     judge to be able to score (this is one reason rubric authoring
//     is non-trivial).

import { Rubric } from './parseScenarios';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type BulletTier = 'must' | 'should' | 'mustNot';

export type BulletVerdict = {
  tier: BulletTier;
  bullet: string;
  /** Pass = the rubric criterion is satisfied (or, for mustNot,
   *  correctly avoided). Fail = the criterion is violated. */
  pass: boolean;
  rationale: string;
};

export type JudgeResult = {
  /** Overall verdict: true iff zero MUST failures and zero MUST NOT violations. */
  passed: boolean;
  /** Per-bullet verdicts. */
  verdicts: BulletVerdict[];
  /** Counts for quick scanning. */
  mustPass: number;
  mustFail: number;
  shouldPass: number;
  shouldFail: number;
  mustNotPass: number; // "passed" = correctly avoided
  mustNotFail: number; // "failed" = violated
  /** The raw judge response (for debugging). */
  raw: string;
};

export type JudgeFetchFn = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export type JudgeOptions = {
  /** Override the fetch function (testing). Defaults to global fetch. */
  fetchFn?: JudgeFetchFn;
  /** Override the LLM endpoint URL. Defaults to xAI Grok via env. */
  apiUrl?: string;
  /** Override the API key. Defaults to env.XAI_API_KEY. */
  apiKey?: string;
  /** Override the model name. Defaults to "grok-4.20-non-reasoning". */
  model?: string;
};

// ─────────────────────────────────────────────────────────────────────
// Prompt assembly (pure)
// ─────────────────────────────────────────────────────────────────────

const JUDGE_SYSTEM_PROMPT =
  'You are a behavioral test judge. Given a rubric of behavioral criteria and an NPC reply, ' +
  'score each criterion as PASS or FAIL with a one-sentence rationale. ' +
  'Tiers:\n' +
  '  - MUST: the reply must satisfy this. Score PASS if satisfied, FAIL otherwise.\n' +
  '  - SHOULD: the reply should satisfy this but it is advisory. Score PASS or FAIL as observed.\n' +
  '  - MUST NOT: the reply must NOT do this. Score PASS if correctly avoided, FAIL if violated.\n' +
  'Output STRICT JSON ONLY (no code fences, no prose):\n' +
  '{\n' +
  '  "verdicts": [\n' +
  '    { "tier": "must" | "should" | "mustNot", "bullet": "<original bullet text>", "pass": true | false, "rationale": "<one sentence>" }\n' +
  '  ]\n' +
  '}\n' +
  'Include EVERY bullet from the rubric in the order given. Be strict but fair. ' +
  'Read the reply\'s tone, content, and pragmatic implications — not just the literal words.';

export function buildJudgeUserPrompt(rubric: Rubric, reply: string): string {
  const lines: string[] = ['Rubric:'];
  for (const b of rubric.must) lines.push(`  - [MUST] ${b}`);
  for (const b of rubric.should ?? []) lines.push(`  - [SHOULD] ${b}`);
  for (const b of rubric.mustNot ?? []) lines.push(`  - [MUST NOT] ${b}`);
  lines.push('');
  lines.push('Reply to judge:');
  lines.push(reply);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Response parsing (pure)
// ─────────────────────────────────────────────────────────────────────

export type ParsedJudgeResponse = {
  verdicts: Array<{
    tier: BulletTier;
    bullet: string;
    pass: boolean;
    rationale: string;
  }>;
};

export function parseJudgeResponse(content: string): ParsedJudgeResponse {
  // Strip code fences if present (Grok sometimes wraps despite the
  // system-prompt instruction).
  let stripped = content.trim();
  const fenceMatch = stripped.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) stripped = fenceMatch[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    throw new Error(`Judge response parse failed: ${(e as Error).message}`);
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).verdicts)
  ) {
    throw new Error('Judge response missing `verdicts` array');
  }
  const rawVerdicts = (parsed as { verdicts: unknown[] }).verdicts;
  const out: ParsedJudgeResponse['verdicts'] = [];
  for (let i = 0; i < rawVerdicts.length; i++) {
    const v = rawVerdicts[i] as Record<string, unknown>;
    if (
      !v ||
      typeof v !== 'object' ||
      (v.tier !== 'must' && v.tier !== 'should' && v.tier !== 'mustNot') ||
      typeof v.bullet !== 'string' ||
      typeof v.pass !== 'boolean' ||
      typeof v.rationale !== 'string'
    ) {
      throw new Error(`Judge verdict[${i}] malformed: ${JSON.stringify(v)}`);
    }
    out.push({
      tier: v.tier,
      bullet: v.bullet,
      pass: v.pass,
      rationale: v.rationale,
    });
  }
  return { verdicts: out };
}

// ─────────────────────────────────────────────────────────────────────
// Tally (pure)
// ─────────────────────────────────────────────────────────────────────

export function tallyVerdicts(verdicts: ParsedJudgeResponse['verdicts'], raw: string): JudgeResult {
  let mustPass = 0;
  let mustFail = 0;
  let shouldPass = 0;
  let shouldFail = 0;
  let mustNotPass = 0;
  let mustNotFail = 0;
  for (const v of verdicts) {
    if (v.tier === 'must') {
      v.pass ? mustPass++ : mustFail++;
    } else if (v.tier === 'should') {
      v.pass ? shouldPass++ : shouldFail++;
    } else {
      v.pass ? mustNotPass++ : mustNotFail++;
    }
  }
  const passed = mustFail === 0 && mustNotFail === 0;
  return {
    passed,
    verdicts,
    mustPass,
    mustFail,
    shouldPass,
    shouldFail,
    mustNotPass,
    mustNotFail,
    raw,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Orchestrator (impure — calls the LLM)
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_GROK_URL = 'https://api.x.ai/v1/chat/completions';
const DEFAULT_MODEL = 'grok-4.20-non-reasoning';

/**
 * Score an NPC reply against a rubric. Calls the configured LLM
 * (default: xAI Grok) with a strict-JSON output prompt + parses the
 * response into per-bullet verdicts.
 *
 * Throws on: network error, LLM HTTP non-2xx, malformed response.
 */
export async function judgeReply(
  rubric: Rubric,
  reply: string,
  opts: JudgeOptions = {},
): Promise<JudgeResult> {
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as JudgeFetchFn);
  const apiUrl = opts.apiUrl ?? DEFAULT_GROK_URL;
  const apiKey = opts.apiKey ?? process.env.XAI_API_KEY ?? '';
  const model = opts.model ?? DEFAULT_MODEL;
  if (!apiKey) {
    throw new Error('judgeReply: no API key (set XAI_API_KEY or pass opts.apiKey)');
  }

  const body = {
    model,
    messages: [
      { role: 'system', content: JUDGE_SYSTEM_PROMPT },
      { role: 'user', content: buildJudgeUserPrompt(rubric, reply) },
    ],
    max_tokens: 800,
    temperature: 0.1, // deterministic-ish judgment
  };

  const res = await fetchFn(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Judge LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) {
    throw new Error('Judge LLM returned empty content');
  }
  const parsed = parseJudgeResponse(content);
  return tallyVerdicts(parsed.verdicts, content);
}
