import type { ArmorId, Biome, CreatureKind, MaterialId, WeaponId } from './types';

export const BIOME_LABEL: Record<Biome, string> = {
  forest: 'Ash Forest',
  ruins: 'Violet Ruins',
  lava: 'Lava Rim',
  coast: 'Salt Coast',
};

export const MATERIAL_NAME: Record<MaterialId, string> = {
  wood: 'Emberwood',
  stone: 'Stone',
  fiber: 'Fiber',
  cinder: 'Cinder',
  pearl: 'Tide pearl',
  relic: 'Relic',
};

export const MATERIALS: MaterialId[] = ['wood', 'stone', 'fiber', 'cinder', 'pearl', 'relic'];

export interface WeaponDef {
  name: string;
  dmg: number;
  range: number;
  cooldown: number;
  knock: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: { name: 'Bare hands', dmg: 8, range: 2.15, cooldown: 0.46, knock: 1.3 },
  hatchet: { name: 'Stone Hatchet', dmg: 13, range: 2.3, cooldown: 0.42, knock: 1.7 },
  blade: { name: 'Ember Blade', dmg: 19, range: 2.6, cooldown: 0.4, knock: 2.1 },
  cleaver: { name: 'Warden Cleaver', dmg: 28, range: 2.85, cooldown: 0.48, knock: 3.4 },
};

export const ARMOR_HP: Record<ArmorId, number> = {
  none: 100,
  vest: 130,
  mail: 168,
};

export const ARMOR_NAME: Record<ArmorId, string> = {
  none: 'Traveler clothes',
  vest: 'Bark Vest',
  mail: 'Ruin Mail',
};

export interface CreatureDef {
  name: string;
  hp: number;
  dmg: number;
  speed: number;
  aggro: number;
  range: number;
  windup: number;
  radius: number;
  ranged: boolean;
  charge: boolean;
  flying: boolean;
  respawn: number;
  loot: Partial<Record<MaterialId, number>>;
}

export const CREATURES: Record<CreatureKind, CreatureDef> = {
  mossback: {
    name: 'Mossback',
    hp: 46,
    dmg: 9,
    speed: 3.15,
    aggro: 9.5,
    range: 1.65,
    windup: 0.52,
    radius: 0.75,
    ranged: false,
    charge: false,
    flying: false,
    respawn: 80,
    loot: { fiber: 1, wood: 1 },
  },
  stag: {
    name: 'Briar Stag',
    hp: 78,
    dmg: 14,
    speed: 4.2,
    aggro: 13,
    range: 2.15,
    windup: 0.42,
    radius: 0.85,
    ranged: false,
    charge: true,
    flying: false,
    respawn: 95,
    loot: { fiber: 2, wood: 2 },
  },
  sentinel: {
    name: 'Ruin Sentinel',
    hp: 62,
    dmg: 11,
    speed: 2.35,
    aggro: 16,
    range: 11.5,
    windup: 0.68,
    radius: 0.6,
    ranged: true,
    charge: false,
    flying: false,
    respawn: 100,
    loot: { stone: 2, relic: 1 },
  },
  hound: {
    name: 'Cinder Hound',
    hp: 36,
    dmg: 12,
    speed: 6.6,
    aggro: 13,
    range: 1.55,
    windup: 0.28,
    radius: 0.58,
    ranged: false,
    charge: false,
    flying: false,
    respawn: 75,
    loot: { cinder: 2 },
  },
  lurker: {
    name: 'Tide Lurker',
    hp: 74,
    dmg: 16,
    speed: 4.1,
    aggro: 10,
    range: 2.05,
    windup: 0.72,
    radius: 0.95,
    ranged: false,
    charge: false,
    flying: false,
    respawn: 100,
    loot: { pearl: 1, fiber: 1 },
  },
  wisp: {
    name: 'Ash Wisp',
    hp: 24,
    dmg: 8,
    speed: 3.4,
    aggro: 16,
    range: 9,
    windup: 0.46,
    radius: 0.45,
    ranged: true,
    charge: false,
    flying: true,
    respawn: 70,
    loot: { cinder: 1 },
  },
  warden: {
    name: 'Ash Warden',
    hp: 480,
    dmg: 22,
    speed: 3.35,
    aggro: 22,
    range: 3.3,
    windup: 0.72,
    radius: 1.7,
    ranged: false,
    charge: false,
    flying: false,
    respawn: 0,
    loot: { relic: 4, cinder: 6, pearl: 1 },
  },
};

export interface Recipe {
  id: string;
  name: string;
  blurb: string;
  cost: Partial<Record<MaterialId, number>>;
  kind: 'weapon' | 'armor' | 'perk' | 'consumable';
  weapon?: WeaponId;
  armor?: ArmorId;
  perk?: 'cloak' | 'striders' | 'lantern';
  consumable?: 'kindling' | 'heartwine';
  requiresWeapon?: WeaponId;
  requiresArmor?: ArmorId;
}

export const RECIPES: Recipe[] = [
  {
    id: 'hatchet',
    name: 'Stone Hatchet',
    blurb: 'A heavier hand. Cuts emberwood clean and bites harder than fists.',
    cost: { stone: 4, wood: 2 },
    kind: 'weapon',
    weapon: 'hatchet',
  },
  {
    id: 'blade',
    name: 'Ember Blade',
    blurb: 'Quenched in cinder. The forest things learn your reach.',
    cost: { wood: 6, cinder: 4, stone: 2 },
    kind: 'weapon',
    weapon: 'blade',
    requiresWeapon: 'hatchet',
  },
  {
    id: 'cleaver',
    name: 'Warden Cleaver',
    blurb: 'Relic weight, tide-tempered. The caldera was forged for this edge.',
    cost: { cinder: 8, relic: 2, pearl: 1 },
    kind: 'weapon',
    weapon: 'cleaver',
    requiresWeapon: 'blade',
  },
  {
    id: 'vest',
    name: 'Bark Vest',
    blurb: 'Layered emberwood and fiber. Vitality 130.',
    cost: { fiber: 8, wood: 4 },
    kind: 'armor',
    armor: 'vest',
  },
  {
    id: 'mail',
    name: 'Ruin Mail',
    blurb: 'Stone plates stitched with relic wire. Vitality 168.',
    cost: { stone: 6, relic: 2, fiber: 4 },
    kind: 'armor',
    armor: 'mail',
    requiresArmor: 'vest',
  },
  {
    id: 'cloak',
    name: 'Cinder Cloak',
    blurb: 'The rim stops burning you. Vents and the caldera floor go quiet.',
    cost: { cinder: 6, fiber: 4 },
    kind: 'perk',
    perk: 'cloak',
  },
  {
    id: 'striders',
    name: 'Tide Striders',
    blurb: 'Salt-cured soles. You cover the wild a little faster.',
    cost: { pearl: 3, fiber: 4 },
    kind: 'perk',
    perk: 'striders',
  },
  {
    id: 'lantern',
    name: 'Relic Lantern',
    blurb: 'Pushes night back. Ash wisps think twice before closing.',
    cost: { cinder: 2, relic: 2, wood: 3 },
    kind: 'perk',
    perk: 'lantern',
  },
  {
    id: 'kindling',
    name: 'Beacon Kindling',
    blurb: 'One bundle lights one beacon. The wild will answer.',
    cost: { cinder: 3, wood: 2 },
    kind: 'consumable',
    consumable: 'kindling',
  },
  {
    id: 'heartwine',
    name: 'Heartwine',
    blurb: 'Restores 48 health. Drink with the 1 key.',
    cost: { pearl: 1, fiber: 2, cinder: 1 },
    kind: 'consumable',
    consumable: 'heartwine',
  },
];

export const STELE_TEXTS: { title: string; text: string }[] = [
  {
    title: 'First Coal',
    text: 'Before the tides had names, a coal walked out of the ground and asked the trees for a road. They gave it shade, and it gave them fireflies.',
  },
  {
    title: 'The Quiet Bargain',
    text: 'The ruin-masons did not build for kings. They built shelves for a fire that promised not to eat the night all at once.',
  },
  {
    title: 'Salt Ledger',
    text: 'Pearls were receipts. Each one proved a wave had carried an ember home without putting it out.',
  },
  {
    title: 'Rim Etiquette',
    text: 'On the lava rim you do not run. You introduce yourself to the heat, and you leave a spark behind as a courtesy.',
  },
  {
    title: 'Four Mouths',
    text: 'The wild has four mouths: leaf, stone, cinder, and salt. Feed them in any order. They compare notes.',
  },
  {
    title: 'Warden’s Post',
    text: 'The Ash Warden is not a curse. It is the ember that stayed behind to keep the other embers from leaving all at once.',
  },
  {
    title: 'Night Shift',
    text: 'Wisps are daylight’s unfinished sentences. They wander until someone with a lantern agrees to hear the ending.',
  },
  {
    title: 'Bark Gospel',
    text: 'Wear the forest and it will spend blood for you. Wear the ruins and it will spend memory. Neither is free.',
  },
  {
    title: 'Kindling Rite',
    text: 'A beacon is a promise you can see from a long way off. Light it only if you mean to come back.',
  },
  {
    title: 'Tide Stairs',
    text: 'The coast remembers every foot that did not hurry. Hurry anyway, but leave the lurkers their shallow.',
  },
  {
    title: 'Cleaver Psalm',
    text: 'When edge, relic, and pearl agree, the caldera recognizes the argument and shortens its own.',
  },
  {
    title: 'Last Warmth',
    text: 'If the Warden falls, the wild does not end. It exhales. Someone still has to walk home before night.',
  },
];

export const SAVE_KEY = 'ember-wilds-save-v1';
export const MUTE_KEY = 'ember-wilds-mute';
export const DAY_SECONDS = 540;
export const WATER_LEVEL = 1.35;
export const MAP_RES = 96;
export const MAP_EXTENT = 210;

export function mapIndex(x: number, z: number): number {
  const u = Math.floor(((x + MAP_EXTENT) / (MAP_EXTENT * 2)) * MAP_RES);
  const v = Math.floor(((z + MAP_EXTENT) / (MAP_EXTENT * 2)) * MAP_RES);
  if (u < 0 || v < 0 || u >= MAP_RES || v >= MAP_RES) return -1;
  return v * MAP_RES + u;
}

export function compassLabel(dx: number, dz: number): string {
  const angle = Math.atan2(dx, -dz);
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  let a = angle;
  if (a < 0) a += Math.PI * 2;
  const idx = Math.round(a / (Math.PI / 4)) % 8;
  return dirs[idx];
}

export function facingLabel(yaw: number): string {
  return compassLabel(-Math.sin(yaw), -Math.cos(yaw));
}
