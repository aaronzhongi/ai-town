// Memory v3.5 — unit tests for the LLM judge.
//
// Tests cover the PURE pieces (prompt assembly, response parsing,
// verdict tallying) + the orchestrator's contract (mocked fetch) so
// we don't make real LLM calls during jest.

import {
  buildJudgeUserPrompt,
  parseJudgeResponse,
  tallyVerdicts,
  judgeReply,
  JudgeFetchFn,
} from './judge';
import { Rubric } from './parseScenarios';

// ─────────────────────────────────────────────────────────────────────
// buildJudgeUserPrompt
// ─────────────────────────────────────────────────────────────────────
describe('buildJudgeUserPrompt', () => {
  test('emits MUST bullets first, then SHOULD, then MUST NOT', () => {
    const rubric: Rubric = {
      must: ['m1', 'm2'],
      should: ['s1'],
      mustNot: ['n1', 'n2'],
    };
    const out = buildJudgeUserPrompt(rubric, 'hello');
    const mIdx = out.indexOf('[MUST]');
    const sIdx = out.indexOf('[SHOULD]');
    const nIdx = out.indexOf('[MUST NOT]');
    expect(mIdx).toBeGreaterThanOrEqual(0);
    expect(sIdx).toBeGreaterThan(mIdx);
    expect(nIdx).toBeGreaterThan(sIdx);
  });

  test('includes the reply verbatim', () => {
    const rubric: Rubric = { must: ['m1'] };
    const out = buildJudgeUserPrompt(rubric, '琳娜：你好，李平');
    expect(out).toContain('琳娜：你好，李平');
  });

  test('omits SHOULD / MUST NOT sections when empty', () => {
    const rubric: Rubric = { must: ['only-must'] };
    const out = buildJudgeUserPrompt(rubric, 'reply');
    expect(out).toContain('[MUST]');
    expect(out).not.toContain('[SHOULD]');
    expect(out).not.toContain('[MUST NOT]');
  });
});

// ─────────────────────────────────────────────────────────────────────
// parseJudgeResponse
// ─────────────────────────────────────────────────────────────────────
describe('parseJudgeResponse', () => {
  test('parses a clean JSON response', () => {
    const content = JSON.stringify({
      verdicts: [
        { tier: 'must', bullet: 'm1', pass: true, rationale: 'ok' },
        { tier: 'should', bullet: 's1', pass: false, rationale: 'absent' },
      ],
    });
    const parsed = parseJudgeResponse(content);
    expect(parsed.verdicts).toHaveLength(2);
    expect(parsed.verdicts[0]).toMatchObject({ tier: 'must', pass: true });
  });

  test('strips ```json …``` code fences', () => {
    const content = '```json\n' + JSON.stringify({
      verdicts: [{ tier: 'must', bullet: 'm1', pass: true, rationale: 'ok' }],
    }) + '\n```';
    const parsed = parseJudgeResponse(content);
    expect(parsed.verdicts).toHaveLength(1);
  });

  test('throws on non-JSON', () => {
    expect(() => parseJudgeResponse('not json at all')).toThrow(/parse failed/);
  });

  test('throws when top-level missing verdicts array', () => {
    expect(() => parseJudgeResponse('{"foo": 1}')).toThrow(/missing.*verdicts/);
  });

  test('throws on malformed verdict entry', () => {
    const content = JSON.stringify({
      verdicts: [{ tier: 'invalid-tier', bullet: 'x', pass: true, rationale: 'r' }],
    });
    expect(() => parseJudgeResponse(content)).toThrow(/malformed/);
  });

  test('throws when pass is non-boolean', () => {
    const content = JSON.stringify({
      verdicts: [{ tier: 'must', bullet: 'x', pass: 'true', rationale: 'r' }],
    });
    expect(() => parseJudgeResponse(content)).toThrow(/malformed/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// tallyVerdicts
// ─────────────────────────────────────────────────────────────────────
describe('tallyVerdicts', () => {
  test('passed iff zero MUST fails and zero MUST NOT fails', () => {
    const verdicts = [
      { tier: 'must' as const, bullet: 'm1', pass: true, rationale: '' },
      { tier: 'should' as const, bullet: 's1', pass: false, rationale: '' },
      { tier: 'mustNot' as const, bullet: 'n1', pass: true, rationale: '' },
    ];
    const r = tallyVerdicts(verdicts, 'raw');
    expect(r.passed).toBe(true);
    expect(r.shouldFail).toBe(1);
  });

  test('MUST fail blocks overall pass', () => {
    const verdicts = [
      { tier: 'must' as const, bullet: 'm1', pass: false, rationale: '' },
    ];
    expect(tallyVerdicts(verdicts, 'raw').passed).toBe(false);
  });

  test('MUST NOT violation blocks overall pass', () => {
    const verdicts = [
      { tier: 'must' as const, bullet: 'm1', pass: true, rationale: '' },
      { tier: 'mustNot' as const, bullet: 'n1', pass: false, rationale: 'reply violated' },
    ];
    expect(tallyVerdicts(verdicts, 'raw').passed).toBe(false);
  });

  test('per-tier counts', () => {
    const verdicts = [
      { tier: 'must' as const, bullet: 'm1', pass: true, rationale: '' },
      { tier: 'must' as const, bullet: 'm2', pass: false, rationale: '' },
      { tier: 'should' as const, bullet: 's1', pass: true, rationale: '' },
      { tier: 'mustNot' as const, bullet: 'n1', pass: true, rationale: '' },
    ];
    const r = tallyVerdicts(verdicts, 'raw');
    expect(r.mustPass).toBe(1);
    expect(r.mustFail).toBe(1);
    expect(r.shouldPass).toBe(1);
    expect(r.mustNotPass).toBe(1);
    expect(r.mustNotFail).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// judgeReply — orchestrator (with mocked fetch)
// ─────────────────────────────────────────────────────────────────────
describe('judgeReply (mocked fetch)', () => {
  const rubric: Rubric = {
    must: ['must-1'],
    should: ['should-1'],
    mustNot: ['must-not-1'],
  };
  const reply = '琳娜：你好';

  function makeFetch(judgeContent: string, status = 200): JudgeFetchFn {
    return async (_url: string, _init: RequestInit) => {
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => 'mock error body',
        json: async () => ({
          choices: [{ message: { content: judgeContent } }],
        }),
      } as Response;
    };
  }

  test('happy path: parses + tallies', async () => {
    const judgeContent = JSON.stringify({
      verdicts: [
        { tier: 'must', bullet: 'must-1', pass: true, rationale: 'ok' },
        { tier: 'should', bullet: 'should-1', pass: false, rationale: 'absent' },
        { tier: 'mustNot', bullet: 'must-not-1', pass: true, rationale: 'avoided' },
      ],
    });
    const result = await judgeReply(rubric, reply, {
      fetchFn: makeFetch(judgeContent),
      apiKey: 'test-key',
    });
    expect(result.passed).toBe(true);
    expect(result.mustPass).toBe(1);
    expect(result.shouldFail).toBe(1);
  });

  test('HTTP non-2xx throws', async () => {
    await expect(
      judgeReply(rubric, reply, {
        fetchFn: makeFetch('', 500),
        apiKey: 'test-key',
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  test('missing API key throws', async () => {
    const oldEnv = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;
    try {
      await expect(
        judgeReply(rubric, reply, { fetchFn: makeFetch('') }),
      ).rejects.toThrow(/no API key/);
    } finally {
      if (oldEnv !== undefined) process.env.XAI_API_KEY = oldEnv;
    }
  });

  test('empty content throws', async () => {
    await expect(
      judgeReply(rubric, reply, {
        fetchFn: makeFetch(''),
        apiKey: 'test-key',
      }),
    ).rejects.toThrow(/empty content/);
  });

  test('malformed judge response throws', async () => {
    await expect(
      judgeReply(rubric, reply, {
        fetchFn: makeFetch('not json'),
        apiKey: 'test-key',
      }),
    ).rejects.toThrow(/parse failed/);
  });
});
