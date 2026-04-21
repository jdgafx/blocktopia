# Blocktopia — Design Spec
_Date: 2026-04-21_

## Overview

A free, web-based multiplayer voxel game combining the best of Minecraft and Roblox. Playable directly in the browser with no download required. Hosted entirely on Netlify (frontend) + Supabase Realtime (multiplayer). Designed to be accessible on all devices — desktop, tablet, and mobile.

---

## Scope

### Phase 1 (MVP — this spec)
- Voxel world: block placement, destruction, procedural terrain
- Creative mode + Survival mode (switchable)
- Multiplayer: 2–8 players per room via 6-character room codes
- Day/night cycle
- Basic inventory + ~30 crafting recipes
- Character customization (colors + hat accessories)
- In-game text chat
- Full mobile support (touch controls)
- **Dinosaurs** (ambient + neutral/hostile): realistic skeletal-animated dinos roaming the world

### Phase 2 (Post-launch)
- Dinosaur taming, riding, egg hatching, hunting loot
- Weather system
- Mini-games
- Creator tools (build your own game mode)
- Emotes
- Deeper crafting (enchantments, potions)

---

## Architecture

### Topology

```
Browser (Three.js)  ←→  Supabase Realtime  ←→  Other Players' Browsers
      ↑                  (WebSocket channels)
  Netlify CDN
 (static files)
```

### Key decisions
- **Frontend**: Pure static files bundled with Vite, deployed to Netlify via GitHub push
- **Multiplayer**: Supabase Realtime broadcast channels (no dedicated game server)
- **No database for Phase 1**: World state lives in memory per client; player inventory saved to `localStorage`; world seed derived deterministically from the room code (all clients produce identical terrain independently)
- **Room model**: 6-character alphanumeric code maps to a Supabase channel name; all players generate the same world from the same seed; room dissolves when all players leave

### Free-tier constraints
- Netlify free: unlimited static hosting, 100GB bandwidth/month
- Supabase free: 200 concurrent connections, 500MB DB, generous Realtime message limits
- Both are sufficient for 2–8 player rooms at 10Hz position updates

---

## Core Systems

### Voxel Engine
- **Chunks**: 16×16×64 blocks per chunk; only nearby chunks loaded/rendered
- **Block storage**: flat `Uint8Array` per chunk, integer block IDs (air=0, dirt=1, grass=2, stone=3, wood=4, sand=5, water=6, leaves=7, log=8, planks=9, stone_brick=10, glass=11, etc.)
- **Terrain generation**: simplex noise — plains, hills, mountains, basic caves; seed derived from room code for consistent world per room
- **Meshing**: greedy mesh algorithm merges coplanar same-type faces into single quads; one `BufferGeometry` per chunk face, replaced on chunk update
- **Textures**: single 256×256 sprite sheet atlas; UV coordinates per block face

### Renderer
- Three.js `WebGLRenderer` with `antialias: false` on mobile for performance
- Frustum culling (Three.js built-in) + manual chunk render distance (4 chunks desktop, 2 chunks mobile)
- Fog at render distance edge to hide chunk pop-in
- Directional light (sun/moon) + ambient light; both interpolated by day/night cycle
- Sky: `Three.Sky` shader or simple gradient hemisphere

### Physics & Collision
- Custom AABB collision against voxel world (no external physics library)
- Player bounding box: 0.6×1.8×0.6 units
- Gravity, terminal velocity, jump impulse
- Block raycasting for break/place targeting (DDA algorithm, max 5 block reach)

### Player Controller
- **Desktop**: WASD movement, mouse look via Pointer Lock API, left-click break (hold), right-click place, scroll wheel selects hotbar slot
- **Mobile**: Left virtual joystick (movement), right drag area (camera look), on-screen buttons for jump / break / place; hotbar scrollable via swipe
- **Creative mode**: double-tap jump to toggle fly; no fall damage; infinite blocks; block picker palette
- **Survival mode**: gravity active; health (10 hearts); hunger (10 drumsticks); fall damage; block break time varies by tool

### Multiplayer Sync (Supabase Realtime)
- Each room = one Supabase Realtime channel named `room-{CODE}`
- **On join**: subscribe to channel; derive world seed from room code; generate terrain locally; broadcast own presence
- **Position sync**: broadcast `{type:'pos', id, x, y, z, rx, ry}` at 10Hz; lerp remote players on receiver
- **Block changes**: broadcast `{type:'block', cx, cy, cz, bx, by, bz, id}` immediately; apply to local world on receive
- **Chat**: broadcast `{type:'chat', id, name, text}`
- **Presence**: Supabase Realtime Presence tracks who is online; used for player list and room capacity check

### Day/Night Cycle
- 20-minute real-time full day (fixed for Phase 1)
- 6 phases: dawn → morning → noon → afternoon → dusk → night
- `DirectionalLight` position orbits scene; color shifts warm→white→orange→dark blue
- Ambient light: 0.3 (night) → 0.8 (day)
- Sky color interpolated via CSS-style gradient keyframes passed to sky shader

### Dinosaur System
- **Phase 1 species** (8 total):
  - Herbivores (passive, flee when attacked): Brachiosaurus, Triceratops, Stegosaurus, Parasaurolophus, Ankylosaurus
  - Predators (neutral until provoked; Velociraptor hunts in packs of 2–3): Velociraptor (feathered), T-Rex
  - Aerial (passive, soars overhead): Pteranodon
- **Models**: Three.js `SkinnedMesh` with bone-based animation — intentionally more anatomically proportioned than the voxel environment; not blocky
- **Animations per dino**: idle, walk, run, attack, death (5 clips via `AnimationMixer`)
- **AI behavior**:
  - Herbivores: wander → graze → flee from players within 8 blocks
  - Raptors: patrol → alert (player within 12 blocks) → pack-chase → attack
  - T-Rex: slow patrol → charge (player within 16 blocks) → stomp attack (AoE)
  - Pteranodon: spline-path flight overhead, no ground interaction
- **Biome spawning**: T-Rex + Raptors in plains/forests; Brachiosaurus + Parasaurolophus near water; Stegosaurus/Ankylosaurus in hills; Pteranodon over mountains/ocean
- **Spawning**: server-side deterministic from world seed + chunk position (same dinos in same spots for all players); max 2–4 dinos per loaded chunk
- **Survival interaction**: predators deal health damage on attack; dinos drop bones on death (crafting material)
- **File**: `src/game/dinosaurs.js` (species registry, AI state machine, spawn logic)

### Inventory & Crafting
- **Inventory**: 9×4 grid (36 slots) + 4 armor slots + off-hand slot
- **Hotbar**: bottom 9 slots of inventory, always visible
- **Crafting**: 2×2 grid in inventory screen (Phase 2: 3×3 via crafting table)
- **~30 launch recipes**: wooden planks, sticks, torches, crafting table, chest, door, slab, stair, fence, tools (pickaxe, axe, shovel, sword) in wood/stone/iron, furnace, ladder, glass pane
- **Item tooltip**: block name + quantity on hover (desktop) / long-press (mobile)

---

## UI & Player Experience

### Main Menu
- "Play Now" → creates room instantly, shows room code to share
- "Join Room" → text input for 6-character code
- "Customize Character" → opens character editor
- Large touch-friendly buttons; works at 320px wide

### HUD (in-game overlay)
- **Hotbar**: bottom center, 9 slots with item icons + quantity
- **Health bar**: top left (survival), 10 heart icons
- **Hunger bar**: top left below health (survival), 10 drumstick icons
- **Player list**: tab key (desktop) or hamburger menu (mobile), shows names + latency indicator
- **Chat**: bottom left; tap/click to open input; last 5 messages visible with fade-out
- **Crosshair**: center screen; changes to grab icon when targeting a block

### Character Customization
- Block-person avatar (geometric, Roblox-style proportions)
- Color pickers: skin, shirt, pants, hair (6 preset swatches + custom hex)
- Hat picker: none / cap / crown / helmet / cowboy hat / hardhat
- Name tag (8-char limit) displayed above avatar in-world

---

## File Structure

```
minecraft-roblox-clone/
├── index.html
├── netlify.toml
├── vite.config.js
├── package.json
├── public/
│   └── textures/
│       ├── blocks.png          # 256×256 block sprite sheet
│       └── ui.png              # HUD icons sprite sheet
└── src/
    ├── main.js                 # Boot: init Three.js, Supabase, start game loop
    ├── engine/
    │   ├── world.js            # Chunk map, terrain gen, block get/set
    │   ├── mesher.js           # Greedy mesh builder per chunk
    │   ├── renderer.js         # Three.js scene, camera, sky, lighting
    │   └── physics.js          # AABB collision, gravity, raycasting
    ├── game/
    │   ├── player.js           # Local player state + controller
    │   ├── inventory.js        # Item slots, stack logic, crafting
    │   ├── gamemode.js         # Creative / survival rule enforcement
    │   ├── daynight.js         # Cycle timer, light + sky interpolation
    │   └── dinosaurs.js        # Species registry, AI state machine, spawn logic
    ├── network/
    │   ├── client.js           # Supabase Realtime channel setup, presence
    │   └── sync.js             # Encode/decode broadcast messages, apply remote state
    ├── ui/
    │   ├── hud.js              # Hotbar, health, hunger overlay
    │   ├── chat.js             # Chat input + message history
    │   ├── menu.js             # Main menu, room create/join screens
    │   └── character.js        # Character editor screen
    └── constants/
        ├── blocks.js           # Block ID → { name, texCoords, solid, transparent, ... }
        └── recipes.js          # Crafting recipe definitions
```

---

## Dependencies

| Package | Purpose |
|---|---|
| `three` | 3D rendering |
| `@supabase/supabase-js` | Realtime multiplayer |
| `simplex-noise` | Terrain generation |
| `vite` | Dev server + production bundler |

No UI framework. DOM-based HUD overlaid on the Three.js canvas via absolute positioning.

---

## Mobile Strategy

- Detect mobile via `navigator.maxTouchPoints > 0` on boot; apply reduced render distance + simplified shadows
- Virtual joystick: left 40% of screen = movement zone; right 60% = look zone
- Break/place buttons: floating action buttons, bottom right corner
- Jump button: floating, right side
- All HUD elements minimum 44×44px tap target
- Landscape orientation encouraged via UI prompt on portrait mobile

---

## Performance Targets

| Device | Target FPS | Render Distance |
|---|---|---|
| Desktop (modern) | 60 fps | 4 chunks (64 blocks) |
| Mid-range mobile | 30 fps | 2 chunks (32 blocks) |
| Low-end mobile | 20+ fps | 1 chunk (16 blocks) |

Tier detected on boot via `navigator.maxTouchPoints > 0` (mobile) + screen width; no runtime benchmark needed.

---

## Success Criteria (Phase 1)

- [ ] Player can open site, enter game within 5 seconds, no install
- [ ] Two players can join the same room and see each other move in real time
- [ ] Blocks can be placed and destroyed; changes visible to all players in room
- [ ] Creative mode: fly, infinite blocks, instant break
- [ ] Survival mode: health, hunger, fall damage, timed block breaking
- [ ] Day/night cycle visible and smooth
- [ ] Mobile: game fully playable with touch controls only
- [ ] Inventory opens; items stack correctly; at least 10 crafting recipes work
- [ ] Character customization persists across sessions (localStorage)
- [ ] Chat messages delivered to all room members
