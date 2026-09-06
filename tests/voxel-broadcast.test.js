import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { MultiplayerSession } from '../src/network/session.js';
import { VoxelBroadcast } from '../src/network/voxel-broadcast.js';

it('accepts only current admitted peers and host commits, ignoring duplicates and retired rooms', () => {
  const s = { roomCode:'ABCDEF', ready:true, playerId:'guest',hostId:'host',role:'guest',members:[{playerId:'host'},{playerId:'other'}],
    ledger:{seenIntentIds:new Set()},_onControl:vi.fn() };
  const transport = Object.assign(Object.create(VoxelBroadcast.prototype),{session:s,room:s.roomCode,closed:false});
  const commit={t:'commit',commit:{kind:'block'}};
  transport.receive({from:'other',message:commit});
  transport.receive({from:'host',message:{t:'intent',intent:{kind:'block'}}});
  expect(s._onControl).not.toHaveBeenCalled();
  transport.receive({from:'host',message:commit});
  expect(s._onControl).toHaveBeenCalledTimes(1);
  expect(s._onControl).toHaveBeenCalledWith('host',commit);
  s.role='host'; s.playerId='host'; s.ledger.seenIntentIds.add('used');
  transport.receive({from:'other',message:{t:'intent',intent:{kind:'block',intentId:'used'}}});
  expect(s._onControl).toHaveBeenCalledTimes(1);
  transport.closed=true; transport.receive({from:'other',message:{t:'intent',intent:{kind:'block',intentId:'new'}}});
  expect(s._onControl).toHaveBeenCalledTimes(1);
});

it.skipIf(process.env.BLOCKTOPIA_LOCAL_SAVES_TEST !== '1')('delivers authenticated transient voxel Broadcast and rejects sender spoofing', async () => {
  const env=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>/^VITE_SUPABASE_/.test(l))
    .map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
  expect(['localhost','127.0.0.1']).toContain(new URL(env.VITE_SUPABASE_URL).hostname);
  const clients=[0,1].map(()=>createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY||env.VITE_SUPABASE_ANON_KEY,
    {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}));
  const peers=[randomUUID(),randomUUID()],room='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code=Array.from({length:6},()=>room[Math.floor(Math.random()*room.length)]).join('');
  const transports=[];
  try {
    for(let i=0;i<2;i++) {
      const {data,error}=await clients[i].auth.signUp({email:`voxel-${randomUUID()}@example.com`,password:`Check-${randomUUID()}!`});
      expect(error).toBeNull();
      await clients[i].realtime.setAuth(data.session.access_token);
      const registered=await clients[i].from('blocktopia_room_actors').insert({room_code:code,peer_id:peers[i],user_id:data.user.id});
      expect(registered.error).toBeNull();
      const s={supabase:clients[i],playerId:peers[i],hostId:peers[0],role:i?'guest':'host',roomCode:code,
        ready:true,members:peers.map(playerId=>({playerId})),ledger:{seenIntentIds:new Set()},_onControl:vi.fn()};
      transports.push(new VoxelBroadcast(s));
    }
    await vi.waitFor(()=>expect(transports.every(t=>t.ready)).toBe(true),{timeout:15000});
    const intent={t:'intent',intent:{kind:'block',intentId:'broadcast-check',x:1,y:25,z:2,blockId:0,epoch:1}};
    expect(await transports[1].send(intent)).toBe(true);
    await vi.waitFor(()=>expect(transports[0].session._onControl).toHaveBeenCalledWith(peers[1],intent),{timeout:8000});
    const forged=await clients[1].rpc('broadcast_voxel_event',{room:code,peer:peers[0],message:intent});
    expect(forged.error).toBeTruthy();
    const direct = await transports[1].channel.send({type:'broadcast',event:'voxel',payload:{from:peers[0],message:intent}});
    expect(direct).not.toBe('ok');
    const commit={t:'commit',commit:{kind:'block',x:1,y:25,z:2,blockId:0,epoch:1,seq:1,intentId:'broadcast-check'}};
    expect(await transports[0].send(commit)).toBe(true);
    await vi.waitFor(()=>expect(transports[1].session._onControl).toHaveBeenCalledWith(peers[0],commit),{timeout:8000});
  } finally {
    for(const transport of transports) transport.close();
    for(const client of clients) {
      await client.from('blocktopia_room_actors').delete().eq('room_code',code);
      await client.removeAllChannels(); await client.auth.signOut();
    }
  }
},40000);

it('deduplicates the second voxel transport delivery without changing direct mutation rejection', () => {
  const session = Object.assign(Object.create(MultiplayerSession.prototype), {
    role: 'host', ledger: { seenIntentIds: new Set(['voxel']) }, _handleIntent: vi.fn(),
  });
  session._onControl('guest', { t:'intent',intent:{kind:'block',intentId:'voxel'} });
  expect(session._handleIntent).not.toHaveBeenCalled();
  session._onControl('guest', { t:'intent',intent:{kind:'story',intentId:'voxel'} });
  expect(session._handleIntent).toHaveBeenCalledTimes(1);
});
