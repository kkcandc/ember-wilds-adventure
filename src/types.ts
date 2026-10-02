export type Biome = 'forest' | 'ruins' | 'lava' | 'coast';

export type MaterialId = 'wood' | 'stone' | 'fiber' | 'cinder' | 'pearl' | 'relic';

export type WeaponId = 'fists' | 'hatchet' | 'blade' | 'cleaver';

export type ArmorId = 'none' | 'vest' | 'mail';

export type CreatureKind = 'mossback' | 'stag' | 'sentinel' | 'hound' | 'lurker' | 'wisp' | 'warden';

export type PerkId = 'cloak' | 'striders' | 'lantern';

export interface Prop {
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  variant: number;
}

export interface NodeSpot {
  id: string;
  kind: MaterialId;
  x: number;
  z: number;
  y: number;
  amount: number;
}

export interface Shrine {
  id: string;
  name: string;
  biome: Biome;
  x: number;
  z: number;
  y: number;
}

export interface Beacon {
  id: string;
  name: string;
  biome: Biome;
  x: number;
  z: number;
  y: number;
}

export interface Stele {
  id: string;
  title: string;
  text: string;
  x: number;
  z: number;
  y: number;
}

export interface CacheSpot {
  id: string;
  x: number;
  z: number;
  y: number;
  loot: Partial<Record<MaterialId, number>>;
}

export interface CreatureSpawn {
  id: string;
  kind: CreatureKind;
  x: number;
  z: number;
  guardian?: boolean;
  summon?: boolean;
  tutorial?: boolean;
}

export interface Collider {
  x: number;
  z: number;
  r: number;
}

export interface RuinBlock {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  rot: number;
}

export interface Pillar {
  x: number;
  z: number;
  y: number;
  h: number;
  r: number;
}

export interface Landmark {
  id: string;
  name: string;
  x: number;
  z: number;
  kind: 'shrine' | 'beacon' | 'boss' | 'story' | 'dock';
}
