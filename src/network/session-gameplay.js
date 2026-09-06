import { storyAction } from '../game/story.js';
import { campAction, ITEM_IDS } from '../game/camp.js';
import { BLOCKS } from '../constants/blocks.js';
import { MAX_INTENT_IDS, MAX_SNAPSHOT_ENTRIES, validateMutationIntent, validateSnapshot } from './protocol.js';

const SNAPSHOT_CHUNK_BYTES = 12000;
const MAX_SNAPSHOT_CHUNKS = 2048;

export function handleIntent(session, from, intent) {
  if (intent?.kind === 'creature' && session.creatureSystem) return session.creatureSystem.handle(from, intent);
  const reject = (reason) => {
    if (from === session.playerId) session.options.onRejected?.(reason);
    else session.transport.sendControl(from, { t: 'intent-rejected', reason });
    return false;
  };
  if (!session.ready) return reject('World is still connecting');
  const position = from === session.playerId
    ? session.options.getLocalState?.()?.position : session.remoteStates.get(from)?.position;
  const result = validateMutationIntent(intent, {
    epoch: session.epoch,
    worldHeight: session.options.worldHeight ?? 64,
    allowedBlockIds: session.options.allowedBlockIds ?? new Set([0, ...ITEM_IDS]),
    seenIntentIds: session.ledger.seenIntentIds,
    playerPosition: position,
    mutationTimes: session.mutationTimes.get(from) ?? [],
  });
  if (!result.ok) return reject(result.reason);
  if (session.ledger.seenIntentIds.size >= MAX_INTENT_IDS) return reject('This expedition has reached its action limit');
  const isBlock = !intent.kind || intent.kind === 'block';
  const key = `${intent.x},${intent.y},${intent.z}`;
  if (isBlock && !session.ledger.overrides.has(key)
    && session.ledger.overrides.size >= MAX_SNAPSHOT_ENTRIES) return reject('This expedition has reached its building limit');
  const currentBlock = !isBlock ? undefined
    : session.ledger.overrides.get(key)?.blockId ?? session.options.getBlock?.(intent.x, intent.y, intent.z);
  if (intent.kind === 'story' && session.generation < 2) return reject('Start a new world to explore the settlements');
  let action = intent.kind === 'story'
    ? storyAction(session.ledger.story, session.ledger.supplies, intent.targetId, position, session.mode)
    : campAction(session.ledger.supplies, intent, currentBlock, session.mode);
  if (!action.ok) return reject(action.reason);
  const treeBlocks = isBlock && intent.blockId === 0
    ? (session.options.getTreeBlocks?.(intent.x, intent.y, intent.z) ?? [])
      .filter(block => block.x !== intent.x || block.y !== intent.y || block.z !== intent.z) : [];
  for (const block of treeBlocks) {
    const id = session.ledger.overrides.get(`${block.x},${block.y},${block.z}`)?.blockId
      ?? session.options.getBlock?.(block.x, block.y, block.z);
    // Gather the tree's timber; falling foliage returns to the forest floor.
    if (id !== BLOCKS.WOOD_LOG) continue;
    action = campAction(action.supplies, { blockId: 0 }, id, session.mode);
    if (!action.ok) return reject(action.reason);
  }
  // Only explicit fields cross the commit boundary; crafting never becomes a block override.
  const commit = {
    epoch: session.epoch, seq: session.ledger.lastSeq + 1, intentId: intent.intentId,
    supplies: action.supplies, story: action.story ?? { ...session.ledger.story },
    ...(intent.kind === 'story' ? { kind: 'story', targetId: intent.targetId }
      : intent.kind === 'craft' ? { kind: 'craft', recipeId: intent.recipeId }
      : { kind: 'block', x: intent.x, y: intent.y, z: intent.z, blockId: intent.blockId,
        ...(treeBlocks.length ? { treeBlocks } : {}) }),
  };
  if (!session.ledger.apply(commit)) return reject('Action could not be applied');
  session.mutationTimes.set(from, result.mutationTimes);
  session.options.onSupplies?.(session.ledger.supplies);
  session.transport.broadcastControl({ t: 'commit', commit });
  return true;
}

export function sendSnapshot(session, channel) {
  const raw = JSON.stringify(session.ledger.snapshot());
  const total = Math.max(1, Math.ceil(raw.length / SNAPSHOT_CHUNK_BYTES));
  const snapshotId = `${session.epoch}:${crypto.randomUUID()}`;
  // ponytail: full snapshots fit bounded eight-player worlds; add chunk interest filtering beyond 20,000 edits.
  for (let index = 0; index < total; index++) {
    channel.send(JSON.stringify({
      t: 'snapshot', snapshotId, index, total,
      data: raw.slice(index * SNAPSHOT_CHUNK_BYTES, (index + 1) * SNAPSHOT_CHUNK_BYTES),
    }));
  }
}

export function receiveSnapshot(session, message) {
  if (typeof message.snapshotId !== 'string' || message.snapshotId.length > 160
    || !Number.isInteger(message.index) || !Number.isInteger(message.total)
    || message.total < 1 || message.total > MAX_SNAPSHOT_CHUNKS
    || message.index < 0 || message.index >= message.total
    || typeof message.data !== 'string' || message.data.length > SNAPSHOT_CHUNK_BYTES) return;
  if (!session.snapshotParts.has(message.snapshotId)) {
    if (session.snapshotParts.size >= 2) session.snapshotParts.delete(session.snapshotParts.keys().next().value);
    session.snapshotParts.set(message.snapshotId, { total: message.total, parts: Array(message.total).fill(null) });
  }
  const snapshot = session.snapshotParts.get(message.snapshotId);
  if (snapshot.total !== message.total) return;
  snapshot.parts[message.index] = message.data;
  if (!snapshot.parts.every((part) => typeof part === 'string')) return;
  session.snapshotParts.delete(message.snapshotId);
  try {
    const parsed = JSON.parse(snapshot.parts.join(''));
    if (!validateSnapshot(parsed) || (parsed.generation ?? 1) !== (session.generation ?? 1)) throw new Error('Invalid snapshot');
    if (parsed.epoch < session.ledger.epoch
      || (parsed.epoch === session.ledger.epoch && parsed.lastSeq < session.ledger.lastSeq)) return;
    if (!session.ready) { session.initialSnapshot = parsed; return; }
    if (!session.ledger.loadSnapshot(parsed)) throw new Error('Invalid snapshot');
    session.snapshotReady = true;
    session.options.onSupplies?.(session.ledger.supplies);
    session.options.onSnapshot?.();
  } catch {
    session._status('rtc-failure', 'World synchronization failed. Reconnect to the room.');
  }
}
