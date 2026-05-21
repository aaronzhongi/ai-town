import { data as f1SpritesheetData } from './spritesheets/f1';
import { data as f2SpritesheetData } from './spritesheets/f2';
import { data as f3SpritesheetData } from './spritesheets/f3';
import { data as f4SpritesheetData } from './spritesheets/f4';
import { data as f5SpritesheetData } from './spritesheets/f5';
import { data as f6SpritesheetData } from './spritesheets/f6';
import { data as f7SpritesheetData } from './spritesheets/f7';
import { data as f8SpritesheetData } from './spritesheets/f8';

// Human-memory port (HumanMemory_AITown_Plan v2) — P0.4.
// EXACTLY ONE non-canon NPC this iteration (L3). `Descriptions.length`
// === 1, so `init` (predev runs it with no args) seeds exactly one
// agent + the player — no `numAgents` edit to init.ts needed (R12).
// `name` MUST equal persona.ts LINA_BIONAME (persona is resolved by the
// talker's playerDescription.name). `character` is a generic folk sprite
// (f1–f8, zero new art) — swappable. `identity`/`plan` here feed only
// ai-town's native FSM / the coexistence path (S9: kept DISJOINT from
// the ContextAssembler persona-core; the old path is removed at P1-1D).
// The full §2 persona lives in convex/agent/persona.ts (user-supplied).
// The previous demo roster (Lucky/Bob/Stella/Alice/Pete) is removed;
// multi-NPC growth is deferred (§7).
export const Descriptions = [
  {
    name: '琳娜',
    character: 'f3',
    identity: `琳娜是一个温文尔雅、彬彬有礼的十八岁女生，受过良好的教育。她刚参加完高中毕业典礼，却莫名其妙地出现在一个陌生的山谷里，心里有些茫然不安，但仍努力保持镇定与礼貌。`,
    plan: '你想弄清楚自己身在何处、为何来到这里，并设法找到回去的方法。',
  },
];

export const characters = [
  {
    name: 'f1',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f1SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f2',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f2SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f3',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f3SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f4',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f4SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f5',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f5SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f6',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f6SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f7',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f7SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f8',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f8SpritesheetData,
    speed: 0.1,
  },
];

// Characters move at 0.75 tiles per second.
export const movementSpeed = 0.75;
