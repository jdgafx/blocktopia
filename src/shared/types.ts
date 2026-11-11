export type PartName =
  | 'Tail_Tip'
  | 'Tail_Upper'
  | 'Leg_L_Tendon'
  | 'Leg_R_Tendon'
  | 'Head_Armor'
  | 'Back_Plates'
  | 'Bio_Core';

export interface DinoPartState {
  name: PartName;
  label: string;
  hp: number;
  maxHp: number;
  severed: boolean;
  dropsItem: string;
  weightClass: 'LIGHT' | 'HEAVY_2HAND' | 'WINCH_ONLY';
}

export interface DinoState {
  id: string;
  species: 'voltaic_rex' | 'stego_titan' | 'shadow_raptor';
  x: number;
  y: number;
  z: number;
  rotY: number;
  hp: number;
  maxHp: number;
  aiState: 'ROAMING' | 'COMBAT' | 'STAGGERED' | 'DEAD_CARCASS';
  targetPlayerId: string | null;
  carcassChopsRemaining: number;
  parts: Record<PartName, DinoPartState>;
}

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  grappledDinoId: string | null;
  grappledPart: PartName | null;
  carryingChunkId: string | null;
  flashlightOn: boolean;
  damageMultiplier: number;
}

export interface HarvestChunk {
  chunkId: string;
  itemId: string;
  label: string;
  x: number;
  y: number;
  z: number;
  weightClass: 'LIGHT' | 'HEAVY_2HAND' | 'WINCH_ONLY';
  carriedByPlayerId: string | null;
  winchedByTruck: boolean;
  loadedInTruck: boolean;
  valueGold: number;
}

export interface TruckState {
  x: number;
  y: number;
  z: number;
  rotY: number;
  headlightsOn: boolean;
  winchTargetChunkId: string | null;
  cargoItems: HarvestChunk[];
}
