import { ExpeditionSaves } from '../game/saves.js';

// Each account saves its own expedition. Continuing creates a fresh shared room.
export function initExpeditions(client, { open, getSnapshot, canSave }) {
  const list = document.getElementById('saved-worlds');
  const status = document.getElementById('save-status');
  const libraryStatus = document.getElementById('library-status');
  const saveButton = document.getElementById('save-world');
  const copyButton = document.getElementById('save-copy');
  let api, userId, current, active, pending, timer, saving, recoveryKey, recoveryRaw;
  let opening = false, safeReload = false;
  const tabId = sessionStorage.getItem('blocktopia-player-id') || crypto.randomUUID();
  let version = 0, savedVersion = 0, conflict = false;
  const draftPrefix = () => `blocktopia-expedition-draft:${userId}:`;
  const draftKey = () => `${draftPrefix()}${tabId}`;
  const capture = () => ({ name: document.getElementById('save-name').value.trim() || 'My expedition',
    seed: active.seed, mode: active.mode, snapshot: getSnapshot() });
  const dirty = () => Boolean(active) && version !== savedVersion;
  function show(message, error = false) {
    status.textContent = message;
    status.dataset.state = error ? 'error' : 'ready';
    document.getElementById('save-indicator').textContent = message;
  }
  function stash() {
    if (!dirty()) return true;
    if (!userId || !active || !canSave()) return false;
    try { localStorage.setItem(draftKey(), JSON.stringify({ ...capture(), id: current?.id, revision: current?.revision })); return true; }
    catch { show('Browser backup unavailable. Keep this tab open until your account save succeeds.', true); return false; }
  }
  function clearDraft() {
    try {
      localStorage.removeItem(draftKey());
      if (recoveryKey && localStorage.getItem(recoveryKey) === recoveryRaw) localStorage.removeItem(recoveryKey);
      recoveryKey = recoveryRaw = null;
    } catch {}
  }
  async function refresh() {
    if (!api) return;
    const requestApi = api;
    libraryStatus.textContent = 'Loading saved expeditions…';
    try {
      const rows = await requestApi.list();
      if (requestApi !== api) return;
      list.replaceChildren();
      for (const row of rows) {
        const item = document.createElement('div'); item.className = 'saved-world';
        const title = document.createElement('strong'); title.textContent = row.name;
        const info = document.createElement('small');
        info.textContent = `${row.mode === 'creative' ? 'Creative' : 'Expedition'} · ${new Date(row.updated_at).toLocaleDateString()}`;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary';
        button.textContent = 'Continue'; button.title = `Continue ${row.name} in a new room`;
        button.addEventListener('click', async () => {
          if (opening) return;
          opening = true; document.getElementById('room-lobby').inert = true;
          button.disabled = true;
          try {
            const save = await requestApi.load(row.id);
            if (requestApi !== api) return;
            pending = save;
            const opened = await open(save);
            if (!opened) pending = null;
          } catch (error) { libraryStatus.textContent = error.message; pending = null; }
          finally { button.disabled = false; opening = false; document.getElementById('room-lobby').inert = false; }
        });
        item.append(title, info, button); list.append(item);
      }
      libraryStatus.textContent = rows.length ? 'Continue opens a new room with your saved terrain and camp supplies.' : 'Your expeditions will appear here after you start playing.';
      const drafts = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key.startsWith(draftPrefix())) {
            try { const raw = localStorage.getItem(key); drafts.push({ ...JSON.parse(raw), _draftKey: key, _draftRaw: raw }); } catch {}
          }
        }
      } catch {}
      for (const draft of drafts) if (draft?.snapshot && ['expedition', 'creative'].includes(draft.mode) && Number.isInteger(draft.seed)) {
        const recover = document.createElement('button'); recover.type = 'button'; recover.className = 'secondary';
        recover.textContent = 'Recover unsaved expedition'; recover.title = 'Open your browser backup as a separate saved copy';
        recover.addEventListener('click', async () => {
          if (opening) return;
          opening = true; document.getElementById('room-lobby').inert = true;
          recover.disabled = true;
          pending = { ...draft, id: undefined, revision: undefined, name: `${draft.name || 'Expedition'} recovered`.slice(0, 48) };
          try { if (!await open(pending)) pending = null; }
          catch (error) { libraryStatus.textContent = error.message; pending = null; }
          finally { recover.disabled = false; opening = false; document.getElementById('room-lobby').inert = false; }
        });
        list.prepend(recover);
      }
    } catch (error) { if (requestApi === api) libraryStatus.textContent = error.message; }
  }
  function markDirty() {
    if (!active) return;
    version++;
    if (!conflict) show(canSave() ? 'Unsaved changes' : 'Waiting for world sync…');
    clearTimeout(timer);
    timer = setTimeout(() => { stash(); flush().catch(() => {}); }, 800);
  }
  async function flush() {
    if (saving) { await saving; if (dirty()) return flush(); return; }
    if (!dirty()) return;
    if (!canSave()) throw new Error('Wait for world synchronization before saving.');
    if (conflict) throw new Error('This save changed in another session. Save a separate copy to keep these changes.');
    stash();
    const writtenVersion = version;
    const data = capture();
    saveButton.disabled = true;
    show('Saving expedition…');
    saving = (async () => {
      try {
        current = current?.id ? await api.save(current.id, current.revision, data) : await api.create(data);
        savedVersion = writtenVersion;
        if (!dirty()) { clearDraft(); show('Expedition saved'); }
        else { stash(); show('Saving latest changes…'); }
      } catch (error) {
        conflict = error.code === 'SAVE_CONFLICT';
        copyButton.hidden = !conflict;
        show(conflict ? 'Save changed elsewhere. Save a separate copy to keep your work.' : `${error.message} Your changes are still open. Retry Save.`, true);
        throw error;
      } finally { saving = null; saveButton.disabled = false; }
    })();
    await saving;
    if (dirty()) return flush();
  }
  saveButton.addEventListener('click', () => flush().catch(error => show(error.message, true)));
  copyButton.addEventListener('click', () => {
    current = null; conflict = false; copyButton.hidden = true;
    document.getElementById('save-name').value = `${capture().name} copy`.slice(0, 48);
    markDirty(); flush().catch(error => show(error.message, true));
  });
  document.getElementById('save-name').addEventListener('change', markDirty);
  document.getElementById('refresh-saves').addEventListener('click', refresh);
  window.addEventListener('beforeunload', event => {
    if (!dirty() || safeReload) return;
    stash(); event.preventDefault(); event.returnValue = '';
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && dirty()) { stash(); flush().catch(() => {}); } });
  return {
    setUser(user) {
      if (user?.id === userId) return;
      userId = user?.id; api = userId ? new ExpeditionSaves(client, userId) : null;
      if (api) refresh(); else list.replaceChildren();
    },
    begin(room) {
      active = room; current = pending?.id ? pending : null;
      recoveryKey = pending?._draftKey; recoveryRaw = pending?._draftRaw;
      document.getElementById('save-name').value = pending?.name || document.getElementById('world-name').value.trim() || `Camp ${room.roomCode}`;
      pending = null; version = 0; savedVersion = 0; conflict = false; markDirty();
    },
    markDirty, flush,
    prepareReload() { safeReload = stash(); return safeReload; },
    get dirty() { return dirty(); },
  };
}
