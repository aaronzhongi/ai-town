// C003 v2 — unit tests for the redesigned `trimContentPrefx` helper.
// First-match-wins exact `startsWith` over the priority-ordered prefix
// array; 12 patterns longest/most-specific first. Tests pin: each
// pattern strips correctly; ordering doesn't shadow more-specific
// patterns; mid-content occurrences are NOT stripped; empty/no-match
// input passes through unchanged.

import { trimContentPrefx } from './conversation';

const PLAYER = '琳娜';
const OTHER = '李平';
const X_TO_Y = `${PLAYER} to ${OTHER}:`;

// The same priority order the production code builds; mirrored here
// so the tests pin the contract.
const PREFIXES: string[] = [
  `**${X_TO_Y}**`, // 1
  X_TO_Y, // 2
  X_TO_Y.toLowerCase(), // 3
  `**${PLAYER}：**`, // 4
  `**${PLAYER}:**`, // 5
  `**${PLAYER}**：`, // 11 (post-R2 fold)
  `**${PLAYER}**:`, // 12 (post-R2 fold)
  `「${PLAYER}」：`, // 6
  `「${PLAYER}」:`, // 7
  `${PLAYER}：`, // 8
  `${PLAYER}: `, // 9 — must come BEFORE pattern 10
  `${PLAYER}:`, // 10 — strict prefix of #9; goes last
];

describe('trimContentPrefx — exact-startsWith, first-match-wins', () => {
  test('empty prefixes array → content unchanged', () => {
    expect(trimContentPrefx('hello world', [])).toBe('hello world');
  });

  test('no match → content unchanged', () => {
    expect(trimContentPrefx('我是一句话', PREFIXES)).toBe('我是一句话');
  });

  test('null/blank prefix entries are skipped (defensive)', () => {
    expect(trimContentPrefx('琳娜：你好', ['', PREFIXES[9]])).toBe('你好');
  });

  // ──────────────────────────────────────────────────────────────────
  // Each of the 12 patterns strips at start (longest-first ordering
  // ensured by PREFIXES array).
  // ──────────────────────────────────────────────────────────────────
  test('1: **X to Y:**', () => {
    expect(trimContentPrefx(`**${X_TO_Y}** 你好`, PREFIXES)).toBe('你好');
  });
  test('2: X to Y:', () => {
    expect(trimContentPrefx(`${X_TO_Y} 你好`, PREFIXES)).toBe('你好');
  });
  test('3: x to y: (lowercase)', () => {
    expect(trimContentPrefx(`${X_TO_Y.toLowerCase()} hi`, PREFIXES)).toBe('hi');
  });
  test('4: **琳娜：**', () => {
    expect(trimContentPrefx(`**${PLAYER}：** 你好`, PREFIXES)).toBe('你好');
  });
  test('5: **琳娜:**', () => {
    expect(trimContentPrefx(`**${PLAYER}:** 你好`, PREFIXES)).toBe('你好');
  });
  test('11: **琳娜**：  (colon outside bold, CN)', () => {
    expect(trimContentPrefx(`**${PLAYER}**：你好`, PREFIXES)).toBe('你好');
  });
  test('12: **琳娜**:  (colon outside bold, EN)', () => {
    expect(trimContentPrefx(`**${PLAYER}**: 你好`, PREFIXES)).toBe('你好');
  });
  test('6: 「琳娜」：', () => {
    expect(trimContentPrefx(`「${PLAYER}」：你好`, PREFIXES)).toBe('你好');
  });
  test('7: 「琳娜」:', () => {
    expect(trimContentPrefx(`「${PLAYER}」: hi`, PREFIXES)).toBe('hi');
  });
  test('8: 琳娜：  (bare CN colon)', () => {
    expect(trimContentPrefx(`${PLAYER}：你好`, PREFIXES)).toBe('你好');
  });
  test('9: 琳娜:  (bare EN colon + trailing space)', () => {
    expect(trimContentPrefx(`${PLAYER}: hi`, PREFIXES)).toBe('hi');
  });
  test('10: 琳娜:  (bare EN colon, no trailing space)', () => {
    // Pattern 10 is a strict prefix of pattern 9 — first-match-wins
    // means pattern 9 fires when there IS a trailing space; pattern 10
    // fires when there isn't. Verify both pinned.
    expect(trimContentPrefx(`${PLAYER}:hi`, PREFIXES)).toBe('hi');
  });

  // ──────────────────────────────────────────────────────────────────
  // Ordering / shadowing
  // ──────────────────────────────────────────────────────────────────
  test('markdown-wrapped variant wins over bare colon (1 strips, not 10)', () => {
    const out = trimContentPrefx(`**${X_TO_Y}** hello`, PREFIXES);
    // If pattern 10 (`琳娜:`) shadowed, output would still contain "to 李平:"
    expect(out).toBe('hello');
    expect(out).not.toContain('to');
  });
  test('CN-colon-inside-bold (4) wins over outside-bold (11) when both could match', () => {
    // `**琳娜：**...` matches pattern 4 (chars 0-6: `**琳娜：**`);
    // pattern 11 (`**琳娜**：`) is a different string entirely (colon
    // outside the bold) — they don't overlap textually; this test just
    // verifies pattern 4 fires for its own form and 11 fires for its own.
    expect(trimContentPrefx(`**${PLAYER}：**X`, PREFIXES)).toBe('X');
    expect(trimContentPrefx(`**${PLAYER}**：X`, PREFIXES)).toBe('X');
  });

  // ──────────────────────────────────────────────────────────────────
  // Mid-content occurrences are NOT stripped (only start-of-string)
  // ──────────────────────────────────────────────────────────────────
  test('mid-content `琳娜：` is NOT stripped (preserves dialog/quotes)', () => {
    const s = `他说"${PLAYER}：你好"，听上去很真诚`;
    expect(trimContentPrefx(s, PREFIXES)).toBe(s);
  });

  // ──────────────────────────────────────────────────────────────────
  // Trim semantics (post-strip whitespace is trimmed)
  // ──────────────────────────────────────────────────────────────────
  test('post-strip leading/trailing whitespace is trimmed', () => {
    expect(trimContentPrefx(`${PLAYER}：    你好    `, PREFIXES)).toBe('你好');
  });
});
