// Human-memory port (HumanMemory_AITown_Plan v2). §5.3 surroundings
// feeder — gives the NPC awareness of the ACTUAL ai-town map (not just
// the persona's narrative reality from §5.1). Without this, 琳娜's
// §5.1 valley framing dominates and she ignores the real map around
// her. Pure (no Convex/IO); caller passes position + ambient neighbors.

import { renderWorkingMemory } from './mindState';

/**
 * Hand-authored description of the default ai-town "gentle" map
 * (`data/gentle.js` — 45×32 tile pastoral scene). Faithful to the
 * actual on-screen environment, NOT to the persona's §5.1 narrative.
 * Edit here if you swap to a different map.
 */
// Pure perceptual reportage of the actual map. Does NOT include any
// interpretive hint about how the NPC should reconcile this with §5.1's
// "山谷" narrative — that reconciliation is left to the model to perform
// in-character (R3 lens-3 recommend: §5.3 should describe what is seen,
// not author the NPC's cognition).
export const worldDescription =
  '你眼前所见是一片宁静的乡间小镇——四周散布着木造小屋、铺着石板的小径、整齐的菜圃和草地，' +
  '远处错落着几棵大树和池塘。整体气氛恬静，更像一处午后的乡村，' +
  '与你印象中"被群山环绕的山谷"并不完全吻合。';

/**
 * Build the §5.3 surroundings text from the actual world state. Combines
 * (a) the static map description, (b) the talker's current grid
 * position, (c) names of ambient neighbors (other players in the world
 * besides the talker and the current talkee — the talkee is already in
 * §3 so listing them again is redundant; N13: NEVER a raw id, always a
 * display name).
 */
export function buildSurroundings(args: {
  position: { x: number; y: number };
  ambientNeighborNames: string[];
}): string {
  const lines: string[] = [worldDescription];
  lines.push(
    `你目前所处位置大约在镇上坐标 (x=${Math.round(args.position.x)}, y=${Math.round(args.position.y)}) 附近。`,
  );
  const others = args.ambientNeighborNames.filter((n) => !!n && n.trim());
  if (others.length) {
    lines.push(`此刻周围可见到：${others.join('、')}。`);
  } else {
    lines.push('此刻除了眼前的对话对象之外，附近没有其他人。');
  }
  return lines.join('\n');
}

// Re-export so callers can build §5.1-5.3 working memory in one place.
export { renderWorkingMemory };
