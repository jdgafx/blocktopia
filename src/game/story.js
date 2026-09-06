import { BLOCKS } from '../constants/blocks.js';
import { validSupplies } from './camp.js';

export const STORY_STAGES = Object.freeze([
  { title: 'The silent beacons', npcId: 'mara', x: 8, z: 8, cost: {},
    objective: 'Speak with Mara in Hearthwood.',
    text: 'The great storm silenced the beacons that joined our settlements. I kept this hearth alive, hoping someone would come. Help us bring the lights back.' },
  { title: 'A light in Hearthwood', npcId: 'mara', x: 8, z: 8, cost: { [BLOCKS.PLANKS]: 8 },
    objective: 'Bring 8 planks to Mara to rebuild the Hearthwood beacon.',
    text: 'Our first beacon needs a new timber frame. Gather logs and saw eight planks at camp. Once it shines, find Ivo in the Amber Dunes to the east.' },
  { title: 'The mason of Amber Dunes', npcId: 'ivo', x: 104, z: 8, cost: { [BLOCKS.STONE_BRICK]: 4 },
    objective: 'Bring 4 stone bricks to Ivo in Amber Dunes.',
    text: 'I saw Hearthwood light up across the valley. Four stone bricks will mend our beacon base. Neri guards the next light in the Frostspine to the south.' },
  { title: 'Through the Frostspine', npcId: 'neri', x: 104, z: 104, cost: { [BLOCKS.GLASS]: 2 },
    objective: 'Bring 2 glass to Neri in the Frostspine.',
    text: 'The storm shattered our beacon lens. Smelt sand with coal and bring two glass. Then follow the western trail to Sol at Tideglass.' },
  { title: 'The tide returns', npcId: 'sol', x: 8, z: 104, cost: {},
    objective: 'Speak with Sol in Tideglass to reunite the settlements.',
    text: 'Three lights have crossed the horizon. You have brought us together again. Let this final beacon shine, and make these settlements a home worth sharing.' },
].map((stage) => Object.freeze({ ...stage, cost: Object.freeze(stage.cost) })));

export function validStory(story) {
  return !!story && typeof story === 'object' && !Array.isArray(story)
    && Object.keys(story).length === 1 && Number.isInteger(story.stage)
    && story.stage >= 0 && story.stage <= STORY_STAGES.length;
}

// The host checks the current stage and charges shared supplies in one ordered transaction.
export function storyAction(story, supplies, targetId, playerPosition, mode = 'expedition') {
  if (!validStory(story) || !validSupplies(supplies)) return { ok: false, reason: 'Invalid expedition progress' };
  const stage = STORY_STAGES[story.stage];
  if (!stage) return { ok: false, reason: 'All settlements have already been restored' };
  if (targetId !== stage.npcId) return { ok: false, reason: stage.objective };
  const position = Array.isArray(playerPosition) ? playerPosition : [playerPosition?.x, playerPosition?.y, playerPosition?.z];
  if (position.length !== 3 || !position.every(Number.isFinite)) return { ok: false, reason: 'Player position is unavailable' };
  if ((position[0] - stage.x) ** 2 + (position[2] - stage.z) ** 2 > 36) {
    return { ok: false, reason: `Move closer to ${targetId[0].toUpperCase() + targetId.slice(1)}` };
  }
  const next = { ...supplies };
  if (mode !== 'creative') {
    if (Object.entries(stage.cost).some(([id, count]) => (next[id] ?? 0) < count)) {
      return { ok: false, reason: stage.objective };
    }
    for (const [id, count] of Object.entries(stage.cost)) next[id] -= count;
  }
  return { ok: true, story: { stage: story.stage + 1 },
    supplies: Object.fromEntries(Object.entries(next).filter(([, count]) => count > 0)) };
}
