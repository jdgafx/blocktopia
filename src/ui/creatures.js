import * as THREE from 'three';
import { icon, itemIcon } from './icons.js';
import { ITEM_DEFS, PROVISIONS, SUPPLY_IDS } from '../game/items.js';
import { raycast } from '../engine/raycast.js';
import { SPECIES } from '../game/creature-species.js';

export function initCreatureUI(session, player, visuals, world, actorId) {
  const style = document.createElement('style');
  style.textContent = `#creature-vitals{position:fixed;left:12px;top:76px;background:#15251ee8;padding:6px 9px;border-radius:4px;font-size:12px}#creature-hurt{position:fixed;inset:0;pointer-events:none;box-shadow:inset 0 0 80px #bd662c;opacity:0;z-index:25}@media(max-width:600px){#creature-vitals{top:216px;max-width:145px}}#creature-hud{position:fixed;left:50%;bottom:76px;transform:translateX(-50%);max-width:calc(100vw - 30px);text-align:center;background:#15251ee8;padding:7px 14px;border-radius:6px;pointer-events:none;font-size:13px}#open-creatures{position:fixed;right:12px;top:278px;z-index:30;min-height:44px}#creature-panel{width:min(650px,calc(100vw - 28px));max-height:85vh;overflow:auto;background:#15241e;color:#f4ecd8;border:1px solid #92866b;border-radius:12px;padding:22px}#creature-panel::backdrop{background:#07110bd9}#creature-panel h2{font-size:24px;margin:0 0 12px}#creature-panel p{line-height:1.5}#creature-actions{display:flex;flex-wrap:wrap;gap:8px}#creature-panel button{min-height:44px;font-size:13px;padding:8px 12px}#creature-items{display:grid;gap:8px;margin:16px 0}.provision-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;border-top:1px solid #ffffff20;padding-top:8px}.provision-row>span{flex:1 1 200px}#creature-feedback{min-height:1.5em;color:#ffdb98}#creature-close{float:right}#creature-confirm{display:none;background:#512f23;padding:12px;margin:12px 0}#creature-confirm[data-open=true]{display:block}@media(max-width:600px){#open-creatures{top:278px;font-size:12px}#creature-hud{bottom:118px;width:max-content;font-size:11px}#creature-panel{padding:14px}}`;
  document.head.append(style);
  const vitals = document.createElement('div'); vitals.id = 'creature-vitals'; vitals.setAttribute('aria-label', 'Player health and nourishment');
  const hurt = document.createElement('div'); hurt.id = 'creature-hurt';
  const hud = document.createElement('div'); hud.id = 'creature-hud'; hud.hidden = true;
  const opener = document.createElement('button'); opener.id = 'open-creatures'; opener.innerHTML = `${icon('wildlife')}<span>Wildlife · C</span>`; opener.classList.add('illustrated-control'); opener.title = 'Inspect a nearby creature, manage provisions and command companions';
  const dialog = document.createElement('dialog'); dialog.id = 'creature-panel'; dialog.setAttribute('aria-labelledby', 'creature-title');
  dialog.innerHTML = `<header class="pack-header"><div><p class="eyebrow">Your expedition</p><h2 id="creature-title">Wildlife & supplies</h2></div><button id="creature-close" type="button" title="Close creatures and return to the play menu">Close ×</button></header>
    <div id="creature-player" class="pack-vitals"></div>
    <div class="pack-layout"><nav class="pack-nav" aria-label="Wildlife and supplies categories">
      <button type="button" data-pack="wildlife" aria-controls="pack-wildlife" aria-pressed="true" title="Inspect and care for the selected animal">${icon('wildlife')}<span>Wildlife</span></button>
      <button type="button" data-pack="supplies" aria-controls="pack-supplies" aria-pressed="false" title="See what you carry, share supplies and prepare food">${icon('bag')}<span>Supplies</span></button>
      <button type="button" data-pack="companions" aria-controls="pack-companions" aria-pressed="false" title="Find and command your animal companions">${icon('companions')}<span>Companions</span></button>
    </nav><div class="pack-content">
      <section id="pack-wildlife" aria-label="Wildlife"><h3>Nearby wildlife</h3><div id="creature-description"></div><div id="creature-actions"></div><div id="creature-confirm"><p id="creature-confirm-copy"></p><button type="button" id="creature-confirm-yes">Confirm</button> <button type="button" id="creature-confirm-no">Cancel</button></div></section>
      <section id="pack-supplies" aria-label="Supplies" hidden><h3>Your supplies</h3><p class="pack-hint">Store → shared camp · Take → your bag</p><div class="pack-tools"><button id="creature-forage" type="button" title="Gather fresh forage near leafy vegetation in Hearthwood">${icon('forage')}<span>Gather forage</span></button><button id="creature-cook" type="button" title="Use one raw meat and one wood log from shared camp">${icon('camp')}<span>Cook meat<small>1 raw meat + 1 camp log</small></span></button></div><div id="creature-items"></div></section>
      <section id="pack-companions" aria-label="Companions" hidden><h3>Your companions</h3><p class="pack-hint">Feed and care for wildlife to build trust.</p><div id="creature-companions"></div></section>
    </div></div><p id="creature-feedback" role="status" aria-live="polite"></p>`;
  document.getElementById('hud').append(hud, opener, vitals, hurt); document.body.append(dialog);
  const get = id => dialog.querySelector(`#${id}`);
  function showCategory(category) {
    dialog.querySelectorAll('[data-pack]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pack === category)));
    for (const name of ['wildlife', 'supplies', 'companions']) get(`pack-${name}`).hidden = name !== category;
  }
  dialog.querySelectorAll('[data-pack]').forEach(button => button.addEventListener('click', () => showCategory(button.dataset.pack)));
  let selected = null, aimed = null, lastRefresh = 0, pendingConfirm = null, lastHurtAt = 0;
  const state = () => session.ledger.creatures;
  const creature = () => state()?.creatures[selected];
  const metadata = c => c ? (SPECIES[c.species] ?? {}) : {};
  function submit(action, extra = {}) {
    get('creature-feedback').textContent = '';
    if (action === 'fight' && dialog.open) { dialog.close(); player.setActive(true); }
    session.submitMutation({ kind: 'creature', action, ...(selected ? { targetId: selected } : {}), ...extra });
    render();
  }
  function button(parent, label, title, action, extra = {}, disabled = false) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.disabled = disabled;
    b.addEventListener('click', () => {
      const c = creature();
      if (['fight', 'harvest'].includes(action) && c?.ownerId) {
        pendingConfirm = { action, targetId: selected }; get('creature-confirm').dataset.open = 'true';
        get('creature-confirm-copy').textContent = action === 'fight' ? 'Attack your companion? This causes injury and damages its trust.' : 'Harvest your defeated companion? This permanently removes its remains.';
      } else submit(action, extra);
    }); parent.append(b); return b;
  }
  function render() {
    const focused = dialog.contains(document.activeElement) ? { title: document.activeElement.title, text: document.activeElement.textContent } : null;
    const c = creature(), meta = metadata(c), p = state()?.players[actorId], bag = p?.bag ?? {};
    const health = Math.round(p?.health ?? 100), food = Math.round(p?.hunger ?? 100);
    get('creature-player').innerHTML = `<label>Health <strong>${health}/100</strong><meter min="0" max="100" low="25" value="${health}" aria-label="Health"></meter></label><label>Food <strong>${food}/100</strong><meter min="0" max="100" low="25" value="${food}" aria-label="Nourishment"></meter></label>`;
    const description = get('creature-description'); const helpOpen = description.querySelector('details')?.open; description.replaceChildren();
    const portrait = document.createElement('div'); portrait.className = 'wildlife-identity'; portrait.innerHTML = icon('wildlife');
    const name = document.createElement('div'); const heading = document.createElement('h4');
    heading.textContent = c ? meta.label ?? c.species : 'Choose an animal';
    const behavior = document.createElement('p'); behavior.textContent = c ? `${c.behavior} · ${c.temperament ?? meta.temperament ?? ''}` : 'Aim at an animal, then press C.';
    name.append(heading, behavior); portrait.append(name); description.append(portrait);
    if (c) {
      const stats = document.createElement('div'); stats.className = 'wildlife-stats';
      for (const [label, value, max] of [['Health', Math.ceil(c.health), meta.health ?? c.health], ['Trust', Math.round(c.trust?.[actorId] ?? 0), 100], ['Fear', Math.round(c.fear ?? 0), 100], ['Fed', Math.round(c.hunger), 100]]) {
        const stat = document.createElement('label'); stat.textContent = `${label} ${value}`;
        const meter = document.createElement('meter'); meter.min = 0; meter.max = Math.max(1, max); meter.value = value; meter.setAttribute('aria-label', label); stat.append(meter); stats.append(stat);
      }
      description.append(stats);
      const help = document.createElement('details'); help.open = Boolean(helpOpen); const summary = document.createElement('summary'); summary.textContent = 'About this animal';
      const copy = document.createElement('p'); copy.textContent = `${meta.help ?? ''} ${c.ownerId === actorId ? `Your companion · ${c.command}.` : c.ownerId ? 'Companion of another explorer.' : 'Offer its preferred food and gentle care to build trust.'}`;
      help.append(summary, copy); description.append(help);
    }
    const actions = get('creature-actions'); actions.replaceChildren();
    if (c && !c.harvested) {
      const protectedOther = c.ownerId && c.ownerId !== actorId;
      if (c.health > 0) {
        button(actions, 'Strike with axe', 'Attack this explicitly selected creature', 'fight', {}, protectedOther);
        const diet = meta.diet?.find(id => bag[id] > 0) ?? meta.diet?.[0] ?? PROVISIONS.FORAGE;
        button(actions, `Feed ${ITEM_DEFS[diet]?.name ?? 'preferred food'}`, 'Offer food from your carried provisions; repeated care builds trust', 'feed', { itemId: diet });
        button(actions, 'Gentle care', 'Use carried forage for gentle care, calming fear and tending wounds', 'care');
        if (c.ownerId === actorId) {
          button(actions, 'Follow', 'Ask your companion to follow and help you', 'follow');
          button(actions, 'Stay', 'Ask your companion to remain here', 'stay');
          button(actions, 'Release', 'Release ownership so this individual can live freely', 'release');
        }
      } else button(actions, 'Harvest with axe', 'Collect meat and species resources once, without graphic effects', 'harvest', {}, protectedOther);
    }
    if ((p?.health ?? 100) <= 0) button(actions, 'Recover', 'Recover after being knocked down', 'recover');
    const items = get('creature-items'); items.replaceChildren();
    for (const id of SUPPLY_IDS.filter(id => id >= 100 || bag[id] || session.ledger.supplies[id] || c?.bag?.[id])) {
      const row = document.createElement('div'); row.className = 'provision-row';
      const picture = document.createElement('span'); picture.className = 'item-picture'; picture.innerHTML = itemIcon(id);
      const label = document.createElement('span'); label.className = 'item-label';
      const name = document.createElement('strong'); name.textContent = ITEM_DEFS[id].name;
      const counts = document.createElement('small'); counts.textContent = `Bag ${bag[id] ?? 0}   ·   Camp ${session.ledger.supplies[id] ?? 0}${c?.ownerId === actorId ? `   ·   Companion ${c.bag?.[id] ?? 0}` : ''}`;
      label.append(name, counts); row.append(picture, label);
      const rowActions = document.createElement('div'); rowActions.className = 'item-actions'; row.append(rowActions);
      button(rowActions, 'Store 1', 'Deposit one carried item into shared camp storage', 'deposit', { itemId: id, count: 1 }, !bag[id]);
      button(rowActions, 'Take 1', 'Withdraw one item from shared camp into your carried provisions', 'withdraw', { itemId: id, count: 1 }, !session.ledger.supplies[id]);
      if ([101, 105].includes(id)) button(rowActions, 'Eat', 'Consume one carried food item', 'eat', { itemId: id }, !bag[id]);
      if (c?.ownerId === actorId && (meta.capacity ?? meta.carryCapacity ?? 0) > 0) {
        if (c.health > 0) button(rowActions, 'Load 1', 'Transfer one carried item to your nearby companion', 'load', { itemId: id, count: 1 }, !bag[id]);
        button(rowActions, 'Unload 1', 'Retrieve one item from your nearby companion', 'unload', { itemId: id, count: 1 }, !c.bag?.[id]);
      }
      items.append(row);
    }
    const companions = get('creature-companions'); companions.replaceChildren();
    const owned = Object.values(state()?.creatures ?? {}).filter(c => c.ownerId === actorId && !c.harvested);
    if (!owned.length) companions.textContent = 'No companions yet. Build trust through patient feeding and care.';
    for (const companion of owned) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = `${metadata(companion).label ?? companion.species} · ${Math.round(Math.hypot(companion.x-player.position.x, companion.z-player.position.z))} m · ${companion.command}`;
      b.title = 'Inspect this companion; commands require being nearby'; b.onclick = () => { selected = companion.id; showCategory('wildlife'); render(); }; companions.append(b);
    }
    if (focused?.title) [...dialog.querySelectorAll('button')].find(b => b.title === focused.title && b.textContent === focused.text)?.focus({ preventScroll: true });
  }
  function open() {
    selected = aimed; showCategory('wildlife'); document.exitPointerLock?.(); player.setActive(false); render();
    if (!dialog.open) dialog.showModal();
  }
  get('creature-close').onclick = () => dialog.close(); opener.onclick = open;
  get('creature-forage').onclick = () => submit('forage');
  get('creature-cook').onclick = () => { session.submitCraft('cook-meat'); render(); };
  get('creature-confirm-no').onclick = () => { pendingConfirm = null; get('creature-confirm').dataset.open = 'false'; };
  get('creature-confirm-yes').onclick = () => {
    if (pendingConfirm) submit(pendingConfirm.action, { targetId: pendingConfirm.targetId, confirm: true });
    pendingConfirm = null; get('creature-confirm').dataset.open = 'false';
  };
  dialog.addEventListener('close', () => { pendingConfirm = null; get('creature-confirm').dataset.open = 'false'; });
  document.addEventListener('keydown', e => {
    if (e.code === 'KeyC' && player.active && !e.repeat && !e.target.closest?.('input,textarea,select')) { e.preventDefault(); open(); }
  });
  player._creatureInteraction = (dt, breaking) => {
    if (!aimed) return false;
    player.targetBlock = null; player.breakProgress = 0;
    const c = state()?.creatures[aimed];
    if (breaking && c && !c.ownerId && c.health > 0) {
      player._creatureStrike = (player._creatureStrike ?? 0) + dt;
      if (player._creatureStrike >= .8) { player._creatureStrike = 0; session.submitMutation({ kind: 'creature', action: 'fight', targetId: aimed }); }
    } else player._creatureStrike = 0;
    return true;
  };
  return { render, reject(reason) { get('creature-feedback').textContent = reason; }, update(now) {
    const keeper = state()?.players[actorId];
    const vitalText = `Health ${Math.ceil(keeper?.health ?? 100)} · Food ${Math.round(keeper?.hunger ?? 100)}`;
    if (vitals.textContent !== vitalText) vitals.textContent = vitalText;
    if (keeper?.lastHurtAt > lastHurtAt) { lastHurtAt = keeper.lastHurtAt; hurt.animate([{ opacity: .8 }, { opacity: 0 }], { duration: 650 }); }
    if ((keeper?.health ?? 100) <= 0 && player.active) open();
    aimed = player.active ? visuals.target(player._camera, 6) : aimed;
    if (player.active && aimed) {
      const direction = new THREE.Vector3(); player._camera.getWorldDirection(direction);
      if (raycast(world, player._camera.position, direction, visuals.lastTargetDistance)) aimed = null;
    }
    const c = state()?.creatures[aimed]; hud.hidden = !player.active || !c;
    if (c) hud.textContent = `${metadata(c).label ?? c.species} · ${c.behavior} · ${Math.ceil(c.health)} health · C to interact${c.ownerId ? ' · Companion protected' : ''}`;
    if (now > lastRefresh) { lastRefresh = now + 500; if (dialog.open) render(); }
  }};
}
