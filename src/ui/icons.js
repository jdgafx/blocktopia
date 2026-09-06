// Small local SVG illustrations: no image requests or external icon fonts.
const drawings = {
  wildlife: '<path fill="#91c8a0" d="M19 36c-7 6-10 16-3 19 5 3 11-2 16-2s11 5 16 2c7-3 4-13-3-19-8-7-18-7-26 0Z"/><g fill="#dfbe7b"><ellipse cx="14" cy="26" rx="6" ry="9" transform="rotate(-25 14 26)"/><ellipse cx="27" cy="17" rx="6" ry="9"/><ellipse cx="41" cy="18" rx="6" ry="9"/><ellipse cx="52" cy="29" rx="6" ry="9" transform="rotate(25 52 29)"/></g>',
  bag: '<rect x="23" y="8" width="18" height="15" rx="6" fill="none" stroke="#e4bc79" stroke-width="5"/><rect x="14" y="19" width="36" height="39" rx="9" fill="#c69b5d"/><path d="M14 28h36v12H14" fill="#eccb8d"/><rect x="21" y="41" width="22" height="12" rx="3" fill="#816542"/><path d="M24 29v9m16-9v9" stroke="#344c40" stroke-width="4"/>',
  companions: '<path d="M10 48V29l8-12 9 9h14l9-9 5 12v19H10Z" fill="#9ac3ae"/><path d="M32 40c-14-12-20 3 0 15 20-12 14-27 0-15" fill="#ea9a83"/><circle cx="20" cy="32" r="2" fill="#20352c"/><circle cx="45" cy="32" r="2" fill="#20352c"/>',
  camp: '<path d="m13 56 39-12M13 44l39 12" stroke="#bb8b57" stroke-width="7" stroke-linecap="round"/><path d="M31 5c6 13 19 19 16 32-3 18-31 17-33 0-1-10 10-19 17-32" fill="#e99355"/><path d="M32 25c3 7 10 10 8 16-3 9-17 8-17-1 0-5 6-11 9-15" fill="#ffdc89"/>',
  journal: '<path d="m7 15 17-6 17 6 16-6v41l-16 6-17-6-17 6Z" fill="#e2d4ac"/><path d="M24 9v41m17-35v41" stroke="#b2a27d" stroke-width="2"/><path d="m13 39 13-11 12 9 12-16" fill="none" stroke="#4f896d" stroke-width="3" stroke-dasharray="4 3"/><circle cx="50" cy="21" r="5" fill="#d17459"/>',
  graphics: '<rect x="6" y="11" width="52" height="37" rx="5" fill="#a9c8b9"/><path d="M11 42 25 25l10 11 7-8 11 14" fill="#4a8065"/><circle cx="44" cy="21" r="6" fill="#f0cc75"/><path d="M32 48v8m-12 0h24" stroke="#a9c8b9" stroke-width="4"/>',
  save: '<path d="M11 8h35l8 8v40H11Z" fill="#8ebbae"/><path d="M20 8h23v19H20Z" fill="#e5d7b2"/><path d="M23 39h20v17H23Z" fill="#3c6557"/><path d="m26 44 5 5 9-10" fill="none" stroke="#e7d6a5" stroke-width="3"/>',
  controls: '<path d="M19 20h26c10 0 18 28 9 31-6 2-11-9-16-9H26c-5 0-10 11-16 9-9-3-1-31 9-31Z" fill="#a9c8b9"/><path d="M20 27v14m-7-7h14" stroke="#345b4a" stroke-width="4"/><circle cx="44" cy="29" r="3" fill="#cf825f"/><circle cx="49" cy="37" r="3" fill="#e9c779"/>',
  menu: '<rect x="9" y="10" width="46" height="44" rx="7" fill="#dec897"/><path d="M20 22h24M20 32h24M20 42h16" stroke="#526e58" stroke-width="5" stroke-linecap="round"/>',
  friends: '<circle cx="23" cy="21" r="10" fill="#eccb91"/><circle cx="46" cy="24" r="8" fill="#95bcaa"/><path d="M6 53V42c0-16 34-16 34 0v11" fill="#eccb91"/><path d="M43 37c11-5 17 3 17 10v6H45Z" fill="#95bcaa"/>',
  play: '<circle cx="32" cy="32" r="25" fill="#97c7a0"/><path d="m26 18 20 14-20 14Z" fill="#223c30"/>',
  exit: '<path d="M13 9h26v46H13Z" fill="#c6b48c"/><path d="M29 32h28m-9-9 9 9-9 9" fill="none" stroke="#e6af76" stroke-width="5" stroke-linecap="round"/><path d="M13 9 31 15v40l-18-6Z" fill="#829f8b"/>',
  grass: '<path d="m7 26 25-13 25 13-25 14Z" fill="#8cba65"/><path d="M7 26v23l25 13V40Z" fill="#927049"/><path d="m32 40 25-14v23L32 62Z" fill="#705536"/><path d="m20 26-3-13 10 10 6-18 4 16 11-7-5 14" fill="#b1d47c"/>',
  dirt: '<path d="m7 24 25-13 25 13-25 14Z" fill="#bb9163"/><path d="M7 24v26l25 12V38Z" fill="#967049"/><path d="m32 38 25-14v26L32 62Z" fill="#705138"/><path d="m16 40 6 3m19 3 6-3" stroke="#d4ad7b" stroke-width="3"/>',
  stone: '<path d="m8 44 8-23 21-10 17 19-4 23-30 4Z" fill="#a7b7af"/><path d="m16 21 15 17 23-8-17-19Z" fill="#d1dad0"/><path d="m31 38 19 15-30 4Z" fill="#718a7e"/>',
  wood: '<path d="m15 26 29-15 13 20-28 22Z" fill="#ac7846"/><path d="m27 30 22-14m-15 24 19-16" stroke="#6b492f" stroke-width="3"/><ellipse cx="21" cy="42" rx="12" ry="16" transform="rotate(-30 21 42)" fill="#e8c48a"/><ellipse cx="21" cy="42" rx="6" ry="10" transform="rotate(-30 21 42)" fill="none" stroke="#b88a53" stroke-width="2"/>',
  leaf: '<path d="M12 49C-2 22 26 5 56 8c3 31-19 51-40 40Z" fill="#8abd75"/><path d="m9 57 37-38M23 41l-4-15m15 3 12 2" fill="none" stroke="#3c7655" stroke-width="3" stroke-linecap="round"/>',
  sand: '<path d="m4 52 18-28 13-8 24 36Z" fill="#e4c68d"/><path d="m22 24 8 11 5-19 24 36H36Z" fill="#bd9f6c"/><path d="M12 55h41" stroke="#f0d9a6" stroke-width="3"/>',
  gravel: '<g fill="#b4bcb0" stroke="#526b5b" stroke-width="2"><path d="m7 35 8-10 14 8-2 16-17 2Z"/><path d="m32 14 15-4 11 14-15 10-12-9Z"/><path d="m35 41 13-5 11 14-10 9-16-6Z"/></g>',
  planks: '<g fill="#c3935c" stroke="#765138" stroke-width="2"><path d="m5 24 37-16 16 9-38 18Z"/><path d="m5 36 37-16 16 9-38 18Z"/><path d="m5 48 37-16 16 9-38 18Z"/></g><path d="m17 48 29-13M17 36l29-13" stroke="#e5bc83" stroke-width="2"/>',
  bricks: '<rect x="7" y="13" width="50" height="41" rx="3" fill="#a5b4a8"/><path d="M7 27h50M7 41h50M24 13v14m18 0v14M24 41v13" stroke="#4c6656" stroke-width="3"/>',
  glass: '<path d="M12 9h40v46H12Z" fill="#9cd2d0" fill-opacity=".5" stroke="#b9e2db" stroke-width="3"/><path d="m18 30 15-15m-9 28 19-19" stroke="#d7f0e6" stroke-width="3"/>',
  coal: '<path d="m8 44 8-23 21-10 17 19-4 23-30 4Z" fill="#72887c"/><path d="m19 26 10-5 6 12-12 7Zm17 15 8-7 5 10-7 6Z" fill="#23362d"/>',
  iron: '<path d="m8 44 8-23 21-10 17 19-4 23-30 4Z" fill="#87988c"/><path d="m19 26 10-5 6 12-12 7Zm17 15 8-7 5 10-7 6Z" fill="#d1a685"/>',
  raw: '<path d="M12 17c15-15 44 0 44 18 0 13-14 23-25 17C21 46-1 36 12 17Z" fill="#d78276"/><path d="M16 21c10-9 32 0 34 13s-11 16-21 10-22-14-13-23Z" fill="none" stroke="#f1baa0" stroke-width="3"/><ellipse cx="35" cy="29" rx="7" ry="5" fill="#f3d7b0"/>',
  cooked: '<path d="m38 41 12 11m-3 2 7-7" stroke="#ebd8ac" stroke-width="8" stroke-linecap="round"/><path d="M12 17c14-12 39 3 34 20-5 20-28 12-35 2-6-9-6-15 1-22Z" fill="#b97a44"/><path d="m17 20 14 20m-4-22 10 15" stroke="#754a2e" stroke-width="4"/>',
  hide: '<path d="m19 9 13 7 13-7 10 12-8 10 8 13-12 12-11-6-11 6L9 44l8-13-8-10Z" fill="#bd915a"/><path d="m22 18 10 5 10-5M22 47l10-4 10 4" fill="none" stroke="#e5bd85" stroke-width="2" stroke-dasharray="3 3"/>',
  feather: '<path d="M13 50C6 31 32 4 54 7c3 24-21 47-41 43" fill="#e6d6ae"/><path d="m9 57 37-38m-23 23 16-1m-9-8 1-13" fill="none" stroke="#9c9e7d" stroke-width="3"/>',
  scales: '<g fill="#8ac0ac" stroke="#3c7866" stroke-width="2"><path d="M22 10h22c0 22-22 22-22 0Z"/><path d="M8 25h24c0 24-24 24-24 0Z"/><path d="M32 25h24c0 24-24 24-24 0Z"/><path d="M20 40h24c0 24-24 24-24 0Z"/></g>',
  forage: '<path d="M32 57V20m0 23L15 30m17 4 17-14" stroke="#80a36b" stroke-width="4"/><path d="M29 35C9 37 7 20 9 14c18 0 23 10 20 21M34 27C31 11 46 7 56 10c0 14-9 20-22 17" fill="#9fca78"/><g fill="#d99b79"><circle cx="23" cy="46" r="6"/><circle cx="36" cy="45" r="6"/><circle cx="29" cy="52" r="6"/></g>',
};
const itemIcons = {1:'grass',2:'dirt',3:'stone',4:'wood',5:'leaf',6:'sand',7:'gravel',8:'planks',9:'bricks',10:'glass',11:'coal',12:'iron',100:'raw',101:'cooked',102:'hide',103:'feather',104:'scales',105:'forage'};
export function icon(name) {
  return `<svg class="menu-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${drawings[name] ?? drawings.bag}</svg>`;
}
export function itemIcon(id) { return icon(itemIcons[id]); }

export function decorateMenus() {
  const play = document.getElementById('click-to-play');
  play.insertAdjacentHTML('afterbegin', icon('play'));
  play.classList.add('illustrated-control');
  for (const [selector, name] of Object.entries({
    '#graphics-panel > summary':'graphics', '#camp-panel > summary':'camp', '#save-panel > summary':'save',
    '#saved-panel > summary':'journal', '#front-controls > summary':'controls', '#play-gate > details:last-of-type > summary':'controls',
    '#adventure-dialog > details > summary':'journal', '#game-menu':'menu', '#game-controls':'controls', '#open-camp':'camp', '#open-journal':'journal',
    '#create-room':'play', '#join-room':'friends', '#copy-invite':'friends', '#leave-room':'exit', '#save-world':'save',
  })) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const text = document.createElement('span'); text.textContent = el.textContent;
    el.innerHTML = icon(name); el.append(text); el.classList.add('illustrated-control');
  }
}
