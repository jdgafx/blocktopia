import { REGIONS } from '../game/regions.js';
import './world-media.css';

const MEDIA = {
  hearthwood: { file: 'forest-haven', portrait: 'mara-ranger' },
  'amber-dunes': { file: 'sunstone-settlement', portrait: 'ivo-smith' },
  frostspine: { file: 'skyreach-ruins', portrait: 'neri-explorer' },
  tideglass: { file: 'tidal-glass-coast', portrait: 'sol-keeper' },
};

function initWorldMedia() {
  const dialog = document.getElementById('cinematic-dialog');
  const video = document.getElementById('cinematic-video');
  const status = document.getElementById('cinematic-status');
  const choices = document.getElementById('region-choices');
  let selected = REGIONS[0];
  function showRegion(region) {
    selected = region;
    const image = document.getElementById('region-art');
    image.src = `/media/${MEDIA[region.id].file}.webp`;
    image.alt = `${region.name} world artwork. ${region.description}`;
    document.getElementById('region-art-name').textContent = region.name;
    document.getElementById('region-description').textContent = region.description;
    document.getElementById('region-cinematic').textContent = `Watch ${region.name} cinematic`;
    for (const button of choices.children) button.setAttribute('aria-pressed', String(button.dataset.region === region.id));
  }
  function openCinematic(region) {
    const source = MEDIA[region.id];
    document.getElementById('cinematic-title').textContent = region.name;
    status.textContent = '';
    video.poster = `/media/${source.file}.webp`;
    video.src = `/media/${source.file}-video.mp4`;
    dialog.showModal();
    // Playback and its download begin only after this explicit viewer action.
    video.play().catch(() => {
      if (!dialog.open) return;
      status.textContent = video.error ? 'This cinematic could not load. Close it and try again.' : 'Press Play to start the cinematic.';
    });
  }
  function stop() { video.pause(); video.removeAttribute('src'); video.load(); }
  dialog.addEventListener('close', stop);
  document.getElementById('close-cinematic').addEventListener('click', () => dialog.close());
  video.addEventListener('error', () => { if (dialog.open) status.textContent = 'This cinematic could not load. Close it and try again.'; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) video.pause(); });
  window.addEventListener('pagehide', stop);
  document.getElementById('welcome-cinematic').addEventListener('click', () => openCinematic(REGIONS[0]));
  document.getElementById('region-cinematic').addEventListener('click', () => openCinematic(selected));
  for (const region of REGIONS) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = region.name; button.dataset.region = region.id;
    button.title = `View ${region.name} artwork and cinematic`;
    button.addEventListener('click', () => showRegion(region)); choices.append(button);
  }
  return {
    show(region, speaking = false) {
      showRegion(region);
      const figure = document.getElementById('character-art'); figure.hidden = !speaking;
      if (speaking) {
        const image = document.getElementById('character-image');
        image.src = `/media/${MEDIA[region.id].portrait}.webp`;
        image.alt = `${region.npc.name}, ${region.npc.role}. Character artwork.`;
      }
    },
  };
}

// Module initialization also serves the sign-in screen before any world is started.
export const worldMedia = initWorldMedia();
