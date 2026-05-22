// Memory v3.5 — schema-integrity tests for the behavioral suite.
//
// Two layers of test:
//   1. Parser unit tests — pure-logic tests with hand-crafted YAML.
//   2. Live spec validation — load convex/behavior/scenarios.yaml
//      from disk and run validateScenarios over it. If anyone
//      edits the spec and breaks the schema, this test fails fast
//      on the next commit.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  parseScenarios,
  validateScenarios,
  KNOWN_CATEGORIES,
  ScenarioFile,
} from './parseScenarios';

// ESM-safe __dirname equivalent (jest config uses
// ts-jest/presets/default-esm + package.json "type": "module" — the
// classic CommonJS __dirname is not defined in this runtime).
const __dirnameEsm = dirname(fileURLToPath(import.meta.url));

describe('parseScenarios — pure parser', () => {
  test('parses a minimal valid file', () => {
    const yaml = `
version: 1
scenarios:
  - id: T01
    category: privacy
    context: "test context"
    input: "PC: test"
    rubric:
      must:
        - "MUST condition"
`;
    const parsed = parseScenarios(yaml);
    expect(parsed.version).toBe(1);
    expect(parsed.scenarios).toHaveLength(1);
    expect(parsed.scenarios[0].id).toBe('T01');
  });

  test('throws when top-level is not a mapping', () => {
    expect(() => parseScenarios('- a\n- b')).toThrow(/top-level must be a mapping/);
  });

  test('throws when version is missing or non-number', () => {
    expect(() => parseScenarios('scenarios: []')).toThrow(/version.*must be a number/);
    expect(() =>
      parseScenarios('version: "one"\nscenarios: []'),
    ).toThrow(/version.*must be a number/);
  });

  test('throws when scenarios is missing or non-array', () => {
    expect(() => parseScenarios('version: 1')).toThrow(/scenarios.*must be an array/);
    expect(() =>
      parseScenarios('version: 1\nscenarios: {}'),
    ).toThrow(/scenarios.*must be an array/);
  });
});

describe('validateScenarios — schema integrity', () => {
  const baseScenario = {
    id: 'T01',
    category: 'privacy' as const,
    context: 'test context',
    input: 'PC: test',
    rubric: { must: ['MUST condition'] },
  };

  test('valid file returns empty errors', () => {
    const file: ScenarioFile = { version: 1, scenarios: [baseScenario] };
    expect(validateScenarios(file)).toEqual([]);
  });

  test('rejects unknown version', () => {
    const file: ScenarioFile = { version: 99, scenarios: [baseScenario] };
    const errs = validateScenarios(file);
    expect(errs.some((e) => /Unknown schema version/.test(e.message))).toBe(true);
  });

  test('rejects duplicate ids', () => {
    const file: ScenarioFile = {
      version: 1,
      scenarios: [baseScenario, { ...baseScenario, id: 'T01' }],
    };
    const errs = validateScenarios(file);
    expect(errs.some((e) => /duplicate scenario id T01/.test(e.message))).toBe(true);
  });

  test('rejects empty / missing id', () => {
    const file: ScenarioFile = {
      version: 1,
      scenarios: [{ ...baseScenario, id: '' }],
    };
    const errs = validateScenarios(file);
    expect(errs.some((e) => /missing id/.test(e.message))).toBe(true);
  });

  test('rejects unknown category', () => {
    const file: ScenarioFile = {
      version: 1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scenarios: [{ ...baseScenario, category: 'made-up' as any }],
    };
    const errs = validateScenarios(file);
    expect(errs.some((e) => /unknown category/.test(e.message))).toBe(true);
  });

  test('rejects empty must array', () => {
    const file: ScenarioFile = {
      version: 1,
      scenarios: [{ ...baseScenario, rubric: { must: [] } }],
    };
    const errs = validateScenarios(file);
    expect(errs.some((e) => /must must be a non-empty array/.test(e.message))).toBe(true);
  });

  test('rejects missing context', () => {
    const file: ScenarioFile = {
      version: 1,
      scenarios: [{ ...baseScenario, context: '   ' }],
    };
    const errs = validateScenarios(file);
    expect(errs.some((e) => /context missing or empty/.test(e.message))).toBe(true);
  });

  test('rejects non-string entries in should[] / mustNot[]', () => {
    const file: ScenarioFile = {
      version: 1,
      scenarios: [
        {
          ...baseScenario,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rubric: { must: ['x'], should: [42 as any] },
        },
      ],
    };
    const errs = validateScenarios(file);
    expect(errs.some((e) => /should\[0\] must be a non-empty string/.test(e.message))).toBe(true);
  });

  test('accepts all KNOWN_CATEGORIES', () => {
    for (const category of KNOWN_CATEGORIES) {
      const file: ScenarioFile = {
        version: 1,
        scenarios: [{ ...baseScenario, id: `T-${category}`, category }],
      };
      const errs = validateScenarios(file);
      expect(errs).toEqual([]);
    }
  });
});

describe('live spec — convex/behavior/scenarios.yaml', () => {
  // This test loads the actual spec from disk. If anyone edits the
  // YAML and introduces a schema error, this test will fail-fast on
  // the next commit. Keeps the round-1 codified spec honest.
  let file: ScenarioFile;

  beforeAll(() => {
    const yamlPath = join(__dirnameEsm, 'scenarios.yaml');
    const content = readFileSync(yamlPath, 'utf-8');
    file = parseScenarios(content);
  });

  test('parses without throwing', () => {
    expect(file.version).toBe(1);
    expect(file.scenarios.length).toBeGreaterThan(0);
  });

  test('validates clean (zero errors)', () => {
    const errs = validateScenarios(file);
    if (errs.length > 0) {
      // Pretty-print errors so test output is actionable.
      console.error(
        'scenarios.yaml validation errors:\n' +
          errs.map((e) => `  [${e.scenarioId ?? 'structural'}] ${e.message}`).join('\n'),
      );
    }
    expect(errs).toEqual([]);
  });

  test('contains the 8 round-1 scenarios B01..B08', () => {
    const ids = file.scenarios.map((s) => s.id).sort();
    expect(ids).toEqual(['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08']);
  });

  test('every scenario has a non-empty must rubric', () => {
    for (const s of file.scenarios) {
      expect(s.rubric.must.length).toBeGreaterThan(0);
    }
  });

  test('boundary-defense scenarios (B04/B05/B06) cover the trial-3+4+5 progression', () => {
    const ids = new Set(file.scenarios.filter((s) => s.category === 'boundary').map((s) => s.id));
    expect(ids).toContain('B04'); // flirty
    expect(ids).toContain('B05'); // physical
    expect(ids).toContain('B06'); // escalation
  });

  test('round-1 revised scenarios carry userCommentR1 audit trail', () => {
    // Per the user's design intent: every scenario where the original
    // rubric was REVISED based on round-1 feedback must preserve the
    // verbatim user comment in userCommentR1 — that comment is the
    // load-bearing rationale for WHY the rubric reads the way it does.
    // The 4 revised scenarios were B01, B02, B04, B06 (per CSV diff).
    const revisedScenarios = ['B01', 'B02', 'B04', 'B06'];
    for (const id of revisedScenarios) {
      const s = file.scenarios.find((x) => x.id === id);
      expect(s).toBeDefined();
      expect(s?.userCommentR1).toBeTruthy();
      expect((s?.userCommentR1 ?? '').trim().length).toBeGreaterThan(20);
    }
  });

  test('2A.13b lens-2 fold — B06 silent-leave uses deterministic.expectedAction not rubric', () => {
    // The LLM judge cannot score "physically left without speaking"
    // from an empty reply string. Lens-2 P7 required moving this
    // assertion to the deterministic channel.
    const b06 = file.scenarios.find((s) => s.id === 'B06');
    expect(b06).toBeDefined();
    expect(b06?.deterministic?.expectedAction).toBe('walk-away');
    expect(b06?.deterministic?.npcViolenceUsed).toBe(false);
  });

  test('2A.13b lens-2 fold — B04 compliment-affect bump on deterministic channel', () => {
    // Internal-state assertions (mindState.affection bump) live on
    // the deterministic channel, not rubric.should — the LLM judge
    // cannot observe mindState from the reply text.
    const b04 = file.scenarios.find((s) => s.id === 'B04');
    expect(b04?.deterministic?.affectionDelta).toEqual({
      sign: 'positive',
      magnitude: 'small',
    });
  });

  test('2A.13b lens-2 fold — B03 self-containment: must-bullet pins the recognized-name case', () => {
    // Pre-fix B03 had `must: 把对方当作认识的人对待` — unverifiable
    // from reply alone. Post-fix: must bullet explicitly requires
    // either the name or an "again-meeting" temporal marker.
    const b03 = file.scenarios.find((s) => s.id === 'B03');
    const mustText = (b03?.rubric.must ?? []).join('\n');
    // Either "李平" or "又见面了" / "你又来了" should appear in the
    // rubric's first MUST bullet's example string — making the
    // judgement concrete.
    expect(mustText).toMatch(/李平|又见面|你又来/);
  });

  test('2A.13b lens-2 fold — B07 self-containment: must-bullet pins the prior-name match', () => {
    const b07 = file.scenarios.find((s) => s.id === 'B07');
    const mustText = (b07?.rubric.must ?? []).join('\n');
    // The MUST bullet should require BOTH the prior name AND a
    // temporal marker so the judge can verify the reply actually
    // referenced the contradiction.
    expect(mustText).toMatch(/李平/);
    expect(mustText).toMatch(/刚才|先前|方才|之前/);
  });
});
