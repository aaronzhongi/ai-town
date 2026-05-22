// Memory v3.5 phase 2A.11 — unit tests for privacy helpers.

import { isNameLearned, deriveAnonymousLabel } from './privacy';

describe('isNameLearned', () => {
  test('empty displayName → false (defensive)', () => {
    expect(isNameLearned([{ factText: '李平自我介绍说叫李平' }], '')).toBe(false);
    expect(isNameLearned([{ factText: '李平自我介绍说叫李平' }], '   ')).toBe(false);
  });

  test('empty rows → false', () => {
    expect(isNameLearned([], '李平')).toBe(false);
  });

  test('row mentioning name as substring → true', () => {
    expect(isNameLearned([{ factText: '对方说他叫李平' }], '李平')).toBe(true);
  });

  test('row mentioning name embedded in longer prose → true', () => {
    expect(
      isNameLearned(
        [{ factText: '我们一起往池塘走，李平先说"为啥不？"后又说"好"' }],
        '李平',
      ),
    ).toBe(true);
  });

  test('row with different name → false', () => {
    expect(isNameLearned([{ factText: '对方说他叫张三' }], '李平')).toBe(false);
  });

  test('mixed rows: at least one match → true', () => {
    expect(
      isNameLearned(
        [
          { factText: '我感觉这里很安静' },
          { factText: '对方说他叫李平' },
          { factText: '附近没有别人' },
        ],
        '李平',
      ),
    ).toBe(true);
  });

  test('row with empty/undefined factText is skipped, not crashing', () => {
    expect(
      isNameLearned(
        [
          { factText: undefined },
          { factText: '' },
          { factText: '对方叫李平' },
        ],
        '李平',
      ),
    ).toBe(true);
  });

  test('case sensitivity — Chinese matches exactly (no case fold needed)', () => {
    expect(isNameLearned([{ factText: '李平好' }], '李平')).toBe(true);
  });

  test('partial-prefix match (name appears as substring of longer name) → true', () => {
    // Edge case: someone introduces as "李平星", system already
    // knows "李平". Substring match fires. Acceptable round-1 false
    // positive — caller's responsibility to verify if needed.
    expect(isNameLearned([{ factText: '对方说叫李平星' }], '李平')).toBe(true);
  });
});

describe('deriveAnonymousLabel', () => {
  test('both fields empty → fallback to 陌生人', () => {
    expect(deriveAnonymousLabel({})).toBe('陌生人');
    expect(deriveAnonymousLabel({ appearance: '   ', surfaceManner: '' })).toBe('陌生人');
  });

  test('surfaceManner first phrase + 的人 (the canonical 李平 case)', () => {
    expect(
      deriveAnonymousLabel({
        surfaceManner: '不自信，躲闪我的目光。但背地里发现他在偷偷的瞄我，有些色色的。',
      }),
    ).toBe('不自信的人');
  });

  test('surfaceManner preferred over appearance when both present', () => {
    expect(
      deriveAnonymousLabel({
        appearance: '戴眼镜',
        surfaceManner: '局促',
      }),
    ).toBe('局促的人');
  });

  test('falls back to appearance when surfaceManner empty', () => {
    expect(deriveAnonymousLabel({ appearance: '高个子' })).toBe('高个子的人');
  });

  test('splits on Chinese comma 、，AND period 。 AND semicolon ；', () => {
    expect(deriveAnonymousLabel({ surfaceManner: '冷淡。爱搭不理。' })).toBe('冷淡的人');
    expect(deriveAnonymousLabel({ surfaceManner: '内向；不善言辞' })).toBe('内向的人');
    expect(deriveAnonymousLabel({ surfaceManner: '紧张, 局促' })).toBe('紧张的人');
  });

  test('long single-clause surfaceManner → fallback to 陌生人 (avoids mouthful label)', () => {
    // First phrase > 14 chars → +`的人` (2 chars) > 16 cap → fallback.
    expect(
      deriveAnonymousLabel({
        surfaceManner: '这个人看起来非常非常的不自然且让人感到困惑',
      }),
    ).toBe('陌生人');
  });

  test('handles whitespace at start/end of first phrase', () => {
    expect(deriveAnonymousLabel({ surfaceManner: '  局促  ，紧张' })).toBe('局促的人');
  });
});
