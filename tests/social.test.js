import { describe, expect, it } from 'vitest';
import { parseSocial, SOCIAL_EMOTES, SOCIAL_PINGS } from '../src/network/protocol.js';

describe('parseSocial', () => {
  it('accepts every listed emote and ping and returns only kind, id and from', () => {
    for (const id of SOCIAL_EMOTES) expect(parseSocial({ kind: 'emote', id, from: 'p1' })).toEqual({ kind: 'emote', id, from: 'p1' });
    for (const id of SOCIAL_PINGS) expect(parseSocial({ kind: 'ping', id, from: 'p1' })).toEqual({ kind: 'ping', id, from: 'p1' });
  });
  it('drops unknown ids, swapped kinds, free text, extra fields and non-objects', () => {
    for (const bad of [
      { kind: 'emote', id: 'meet me at the park', from: 'p1' }, { kind: 'emote', id: 'come', from: 'p1' },
      { kind: 'ping', id: 'wave', from: 'p1' }, { kind: 'text', id: 'wave', from: 'p1' },
      { kind: 'emote', id: 'wave', from: 'p1', text: 'hi' }, { kind: 'emote', id: 'wave' },
      { kind: 'emote', id: 'toString', from: 'p1' }, { kind: 'emote', id: ['wave'], from: 'p1' },
      { kind: 'emote', id: 'wave', from: 'x'.repeat(65) }, null, 'wave', [], 7,
    ]) expect(parseSocial(bad)).toBeNull();
  });
});
