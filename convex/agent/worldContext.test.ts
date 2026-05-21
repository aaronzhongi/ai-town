// Fix A (v3 §12.1, S11) — buildSurroundings unit tests. Pure; covers:
// - worldDescription always included
// - position rendered with rounded ints
// - empty ambient-neighbor branch
// - non-empty ambient-neighbor branch (display names, N13)
// - dissonance hint preserved (the 山谷 reconciliation line)

import { buildSurroundings, worldDescription } from './worldContext';

describe('buildSurroundings (S11)', () => {
  test('includes the worldDescription verbatim + position + the no-others fallback', () => {
    const s = buildSurroundings({
      position: { x: 12.4, y: 38.7 },
      ambientNeighborNames: [],
    });
    expect(s).toContain(worldDescription);
    expect(s).toContain('坐标 (x=12, y=39)'); // rounded
    expect(s).toContain('附近没有其他人');
  });

  test('renders display names of ambient neighbors (N13: no raw ids)', () => {
    const s = buildSurroundings({
      position: { x: 0, y: 0 },
      ambientNeighborNames: ['张三', '李四'],
    });
    expect(s).toContain('此刻周围可见到：张三、李四。');
    expect(s).not.toContain('附近没有其他人');
  });

  test('filters out blank/whitespace neighbor entries', () => {
    const s = buildSurroundings({
      position: { x: 5, y: 5 },
      ambientNeighborNames: ['', '   ', '王五'],
    });
    expect(s).toContain('此刻周围可见到：王五。');
  });

  test('worldDescription states the §5.1 dissonance factually, but does NOT author the NPC\'s reconciliation (R3 lens-3 R-2)', () => {
    expect(worldDescription).toContain('与你印象中"被群山环绕的山谷"并不完全吻合');
    // The interpretive hint "或许是你刚醒来时记忆混淆了" was REMOVED in v3.1
    // post-consensus refinement — §5.3 should be perceptual reportage only;
    // the model performs the persona-reconciliation in-character.
    expect(worldDescription).not.toContain('记忆混淆');
  });

  test('all empty input still yields a non-trivial, multi-line surroundings block', () => {
    const s = buildSurroundings({
      position: { x: 0, y: 0 },
      ambientNeighborNames: [],
    });
    expect(s.split('\n').length).toBeGreaterThanOrEqual(3); // description + position + no-others
  });
});
