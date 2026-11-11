-- ============================================================================
-- BLOCKTOPIA NEXT FABLE: CLOUDFLARE D1 SQL SCHEMA (Players, Chopped Parts, Cooking, Tames)
-- ============================================================================

CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    gold INTEGER DEFAULT 100,
    equipped_weapon TEXT DEFAULT 'plasma_bone_cleaver',
    equipped_grapple TEXT DEFAULT 'pneumatic_winch_mk1',
    buff_type TEXT DEFAULT NULL,
    buff_multiplier REAL DEFAULT 1.0,
    buff_expires_at INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    item_id TEXT NOT NULL,          -- 'prime_tail_steak', 'voltaic_bio_heart', 'tyrant_skull_plate', etc.
    quantity INTEGER DEFAULT 1,
    quality_tier INTEGER DEFAULT 1, -- 1=Standard, 2=Prime, 3=Apex
    FOREIGN KEY (player_id) REFERENCES players(id),
    UNIQUE(player_id, item_id, quality_tier)
);

CREATE TABLE IF NOT EXISTS tamed_dinos (
    dino_uid TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    species TEXT NOT NULL,          -- 'raptor_mount', 'stego_harvester', 'canopy_bronto_base'
    nickname TEXT NOT NULL,
    mutation_aura TEXT DEFAULT 'bio_amber',
    growth_stage REAL DEFAULT 1.0,  -- 0.0 (Egg) -> 1.0 (Adult Mount/Base)
    bronto_base_json TEXT DEFAULT '[]',
    FOREIGN KEY (owner_id) REFERENCES players(id)
);
