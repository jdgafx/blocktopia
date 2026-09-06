import { REGIONS, getRegion } from '../game/regions.js';
import { STORY_STAGES } from '../game/story.js';
import { BLOCK_DEFS } from '../constants/blocks.js';
import { worldMedia } from './world-media.js';

const voices = {
  mara: 'I used to chart the whole valley from our beacon. When the lights went out, every settlement thought it was alone. We can change that, one block at a time.',
  ivo: 'People call this a wasteland. Look closer: every dune hides a wall, every wall remembers a city. I build with what survives.',
  neri: 'The old lenses did not make light. They helped one small light reach someone far away. That is a much better kind of power.',
  sol: 'I kept a lantern in the window every night. Not because I knew anyone would come. Because someone might.',
};

export function initAdventure(session, player, characters) {
  const dialog = document.getElementById('adventure-dialog');
  const title = document.getElementById('adventure-title');
  const text = document.getElementById('adventure-text');
  const action = document.getElementById('story-action');
  const prompt = document.getElementById('talk-character');
  const objective = document.getElementById('story-objective');
  let speaking, lastStage = -1, nextUpdate = 0;
  const stage = () => session.ledger.story?.stage ?? 0;
  function render() {
    const step = STORY_STAGES[stage()];
    const person = speaking?.npc;
    title.textContent = person ? `${person.name} · ${person.role}` : 'The lights we leave behind';
    text.textContent = person ? (step?.npcId === person.id ? step.text : stage() === 5
      ? 'The four beacons are answering each other again. This is our home now. Stay, build, and bring your friends.' : voices[person.id])
      : 'After the Long Silence, four settlements lost contact. Restore their beacons with Mara, Ivo, Neri, and Sol. Your camp shares every discovery and every restored light.';
    const goals = document.getElementById('story-chapters'); goals.replaceChildren();
    STORY_STAGES.forEach((chapter, index) => {
      const li = document.createElement('li'); li.dataset.state = index < stage() ? 'complete' : index === stage() ? 'current' : 'waiting';
      li.textContent = `${index < stage() ? '✓ ' : ''}${chapter.title} — ${chapter.objective}`; goals.append(li);
    });
    action.hidden = !person || step?.npcId !== person.id;
    const cost = Object.entries(step?.cost ?? {}).map(([id, n]) => `${n} ${BLOCK_DEFS[id].name}`).join(' + ');
    action.textContent = cost && session.mode !== 'creative' ? `Deliver ${cost}` : stage() === 0 ? 'We will restore the beacons' : 'Restore the beacon';
    action.disabled = !session.snapshotReady || (session.mode !== 'creative' && Object.entries(step?.cost ?? {}).some(([id, n]) => (session.ledger.supplies[id] ?? 0) < n));
    document.getElementById('story-cost').textContent = !action.hidden && action.disabled ? `Gather and craft ${cost} with your camp first.` : '';
    objective.textContent = step ? step.objective : 'The lights are home · build your next chapter';
    objective.dataset.stage = stage();
    document.getElementById('story-feedback').textContent = '';
  }
  function open(region) {
    speaking = region; document.exitPointerLock?.(); player.setActive(false);
    worldMedia.show(region ?? getRegion(player.position.x, player.position.z), Boolean(region));
    render(); dialog.showModal();
  }
  action.addEventListener('click', () => {
    if (speaking) session.submitStory(speaking.npc.id);
  });
  document.getElementById('close-adventure').addEventListener('click', () => dialog.close());
  document.getElementById('open-journal').addEventListener('click', () => open(null));
  prompt.addEventListener('click', () => { const region = characters.nearest(player.position); if (region) open(region); });
  document.addEventListener('keydown', event => {
    if (!player.active || event.target.closest?.('input,textarea') || event.repeat) return;
    if (event.code === 'KeyJ') { event.preventDefault(); open(null); }
    if (event.code === 'KeyF') {
      const region = characters.nearest(player.position);
      if (region) { event.preventDefault(); open(region); }
    }
  });
  const ns = 'http://www.w3.org/2000/svg', map = document.getElementById('region-map');
  for (const region of REGIONS) {
    const group = document.createElementNS(ns, 'g');
    const dot = document.createElementNS(ns, 'circle'); dot.setAttribute('cx', region.x); dot.setAttribute('cy', region.z); dot.setAttribute('r', '4');
    const label = document.createElementNS(ns, 'text'); label.setAttribute('x', region.x); label.setAttribute('y', region.z + 11); label.textContent = region.name;
    group.append(dot, label); map.append(group);
  }
  const marker = document.createElementNS(ns, 'circle'); marker.setAttribute('r', '3'); marker.id = 'map-player'; map.append(marker);
  return {
    refresh() { if (dialog.open) render(); },
    update(now) {
      if (now < nextUpdate) return; nextUpdate = now + 250;
      if (lastStage !== stage()) { lastStage = stage(); render(); }
      const region = characters.nearest(player.position);
      prompt.hidden = !player.active || !region;
      prompt.textContent = region ? `Talk to ${region.npc.name} [F]` : '';
      const step = STORY_STAGES[stage()];
      const p = player.position;
      document.getElementById('region-name').textContent = `${getRegion(p.x, p.z).name}${step ? ` · ${Math.round(Math.hypot(p.x - step.x, p.z - step.z))} m to ${step.npcId[0].toUpperCase() + step.npcId.slice(1)}` : ''}`;
      marker.setAttribute('cx', Math.max(-8, Math.min(120, p.x))); marker.setAttribute('cy', Math.max(-8, Math.min(120, p.z)));
    },
  };
}
