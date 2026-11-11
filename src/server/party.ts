import type * as Party from "partykit/server";
import { DinoState, HarvestChunk, PartName, PlayerState, TruckState } from "../shared/types";

export default class BlocktopiaNextFableServer implements Party.Server {
  players: Map<string, PlayerState> = new Map();
  dinos: Map<string, DinoState> = new Map();
  chunks: Map<string, HarvestChunk> = new Map();
  truck: TruckState = {
    x: 0,
    y: 0,
    z: 35,
    rotY: Math.PI,
    headlightsOn: false,
    winchTargetChunkId: null,
    cargoItems: []
  };
  worldPhase: 'DAY_HUNT' | 'ECLIPSE_NIGHTFALL' | 'SANCTUARY_SAFE' = 'DAY_HUNT';
  tickTimer: ReturnType<typeof setInterval> | null = null;
  tickCount: number = 0;

  constructor(readonly room: Party.Room) {
    this.resetHuntEncounter();
  }

  resetHuntEncounter() {
    this.worldPhase = 'DAY_HUNT';
    this.dinos.clear();
    this.chunks.clear();
    this.truck.x = 0;
    this.truck.z = 35;
    this.truck.cargoItems = [];
    this.truck.winchTargetChunkId = null;

    // Spawn 60ft Voltaic Bio-Rex Titan + 65ft Obsidian Stego-Titan
    this.dinos.set("titan_rex_1", this.createTitanDino("titan_rex_1", "voltaic_rex", 0, -45));
    this.dinos.set("titan_stego_1", this.createTitanDino("titan_stego_1", "stego_titan", 45, -60));
  }

  createTitanDino(id: string, species: 'voltaic_rex' | 'stego_titan', x: number, z: number): DinoState {
    const isRex = species === 'voltaic_rex';
    return {
      id,
      species,
      x,
      y: 0,
      z,
      rotY: 0,
      hp: isRex ? 6000 : 7500,
      maxHp: isRex ? 6000 : 7500,
      aiState: 'ROAMING',
      targetPlayerId: null,
      carcassChopsRemaining: 5,
      parts: {
        Tail_Tip:     { name: 'Tail_Tip',     label: 'Spiked Tail Tip',    hp: 800,  maxHp: 800,  severed: false, dropsItem: 'prime_tail_steak',    weightClass: 'HEAVY_2HAND' },
        Tail_Upper:   { name: 'Tail_Upper',   label: 'Massive Tail Base',  hp: 1200, maxHp: 1200, severed: false, dropsItem: 'titan_tail_slab',     weightClass: 'HEAVY_2HAND' },
        Leg_L_Tendon: { name: 'Leg_L_Tendon', label: 'Left Leg Tendon',    hp: 650,  maxHp: 650,  severed: false, dropsItem: 'apex_achilles_tendon',weightClass: 'LIGHT' },
        Leg_R_Tendon: { name: 'Leg_R_Tendon', label: 'Right Leg Tendon',   hp: 650,  maxHp: 650,  severed: false, dropsItem: 'apex_achilles_tendon',weightClass: 'LIGHT' },
        Head_Armor:   { name: 'Head_Armor',   label: 'Armored Skull Crest',hp: 1400, maxHp: 1400, severed: false, dropsItem: 'tyrant_skull_plate',  weightClass: 'WINCH_ONLY' },
        Back_Plates:  { name: 'Back_Plates',  label: 'Obsidian Dorsal Fin',hp: 1100, maxHp: 1100, severed: false, dropsItem: 'obsidian_dorsal_fin', weightClass: 'HEAVY_2HAND' },
        Bio_Core:     { name: 'Bio_Core',     label: 'Voltaic Bio-Heart',  hp: 1800, maxHp: 1800, severed: false, dropsItem: 'voltaic_bio_heart',   weightClass: 'WINCH_ONLY' }
      }
    };
  }

  onConnect(conn: Party.Connection) {
    const player: PlayerState = {
      id: conn.id,
      name: `Hunter_${conn.id.slice(0, 4)}`,
      x: (Math.random() - 0.5) * 10,
      y: 0,
      z: 42,
      rotY: 0,
      grappledDinoId: null,
      grappledPart: null,
      carryingChunkId: null,
      flashlightOn: false,
      damageMultiplier: 1.0
    };
    this.players.set(conn.id, player);

    conn.send(JSON.stringify({
      type: "INIT_STATE",
      selfId: conn.id,
      worldPhase: this.worldPhase,
      players: Array.from(this.players.values()),
      dinos: Array.from(this.dinos.values()),
      chunks: Array.from(this.chunks.values()),
      truck: this.truck
    }));

    if (!this.tickTimer) {
      this.tickTimer = setInterval(() => this.serverTick(), 50); // 20Hz Authoritative Loop
    }
  }

  onClose(conn: Party.Connection) {
    const p = this.players.get(conn.id);
    if (p && p.carryingChunkId) {
      const c = this.chunks.get(p.carryingChunkId);
      if (c) c.carriedByPlayerId = null;
    }
    this.players.delete(conn.id);
    if (this.players.size === 0 && this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null; // Auto-hibernates Cloudflare Durable Object to $0 cost
    }
  }

  onMessage(raw: string, sender: Party.Connection) {
    const msg = JSON.parse(raw);
    const player = this.players.get(sender.id);
    if (!player) return;

    // 1. Player Movement & Grapple State
    if (msg.type === "SYNC_PLAYER") {
      player.x = msg.x;
      player.y = msg.y;
      player.z = msg.z;
      player.rotY = msg.rotY;
      player.grappledDinoId = msg.grappledDinoId;
      player.grappledPart = msg.grappledPart;
      player.flashlightOn = msg.flashlightOn;

      // Move carried meat/bone chunk with the player
      if (player.carryingChunkId) {
        const chunk = this.chunks.get(player.carryingChunkId);
        if (chunk && !chunk.loadedInTruck) {
          chunk.x = player.x + Math.sin(player.rotY) * 1.8;
          chunk.y = player.y + 1.5;
          chunk.z = player.z + Math.cos(player.rotY) * 1.8;

          // Check if player walked into the Harvester Truck flatbed drop-zone!
          const distToTruck = Math.hypot(chunk.x - this.truck.x, chunk.z - this.truck.z);
          if (distToTruck < 6.5) {
            chunk.loadedInTruck = true;
            chunk.carriedByPlayerId = null;
            player.carryingChunkId = null;
            this.truck.cargoItems.push(chunk);
            this.room.broadcast(JSON.stringify({
              type: "CHUNK_LOADED_TRUCK",
              chunkId: chunk.chunkId,
              truckCargoCount: this.truck.cargoItems.length,
              totalGoldValue: this.truck.cargoItems.reduce((s, c) => s + c.valueGold, 0)
            }));
          }
        }
      }
    }

    // 2. Drive Harvester Truck or Fire Tow-Winch Cable
    if (msg.type === "DRIVE_TRUCK") {
      this.truck.x = msg.x;
      this.truck.z = msg.z;
      this.truck.rotY = msg.rotY;
      this.truck.headlightsOn = msg.headlightsOn;
    }

    if (msg.type === "TOGGLE_WINCH") {
      this.truck.winchTargetChunkId = msg.chunkId;
    }

    // 3. Chop Dinosaur Body Part (Live Dismemberment)
    if (msg.type === "CHOP_PART") {
      const dino = this.dinos.get(msg.dinoId);
      if (!dino || dino.aiState === 'DEAD_CARCASS') return;

      const partName = msg.part as PartName;
      const part = dino.parts[partName];
      if (!part || part.severed) return;

      const dmg = Math.round((msg.damage || 180) * player.damageMultiplier);
      part.hp = Math.max(0, part.hp - dmg);
      dino.hp = Math.max(0, dino.hp - dmg);
      dino.aiState = 'COMBAT';
      dino.targetPlayerId = sender.id;

      this.room.broadcast(JSON.stringify({
        type: "PART_DAMAGED",
        dinoId: dino.id,
        part: partName,
        partHp: part.hp,
        dinoHp: dino.hp,
        hitBy: sender.id
      }));

      // Did the part get SEVERED off the dinosaur?
      if (part.hp === 0 && !part.severed) {
        part.severed = true;
        dino.aiState = 'STAGGERED';

        const chunk = this.spawnHarvestChunk(
          part.dropsItem,
          part.label,
          dino.x + (Math.random() - 0.5) * 8,
          dino.z + (Math.random() - 0.5) * 8,
          part.weightClass,
          part.weightClass === 'WINCH_ONLY' ? 500 : 220
        );

        this.room.broadcast(JSON.stringify({
          type: "PART_SEVERED",
          dinoId: dino.id,
          part: partName,
          choppedBy: player.name,
          chunk
        }));
      }

      // Did the Titan Dinosaur die and become a harvestable Carcass?
      if (dino.hp === 0) {
        dino.aiState = 'DEAD_CARCASS';
        if (dino.species !== 'shadow_raptor') {
          this.triggerEclipseNightfall(dino);
        } else {
          // Shadow Raptor quick drop
          const rChunk = this.spawnHarvestChunk('luminescent_raptor_claw', 'Luminescent Claw', dino.x, dino.z, 'LIGHT', 120);
          this.room.broadcast(JSON.stringify({ type: "CARCASS_SLICED", dinoId: dino.id, remaining: 0, chunk: rChunk }));
        }
      }
    }

    // 4. Butcher Fallen Carcass with Plasma Saw
    if (msg.type === "SAW_CARCASS") {
      const dino = this.dinos.get(msg.dinoId);
      if (!dino || dino.aiState !== 'DEAD_CARCASS' || dino.carcassChopsRemaining <= 0) return;

      dino.carcassChopsRemaining--;
      const isFinalCore = dino.carcassChopsRemaining === 0;
      const chunk = this.spawnHarvestChunk(
        isFinalCore ? 'voltaic_bio_heart' : 'prime_tail_steak',
        isFinalCore ? 'Apex Glowing Bio-Heart (WINCH)' : 'Prime Marbled Dino Steak',
        dino.x + (Math.random() - 0.5) * 6,
        dino.z + (Math.random() - 0.5) * 6,
        isFinalCore ? 'WINCH_ONLY' : 'HEAVY_2HAND',
        isFinalCore ? 650 : 250
      );

      this.room.broadcast(JSON.stringify({
        type: "CARCASS_SLICED",
        dinoId: dino.id,
        remaining: dino.carcassChopsRemaining,
        chunk
      }));
    }

    // 5. Pick Up / Drop Severed 3D Dino Part
    if (msg.type === "PICKUP_CHUNK") {
      const chunk = this.chunks.get(msg.chunkId);
      if (!chunk || chunk.loadedInTruck) return;

      if (chunk.weightClass === 'WINCH_ONLY') {
        // Attach Truck Tow-Winch automatically!
        this.truck.winchTargetChunkId = chunk.chunkId;
        chunk.winchedByTruck = true;
        this.room.broadcast(JSON.stringify({
          type: "WINCH_ATTACHED",
          chunkId: chunk.chunkId,
          label: chunk.label
        }));
        return;
      }

      if (player.carryingChunkId) {
        const prev = this.chunks.get(player.carryingChunkId);
        if (prev) prev.carriedByPlayerId = null;
      }
      chunk.carriedByPlayerId = player.id;
      player.carryingChunkId = chunk.chunkId;
      this.room.broadcast(JSON.stringify({
        type: "CHUNK_PICKED_UP",
        chunkId: chunk.chunkId,
        playerId: player.id
      }));
    }

    // 6. Monster Cooking Buff at Sanctuary Spit-Roast (Pitch C)
    if (msg.type === "COOK_STEAK_FEAST") {
      for (const p of this.players.values()) {
        p.damageMultiplier = 1.75; // +75% Chop Damage from sizzling Dino Feast!
      }
      this.room.broadcast(JSON.stringify({
        type: "FEAST_COOKED",
        chef: player.name,
        message: "🍖 SIZZLING DINO FEAST SERVED! All Squad Cleavers deal +75% Chop Damage!"
      }));
    }

    // 7. Reset / Start New Expedition from Sanctuary
    if (msg.type === "NEW_EXPEDITION") {
      this.resetHuntEncounter();
      for (const p of this.players.values()) p.carryingChunkId = null;
      // Each player needs their own id back, so this is sent per connection rather than broadcast
      for (const conn of this.room.getConnections()) {
        conn.send(JSON.stringify({
          type: "INIT_STATE",
          selfId: conn.id,
          worldPhase: this.worldPhase,
          players: Array.from(this.players.values()),
          dinos: Array.from(this.dinos.values()),
          chunks: Array.from(this.chunks.values()),
          truck: this.truck
        }));
      }
    }
  }

  spawnHarvestChunk(itemId: string, label: string, x: number, z: number, weightClass: HarvestChunk['weightClass'], valueGold: number): HarvestChunk {
    const chunkId = `chunk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const chunk: HarvestChunk = {
      chunkId,
      itemId,
      label,
      x,
      y: 1.5,
      z,
      weightClass,
      carriedByPlayerId: null,
      winchedByTruck: false,
      loadedInTruck: false,
      valueGold
    };
    this.chunks.set(chunkId, chunk);
    return chunk;
  }

  triggerEclipseNightfall(fallenTitan: DinoState) {
    this.worldPhase = 'ECLIPSE_NIGHTFALL';
    this.truck.headlightsOn = true;

    // Spawn a pack of 4 nocturnal Shadow Raptors around the fog perimeter
    for (let i = 0; i < 4; i++) {
      const angle = (Math.PI * 2 * i) / 4;
      const rId = `shadow_raptor_${Date.now()}_${i}`;
      this.dinos.set(rId, {
        id: rId,
        species: 'shadow_raptor',
        x: fallenTitan.x + Math.cos(angle) * 55,
        y: 0,
        z: fallenTitan.z + Math.sin(angle) * 55,
        rotY: 0,
        hp: 700,
        maxHp: 700,
        aiState: 'COMBAT',
        targetPlayerId: null,
        carcassChopsRemaining: 1,
        parts: {
          Tail_Tip:     { name: 'Tail_Tip',     label: 'Raptor Tail',  hp: 350, maxHp: 350, severed: false, dropsItem: 'raptor_plume', weightClass: 'LIGHT' },
          Head_Armor:   { name: 'Head_Armor',   label: 'Raptor Crest', hp: 350, maxHp: 350, severed: false, dropsItem: 'raptor_crest', weightClass: 'LIGHT' },
          Tail_Upper:   { name: 'Tail_Upper',   label: 'Torso',        hp: 700, maxHp: 700, severed: false, dropsItem: 'raptor_meat',  weightClass: 'LIGHT' },
          Leg_L_Tendon: { name: 'Leg_L_Tendon', label: 'Left Claw',    hp: 300, maxHp: 300, severed: false, dropsItem: 'raptor_claw',  weightClass: 'LIGHT' },
          Leg_R_Tendon: { name: 'Leg_R_Tendon', label: 'Right Claw',   hp: 300, maxHp: 300, severed: false, dropsItem: 'raptor_claw',  weightClass: 'LIGHT' },
          Back_Plates:  { name: 'Back_Plates',  label: 'Back Feathers',hp: 300, maxHp: 300, severed: false, dropsItem: 'raptor_plume', weightClass: 'LIGHT' },
          Bio_Core:     { name: 'Bio_Core',     label: 'Core',         hp: 700, maxHp: 700, severed: false, dropsItem: 'raptor_heart', weightClass: 'LIGHT' }
        }
      });
    }

    this.room.broadcast(JSON.stringify({
      type: "ECLIPSE_NIGHTFALL_STARTED",
      fallenDinoId: fallenTitan.id,
      dinos: Array.from(this.dinos.values()),
      message: "🌑 BLOOD ECLIPSE TRIGGERED! Nocturnal Shadow Raptors are stalking the fog—saw the carcass & winch the Bio-Heart to the Truck!"
    }));
  }

  serverTick() {
    this.tickCount++;

    // 1. Tow-Winch Cable Reel Physics: Pull winched Bio-Heart/Skull toward the Harvester Truck
    if (this.truck.winchTargetChunkId) {
      const wChunk = this.chunks.get(this.truck.winchTargetChunkId);
      if (wChunk && !wChunk.loadedInTruck) {
        const dx = this.truck.x - wChunk.x;
        const dz = this.truck.z - wChunk.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 4.5) {
          wChunk.x += (dx / dist) * 0.65;
          wChunk.z += (dz / dist) * 0.65;
        } else {
          // Winch pulled the heavy part right into the cargo bed!
          wChunk.loadedInTruck = true;
          wChunk.winchedByTruck = false;
          this.truck.winchTargetChunkId = null;
          this.truck.cargoItems.push(wChunk);
          this.room.broadcast(JSON.stringify({
            type: "CHUNK_LOADED_TRUCK",
            chunkId: wChunk.chunkId,
            truckCargoCount: this.truck.cargoItems.length,
            totalGoldValue: this.truck.cargoItems.reduce((s, c) => s + c.valueGold, 0)
          }));
        }
      }
    }

    // 2. Dinosaur AI & Ecosystem Movement
    for (const dino of this.dinos.values()) {
      if (dino.aiState === 'DEAD_CARCASS') continue;

      if (dino.aiState === 'STAGGERED') {
        if (this.tickCount % 30 === 0) dino.aiState = 'COMBAT';
        continue;
      }

      // Roam peacefully or pursue players
      let targetX = Math.sin(this.tickCount * 0.02 + (dino.species === 'stego_titan' ? 2 : 0)) * 35;
      let targetZ = -50 + Math.cos(this.tickCount * 0.02) * 25;

      if (dino.aiState === 'COMBAT' && this.players.size > 0) {
        const targetPlayer = (dino.targetPlayerId && this.players.get(dino.targetPlayerId)) || this.players.values().next().value;
        if (targetPlayer && targetPlayer.z < 50) { // Safe inside Sanctuary Gate (z >= 50)
          targetX = targetPlayer.x;
          targetZ = targetPlayer.z;
        }
      }

      const dx = targetX - dino.x;
      const dz = targetZ - dino.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 4) {
        dino.rotY = Math.atan2(dx, dz);
        const tendonCut = dino.parts.Leg_L_Tendon.severed || dino.parts.Leg_R_Tendon.severed;
        const baseSpeed = dino.species === 'shadow_raptor' ? 0.52 : dino.species === 'voltaic_rex' ? 0.28 : 0.18;
        const speed = baseSpeed * (tendonCut ? 0.45 : 1.0);
        dino.x += (dx / dist) * speed;
        dino.z += (dz / dist) * speed;
      }
    }

    // 3. Broadcast 20Hz Snapshot
    this.room.broadcast(JSON.stringify({
      type: "WORLD_TICK",
      players: Array.from(this.players.values()),
      dinos: Array.from(this.dinos.values()).map(d => ({
        id: d.id,
        species: d.species,
        x: d.x,
        z: d.z,
        rotY: d.rotY,
        hp: d.hp,
        maxHp: d.maxHp,
        aiState: d.aiState
      })),
      chunks: Array.from(this.chunks.values()).filter(c => !c.loadedInTruck),
      truck: {
        x: this.truck.x,
        z: this.truck.z,
        rotY: this.truck.rotY,
        headlightsOn: this.truck.headlightsOn,
        winchTargetChunkId: this.truck.winchTargetChunkId,
        cargoCount: this.truck.cargoItems.length
      }
    }));
  }
}
