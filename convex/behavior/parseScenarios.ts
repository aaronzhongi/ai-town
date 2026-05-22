// Memory v3.5 — typed loader for the behavioral scenario YAML.
//
// The YAML at convex/behavior/scenarios.yaml is the authoritative
// spec. This loader provides:
//   1. The typed `Scenario` shape (compile-time contract).
//   2. `parseScenarios(yamlContent)` — pure function, no IO.
//   3. `validateScenarios(scenarios)` — schema integrity check
//      (unique IDs, every rubric has at least one must/should/mustNot,
//      categories from a known set, etc.)
//
// Both helpers are pure — fully unit-testable. The end-to-end
// orchestrator (separate file, follow-up commit) consumes
// `parseScenarios` + `validateScenarios` + drives the per-scenario
// world setup → input → observe-reply → judge pipeline.

import { parse as parseYAML } from 'yaml';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type ScenarioCategory =
  | 'privacy'
  | 'instinct'
  | 'matchtree'
  | 'affect'
  | 'boundary'
  | 'cognition'
  | 'robustness';

export const KNOWN_CATEGORIES: readonly ScenarioCategory[] = [
  'privacy',
  'instinct',
  'matchtree',
  'affect',
  'boundary',
  'cognition',
  'robustness',
];

/**
 * The behavioral rubric — bullet checklist scored Pass/Fail by an
 * LLM judge. `must` failures are blocking; `should` are advisory;
 * `mustNot` are blocking violations.
 *
 * Each bullet is a plain-language statement of behavior expected
 * (or forbidden) in the NPC's reply. The judge sees the actual reply
 * + the bullet + scores it. See judge.ts for the scoring contract.
 */
export type Rubric = {
  must: string[];
  should?: string[];
  mustNot?: string[];
};

export type Scenario = {
  /** Stable identifier (e.g. B01, B02, ...). */
  id: string;
  /** One of KNOWN_CATEGORIES. */
  category: ScenarioCategory;
  /** Setup state in plain language — what world / mindState /
   *  knowledgeFact rows / conversation history exist at scenario
   *  start. The orchestrator reads this prose AND a per-scenario
   *  setup hook (TBD) to actually prepare the world. */
  context: string;
  /** The PC's message that triggers the scenario. Includes the
   *  "PC: " prefix verbatim so the judge sees the exact frame. */
  input: string;
  /** Behavioral expectation, scored by LLM judge. */
  rubric: Rubric;
  /** OPTIONAL: original verbatim user comment from round-1 review.
   *  Audit trail — explains WHY the rubric reads the way it does. */
  userCommentR1?: string;
};

export type ScenarioFile = {
  version: number;
  scenarios: Scenario[];
};

// ─────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────

/** Parse the YAML content into a structured `ScenarioFile`. Throws
 *  on top-level shape mismatch (missing `scenarios` array, version
 *  not a number). Per-scenario validation is in `validateScenarios`. */
export function parseScenarios(yamlContent: string): ScenarioFile {
  const raw = parseYAML(yamlContent);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('scenarios.yaml: top-level must be a mapping');
  }
  const file = raw as Record<string, unknown>;
  if (typeof file.version !== 'number') {
    throw new Error('scenarios.yaml: `version` must be a number');
  }
  if (!Array.isArray(file.scenarios)) {
    throw new Error('scenarios.yaml: `scenarios` must be an array');
  }
  return {
    version: file.version,
    scenarios: file.scenarios as Scenario[],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Validator
// ─────────────────────────────────────────────────────────────────────

export type ValidationError = {
  scenarioId: string | null; // null if structural (e.g. duplicate ids)
  message: string;
};

/** Run schema integrity checks across all scenarios. Returns an
 *  array of errors; empty array means valid. Caller decides whether
 *  to throw or warn. */
export function validateScenarios(file: ScenarioFile): ValidationError[] {
  const errors: ValidationError[] = [];

  if (file.version !== 1) {
    errors.push({
      scenarioId: null,
      message: `Unknown schema version ${file.version}; expected 1`,
    });
  }

  const seenIds = new Set<string>();
  for (const s of file.scenarios) {
    // 1. id present + non-empty
    if (!s.id || typeof s.id !== 'string' || !s.id.trim()) {
      errors.push({ scenarioId: null, message: 'scenario missing id' });
      continue;
    }
    // 2. unique id
    if (seenIds.has(s.id)) {
      errors.push({ scenarioId: s.id, message: `duplicate scenario id ${s.id}` });
      continue;
    }
    seenIds.add(s.id);

    // 3. category from known set
    if (!KNOWN_CATEGORIES.includes(s.category)) {
      errors.push({
        scenarioId: s.id,
        message: `unknown category "${s.category}" (must be one of ${KNOWN_CATEGORIES.join(', ')})`,
      });
    }

    // 4. context present
    if (!s.context || typeof s.context !== 'string' || !s.context.trim()) {
      errors.push({ scenarioId: s.id, message: 'context missing or empty' });
    }

    // 5. input present
    if (!s.input || typeof s.input !== 'string' || !s.input.trim()) {
      errors.push({ scenarioId: s.id, message: 'input missing or empty' });
    }

    // 6. rubric has at least one MUST bullet
    if (!s.rubric || !Array.isArray(s.rubric.must) || s.rubric.must.length === 0) {
      errors.push({
        scenarioId: s.id,
        message: 'rubric.must must be a non-empty array',
      });
    }

    // 7. should / mustNot are arrays-of-strings when present
    for (const tier of ['should', 'mustNot'] as const) {
      const arr = s.rubric?.[tier];
      if (arr === undefined) continue;
      if (!Array.isArray(arr)) {
        errors.push({
          scenarioId: s.id,
          message: `rubric.${tier} must be an array when present`,
        });
        continue;
      }
      for (let i = 0; i < arr.length; i++) {
        if (typeof arr[i] !== 'string' || !arr[i].trim()) {
          errors.push({
            scenarioId: s.id,
            message: `rubric.${tier}[${i}] must be a non-empty string`,
          });
        }
      }
    }
  }

  return errors;
}
