import { STELE_TEXTS, WATER_LEVEL } from './content';
import { fbm, hash2, hashString, smoothstep } from './noise';
import type {
  Beacon,
  Biome,
  CacheSpot,
  Collider,
  CreatureKind,
  CreatureSpawn,
  Landmark,
  MaterialId,
  NodeSpot,
  Pillar,
  Prop,
  RuinBlock,
  Shrine,
  Stele,
} from './types';

export interface WorldData {
  seedKey: string;
  seed: number;
  signature: string;
  heightAt: (x: number, z: number) => number;
  biomeAt: (x: number, z: number) => Biome;
  heatAt: (x: number, z: number) => number;
  spawn: { x: number; z: number; y: number };
  caldera: { x: number; z: number };
  trees: Prop[];
  rocks: Prop[];
  grasses: Prop[];
  reeds: Prop[];
  cracks: Prop[];
  nodes: NodeSpot[];
  shrines: Shrine[];
  beacons: Beacon[];
  steles: Stele[];
  caches: CacheSpot[];
  creatures: CreatureSpawn[];
  boss: CreatureSpawn;
  colliders: Collider[];
  ruins: RuinBlock[];
  pillars: Pillar[];
  landmarks: Landmark[];
}

const SHRINE_META: Record<Biome, { id: string; name: string }> = {
  forest: { id: 'shrine-forest', name: 'Grove Shrine' },
  ruins: { id: 'shrine-ruins', name: 'Quiet Shrine' },
  lava: { id: 'shrine-lava', name: 'Rim Shrine' },
  coast: { id: 'shrine-coast', name: 'Salt Shrine' },
};

const BEACON_META: Record<Biome, { id: string; name: string }> = {
  forest: { id: 'beacon-forest', name: 'Grove Beacon' },
  ruins: { id: 'beacon-ruins', name: 'Athenaeum Beacon' },
  lava: { id: 'beacon-lava', name: 'Rim Beacon' },
  coast: { id: 'beacon-coast', name: 'Tide Beacon' },
};

const GUARDIAN: Record<Biome, CreatureKind> = {
  forest: 'stag',
  ruins: 'sentinel',
  lava: 'hound',
  coast: 'lurker',
};

interface Ranked {
  x: number;
  z: number;
  y: number;
  rank: number;
  biome: Biome;
}

function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

function pickSpread(items: Ranked[], count: number, minDist: number, avoid: { x: number; z: number }[] = [], avoidDist = 0): Ranked[] {
  const sorted = [...items].sort((a, b) => b.rank - a.rank);
  const chosen: Ranked[] = [];
  for (const item of sorted) {
    if (chosen.length >= count) break;
    if (chosen.some((other) => dist(other.x, other.z, item.x, item.z) < minDist)) continue;
    if (avoidDist > 0 && avoid.some((other) => dist(other.x, other.z, item.x, item.z) < avoidDist)) continue;
    chosen.push(item);
  }
  return chosen;
}

export function createWorld(seedKey: string): WorldData {
  const key = seedKey.trim() || 'ember';
  const seed = hashString(key) || 1;
  const ang = ((seed % 6283) / 1000) % (Math.PI * 2);
  const calR = 86 + (seed % 29);
  const caldera = { x: Math.cos(ang) * calR, z: Math.sin(ang) * calR };

  const heatAt = (x: number, z: number) => fbm(x * 0.0052 + 2.2, z * 0.0052 - 1.3, seed + 90, 3);
  const ruinAt = (x: number, z: number) => fbm(x * 0.0085 + 12, z * 0.0085 + 5, seed + 51, 3);

  const heightAt = (x: number, z: number) => {
    const warp = fbm(x * 0.0075 + 4, z * 0.0075, seed + 13, 3);
    const n = fbm(x * 0.0062 + warp * 0.85, z * 0.0062 - warp * 0.55, seed, 4);
    const broad = fbm(x * 0.0026, z * 0.0026, seed + 4, 3);
    const ridge = 1 - Math.abs(fbm(x * 0.011, z * 0.011, seed + 40, 3) * 2 - 1);
    let h = (n - 0.36) * 20 + (broad - 0.48) * 9 + ridge * ridge * 5.5;
    const heat = heatAt(x, z);
    if (heat > 0.6) h += (heat - 0.6) * 14;
    const d = Math.hypot(x, z) / 196;
    const coast = smoothstep(0.58, 1.08, d);
    h = h * (1 - coast) + -4.2 * coast;
    const cd = Math.hypot(x - caldera.x, z - caldera.z);
    if (cd < 38) {
      let bowl: number;
      if (cd < 13) bowl = 3.15;
      else if (cd < 24) bowl = 3.15 + (cd - 13) * 0.68;
      else bowl = 10.63 + (cd - 24) * 0.15;
      const blend = smoothstep(26, 38, cd);
      h = bowl * (1 - blend) + h * blend;
    }
    return h;
  };

  const biomeAt = (x: number, z: number): Biome => {
    const h = heightAt(x, z);
    const cd = Math.hypot(x - caldera.x, z - caldera.z);
    if (cd < 32 && h > 1.2) return 'lava';
    const heat = heatAt(x, z);
    const ruin = ruinAt(x, z);
    if (h < 2.15) return 'coast';
    if (heat > 0.63 && h > 3) return 'lava';
    if (ruin > 0.64 && heat < 0.68 && h > 2.2 && h < 12) return 'ruins';
    return 'forest';
  };

  const slopeAt = (x: number, z: number) => {
    const h = heightAt(x, z);
    const hx = heightAt(x + 2, z) - h;
    const hz = heightAt(x, z + 2) - h;
    return Math.hypot(hx, hz) / 2;
  };

  const walkable = (x: number, z: number) => {
    const h = heightAt(x, z);
    return h > 2.25 && h < 12.5 && slopeAt(x, z) < 1.15 && Math.hypot(x, z) < 168;
  };

  function findSpot(preferX: number, preferZ: number, biome: Biome | null, relax = 0): { x: number; z: number; y: number } {
    let best = { x: preferX, z: preferZ, y: heightAt(preferX, preferZ) };
    let bestScore = -Infinity;
    for (let x = -168; x <= 168; x += 6) {
      for (let z = -168; z <= 168; z += 6) {
        const h = heightAt(x, z);
        const sl = slopeAt(x, z);
        const b = biomeAt(x, z);
        let score = 420 - dist(x, z, preferX, preferZ);
        score -= sl * 22;
        if (biome === 'coast') {
          if (h < 1.15 || h > 2.7) score -= 700;
          else score += 40;
        } else if (biome === 'lava') {
          if (h < 2.6 || h > 13.5) score -= 500;
        } else if (h < 2.35 || h > 10.8) {
          score -= 500;
        }
        if (sl > 1.25) score -= 280;
        if (biome && b === biome) score += 720 - relax;
        else if (biome) score -= 260;
        if (Math.hypot(x, z) > 165) score -= 180;
        if (score > bestScore) {
          bestScore = score;
          best = { x, z, y: h };
        }
      }
    }
    return best;
  }

  const preferStart = { x: -caldera.x * 0.92, z: -caldera.z * 0.92 };
  const forestShrinePos = findSpot(preferStart.x, preferStart.z, 'forest');
  const forestBeaconPos = findSpot(forestShrinePos.x + 26, forestShrinePos.z - 18, 'forest');
  const ruinsBeaconPos = findSpot(caldera.x * -0.15 + 70, caldera.z * 0.4, 'ruins');
  const lavaBeaconPos = findSpot(caldera.x * 0.72, caldera.z * 0.72, 'lava');
  const coastBeaconPos = findSpot(-caldera.z * 0.95, caldera.x * 0.55, 'coast');

  const beaconPositions: Record<Biome, { x: number; z: number; y: number }> = {
    forest: forestBeaconPos,
    ruins: ruinsBeaconPos,
    lava: lavaBeaconPos,
    coast: coastBeaconPos,
  };

  const shrinePositions: Record<Biome, { x: number; z: number; y: number }> = {
    forest: forestShrinePos,
    ruins: findSpot(ruinsBeaconPos.x + 12, ruinsBeaconPos.z + 8, 'ruins'),
    lava: findSpot(lavaBeaconPos.x - 10, lavaBeaconPos.z + 12, 'lava'),
    coast: findSpot(coastBeaconPos.x + 8, coastBeaconPos.z - 14, 'coast'),
  };

  const shrines: Shrine[] = (Object.keys(SHRINE_META) as Biome[]).map((biome) => {
    const pos = shrinePositions[biome];
    const meta = SHRINE_META[biome];
    return { id: meta.id, name: meta.name, biome, x: pos.x, z: pos.z, y: heightAt(pos.x, pos.z) };
  });

  const beacons: Beacon[] = (Object.keys(BEACON_META) as Biome[]).map((biome) => {
    const pos = beaconPositions[biome];
    const meta = BEACON_META[biome];
    return { id: meta.id, name: meta.name, biome, x: pos.x, z: pos.z, y: heightAt(pos.x, pos.z) };
  });

  const spawn = {
    x: shrines[0].x + 2.2,
    z: shrines[0].z + 1.4,
    y: 0,
  };
  spawn.y = heightAt(spawn.x, spawn.z);

  const landmarks: Landmark[] = [
    ...shrines.map((s) => ({ id: s.id, name: s.name, x: s.x, z: s.z, kind: 'shrine' as const })),
    ...beacons.map((b) => ({ id: b.id, name: b.name, x: b.x, z: b.z, kind: 'beacon' as const })),
    { id: 'caldera', name: 'Ash Caldera', x: caldera.x, z: caldera.z, kind: 'boss' },
  ];

  const reserved = [...shrines, ...beacons, { x: caldera.x, z: caldera.z }];

  const trees: Prop[] = [];
  const rocks: Prop[] = [];
  const grasses: Prop[] = [];
  const reeds: Prop[] = [];
  const cracks: Prop[] = [];
  const nodeCandidates: Record<MaterialId, Ranked[]> = {
    wood: [],
    stone: [],
    fiber: [],
    cinder: [],
    pearl: [],
    relic: [],
  };
  const creatureCandidates: Record<CreatureKind, Ranked[]> = {
    mossback: [],
    stag: [],
    sentinel: [],
    hound: [],
    lurker: [],
    wisp: [],
    warden: [],
  };
  const steleCandidates: Ranked[] = [];
  const cacheCandidates: Ranked[] = [];
  const ruinCandidates: Ranked[] = [];
  const dockCandidates: Ranked[] = [];
  const ringCandidates: Ranked[] = [];

  const nearReserved = (x: number, z: number, radius: number) => reserved.some((p) => dist(p.x, p.z, x, z) < radius);

  for (let gx = -180; gx <= 180; gx += 3.5) {
    for (let gz = -180; gz <= 180; gz += 3.5) {
      const jx = gx + (hash2(Math.round(gx * 10), Math.round(gz * 10), seed + 7) - 0.5) * 2.6;
      const jz = gz + (hash2(Math.round(gx * 10) + 3, Math.round(gz * 10) - 5, seed + 8) - 0.5) * 2.6;
      const h = heightAt(jx, jz);
      if (h < 0.4 || Math.hypot(jx, jz) > 188) continue;
      const b = biomeAt(jx, jz);
      const r1 = hash2(Math.round(jx * 8), Math.round(jz * 8), seed + 19);
      const r2 = hash2(Math.round(jx * 8) + 11, Math.round(jz * 8) - 4, seed + 23);
      const r3 = hash2(Math.round(jx * 5), Math.round(jz * 5), seed + 29);
      const clearing = nearReserved(jx, jz, b === 'lava' ? 5 : 7) || dist(jx, jz, caldera.x, caldera.z) < 14;
      const rot = r2 * Math.PI * 2;
      const scale = 0.75 + r3 * 0.7;

      if (!clearing && b === 'forest' && h > 2.2 && h < 12 && r1 > 0.7 && trees.length < 520) {
        trees.push({ x: jx, y: h, z: jz, rot, scale, variant: 0 });
      } else if (!clearing && b === 'ruins' && h > 2.3 && r1 > 0.9 && trees.length < 520) {
        trees.push({ x: jx, y: h, z: jz, rot, scale: scale * 0.8, variant: 1 });
      } else if (b === 'forest' && h > 2.15 && r1 > 0.22 && r1 <= 0.7 && grasses.length < 860) {
        grasses.push({ x: jx, y: h, z: jz, rot, scale: 0.6 + r3 * 0.8, variant: 0 });
      }

      if (!clearing && h > 1.6 && r2 > 0.9 && rocks.length < 260) {
        rocks.push({ x: jx, y: h, z: jz, rot, scale: 0.45 + r1 * 1.15, variant: b === 'lava' ? 1 : b === 'ruins' ? 2 : 0 });
      }
      if (b === 'coast' && h > 1.15 && h < 2.5 && r3 > 0.55 && reeds.length < 200) {
        reeds.push({ x: jx, y: h, z: jz, rot, scale: 0.7 + r1 * 0.6, variant: 0 });
      }
      if (b === 'lava' && h > 3 && r1 > 0.82 && cracks.length < 90) {
        cracks.push({ x: jx, y: h + 0.05, z: jz, rot, scale: 0.8 + r2, variant: 0 });
      }
    }
  }

  for (let gx = -170; gx <= 170; gx += 12) {
    for (let gz = -170; gz <= 170; gz += 12) {
      const jx = gx + (hash2(gx, gz, seed + 70) - 0.5) * 8;
      const jz = gz + (hash2(gx + 4, gz - 6, seed + 71) - 0.5) * 8;
      const h = heightAt(jx, jz);
      if (h < 1.15 || h > 13 || Math.hypot(jx, jz) > 172) continue;
      const b = biomeAt(jx, jz);
      const sl = slopeAt(jx, jz);
      const rank = hash2(Math.round(jx * 3), Math.round(jz * 3), seed + 77);
      const ranked = { x: jx, z: jz, y: h, rank, biome: b };
      if (b === 'coast' && h >= 1.2 && h <= 2.8) {
        nodeCandidates.pearl.push(ranked);
        if (sl < 1.3) creatureCandidates.lurker.push(ranked);
        if (h > 1.3) dockCandidates.push(ranked);
      }
      if (h < 2.15 || h > 12.4 || sl > 1.25) continue;
      if (b === 'forest') nodeCandidates.wood.push(ranked);
      if (b === 'forest' || b === 'ruins' || b === 'coast') nodeCandidates.fiber.push({ ...ranked, rank: hash2(Math.round(jx), Math.round(jz), seed + 78) });
      if (b !== 'coast') nodeCandidates.stone.push({ ...ranked, rank: hash2(Math.round(jx), Math.round(jz), seed + 79) });
      if (b === 'lava') nodeCandidates.cinder.push(ranked);
      if (b === 'forest') creatureCandidates.mossback.push(ranked);
      if (b === 'forest') creatureCandidates.stag.push({ ...ranked, rank: hash2(Math.round(jx) + 2, Math.round(jz), seed + 81) });
      if (b === 'ruins') creatureCandidates.sentinel.push(ranked);
      if (b === 'lava' && dist(jx, jz, caldera.x, caldera.z) > 20) creatureCandidates.hound.push(ranked);
      if (h > 2.4 && dist(jx, jz, caldera.x, caldera.z) > 24) {
        creatureCandidates.wisp.push({ ...ranked, rank: hash2(Math.round(jx), Math.round(jz) + 9, seed + 82) });
      }
      if (walkable(jx, jz)) {
        steleCandidates.push(ranked);
        cacheCandidates.push({ ...ranked, rank: hash2(Math.round(jx) - 3, Math.round(jz) + 4, seed + 83) });
      }
      if (ruinAt(jx, jz) > 0.66 && b !== 'lava' && h > 2.4) ruinCandidates.push({ ...ranked, rank: ruinAt(jx, jz) });
      if (b === 'forest') ringCandidates.push({ ...ranked, rank: hash2(Math.round(jx) + 15, Math.round(jz) - 8, seed + 84) });
    }
  }

  const avoidSpawns = [...shrines.map((s) => ({ x: s.x, z: s.z })), { x: spawn.x, z: spawn.z }];
  const nodes: NodeSpot[] = [];
  const nodePlan: { kind: MaterialId; count: number; min: number }[] = [
    { kind: 'wood', count: 16, min: 14 },
    { kind: 'stone', count: 12, min: 14 },
    { kind: 'fiber', count: 14, min: 13 },
    { kind: 'cinder', count: 8, min: 12 },
    { kind: 'pearl', count: 7, min: 12 },
  ];
  for (const plan of nodePlan) {
    const picked = pickSpread(nodeCandidates[plan.kind], plan.count, plan.min, avoidSpawns, 6);
    for (const spot of picked) {
      const amount = plan.kind === 'pearl' ? 2 : plan.kind === 'cinder' ? 3 : 4;
      nodes.push({
        id: `node-${plan.kind}-${nodes.length}`,
        kind: plan.kind,
        x: spot.x,
        z: spot.z,
        y: spot.y,
        amount,
      });
    }
  }

  const starterKinds: MaterialId[] = ['wood', 'wood', 'stone', 'fiber', 'wood', 'stone', 'fiber'];
  starterKinds.forEach((kind, i) => {
    const a = 0.4 + i * 0.85;
    const rad = 6.5 + (i % 3) * 1.6;
    const x = spawn.x + Math.cos(a) * rad;
    const z = spawn.z + Math.sin(a) * rad;
    const y = heightAt(x, z);
    if (y > 1.4) {
      nodes.push({ id: `starter-${i}`, kind, x, z, y, amount: 3 });
    }
  });

  const creatures: CreatureSpawn[] = [];
  const creaturePlan: { kind: CreatureKind; count: number; min: number }[] = [
    { kind: 'mossback', count: 7, min: 16 },
    { kind: 'stag', count: 4, min: 22 },
    { kind: 'sentinel', count: 5, min: 18 },
    { kind: 'hound', count: 5, min: 16 },
    { kind: 'lurker', count: 4, min: 18 },
    { kind: 'wisp', count: 4, min: 20 },
  ];
  const placedActors: { x: number; z: number }[] = [];
  for (const plan of creaturePlan) {
    const picked = pickSpread(creatureCandidates[plan.kind], plan.count, plan.min, avoidSpawns, 14);
    for (const spot of picked) {
      creatures.push({
        id: `${plan.kind}-${creatures.length}`,
        kind: plan.kind,
        x: spot.x,
        z: spot.z,
      });
      placedActors.push(spot);
    }
  }

  const tutA = 2.2;
  const tutX = spawn.x + Math.cos(tutA) * 15;
  const tutZ = spawn.z + Math.sin(tutA) * 15;
  creatures.push({
    id: 'tutorial-moss',
    kind: 'mossback',
    x: tutX,
    z: tutZ,
    tutorial: true,
  });

  for (const beacon of beacons) {
    const spin = hash2(Math.round(beacon.x), Math.round(beacon.z), seed + 99) * Math.PI * 2;
    let gx = beacon.x + Math.cos(spin) * 8;
    let gz = beacon.z + Math.sin(spin) * 8;
    if (heightAt(gx, gz) < 1.8) {
      gx = beacon.x + 3;
      gz = beacon.z + 2;
    }
    creatures.push({
      id: `guardian-${beacon.biome}`,
      kind: GUARDIAN[beacon.biome],
      x: gx,
      z: gz,
      guardian: true,
    });
  }

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    creatures.push({
      id: `summon-${i}`,
      kind: 'hound',
      x: caldera.x + Math.cos(a) * 6,
      z: caldera.z + Math.sin(a) * 6,
      summon: true,
    });
  }

  const boss: CreatureSpawn = {
    id: 'warden',
    kind: 'warden',
    x: caldera.x,
    z: caldera.z,
  };

  const steles: Stele[] = pickSpread(steleCandidates, STELE_TEXTS.length, 24, [...shrines, ...beacons], 10).map((spot, i) => ({
    id: `stele-${i}`,
    title: STELE_TEXTS[i].title,
    text: STELE_TEXTS[i].text,
    x: spot.x,
    z: spot.z,
    y: spot.y,
  }));

  const caches: CacheSpot[] = pickSpread(cacheCandidates, 8, 22, [...steles, ...shrines], 8).map((spot, i) => {
    const loot: Partial<Record<MaterialId, number>> = {};
    if (spot.biome === 'ruins') {
      loot.stone = 3;
      loot.relic = 1;
    } else if (spot.biome === 'lava') {
      loot.cinder = 3;
      loot.stone = 1;
    } else if (spot.biome === 'coast') {
      loot.pearl = 1;
      loot.fiber = 2;
    } else {
      loot.wood = 3;
      loot.fiber = 2;
    }
    if (hash2(i + 3, Math.round(spot.x), seed) > 0.72) loot.relic = (loot.relic ?? 0) + 1;
    return { id: `cache-${i}`, x: spot.x, z: spot.z, y: spot.y, loot };
  });

  const ruins: RuinBlock[] = [];
  const ruinSpots = pickSpread(ruinCandidates, 6, 30, shrines, 12);
  for (const spot of ruinSpots) {
    const rot = hash2(Math.round(spot.x), Math.round(spot.z), seed + 120) * Math.PI * 2;
    const add = (lx: number, lz: number, w: number, hgt: number, d: number) => {
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const x = spot.x + lx * c - lz * s;
      const z = spot.z + lx * s + lz * c;
      const y = heightAt(x, z);
      ruins.push({ x, y: y + hgt / 2, z, w, h: hgt, d, rot });
    };
    add(0, -2.4, 6.5, 2.8, 0.45);
    add(-3.1, 0.4, 0.45, 2.2, 4.2);
    add(2.4, 1.1, 0.4, 1.3, 2.4);
    add(0.4, 1.6, 0.7, 3.1, 0.7);
  }

  const pillars: Pillar[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = caldera.x + Math.cos(a) * 16.5;
    const z = caldera.z + Math.sin(a) * 16.5;
    const y = heightAt(x, z);
    pillars.push({ x, z, y, h: 3.2 + (i % 3) * 0.45, r: 0.55 });
  }

  const ring = pickSpread(ringCandidates, 1, 10, [{ x: spawn.x, z: spawn.z }], 36)[0];
  if (ring) {
    landmarks.push({ id: 'whisper', name: 'Whisper Ring', x: ring.x, z: ring.z, kind: 'story' });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = ring.x + Math.cos(a) * 4.2;
      const z = ring.z + Math.sin(a) * 4.2;
      pillars.push({ x, z, y: heightAt(x, z), h: 1.8 + (i % 2) * 0.5, r: 0.28 });
    }
  }

  const docks = pickSpread(dockCandidates, 3, 28, [], 0);
  docks.forEach((dock, i) => {
    const rot = Math.atan2(dock.x, dock.z);
    if (i === 0) landmarks.push({ id: 'pier', name: 'Salt Pier', x: dock.x, z: dock.z, kind: 'dock' });
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (let k = 0; k < 4; k++) {
      const lx = 0;
      const lz = k * 1.5;
      const x = dock.x + lx * c - lz * s;
      const z = dock.z + lx * s + lz * c;
      ruins.push({
        x,
        y: Math.max(WATER_LEVEL - 0.15, heightAt(x, z)) + 0.12,
        z,
        w: 1.8,
        h: 0.22,
        d: 1.35,
        rot,
      });
    }
  });

  const colliders: Collider[] = [];
  for (const tree of trees) {
    if (tree.scale > 0.85) colliders.push({ x: tree.x, z: tree.z, r: 0.38 * tree.scale });
  }
  for (const rock of rocks) {
    if (rock.scale > 0.7) colliders.push({ x: rock.x, z: rock.z, r: 0.48 * rock.scale });
  }
  for (const block of ruins) {
    colliders.push({ x: block.x, z: block.z, r: Math.max(block.w, block.d) * 0.32 });
  }
  for (const pillar of pillars) colliders.push({ x: pillar.x, z: pillar.z, r: pillar.r + 0.15 });
  for (const shrine of shrines) colliders.push({ x: shrine.x, z: shrine.z, r: 0.55 });

  const signature = atlasSignature(seed, spawn, caldera, shrines, beacons, trees.length, creatures.length);

  return {
    seedKey: key,
    seed,
    signature,
    heightAt,
    biomeAt,
    heatAt,
    spawn,
    caldera,
    trees,
    rocks,
    grasses,
    reeds,
    cracks,
    nodes,
    shrines,
    beacons,
    steles,
    caches,
    creatures,
    boss,
    colliders,
    ruins,
    pillars,
    landmarks,
  };
}

function atlasSignature(
  seed: number,
  spawn: { x: number; z: number },
  caldera: { x: number; z: number },
  shrines: Shrine[],
  beacons: Beacon[],
  trees: number,
  creatures: number,
): string {
  let h = seed >>> 0;
  const mix = (n: number) => {
    h ^= Math.imul(Math.round(n * 10) | 0, 2654435761);
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  };
  mix(spawn.x);
  mix(spawn.z);
  mix(caldera.x);
  mix(caldera.z);
  for (const shrine of shrines) {
    mix(shrine.x);
    mix(shrine.z);
  }
  for (const beacon of beacons) {
    mix(beacon.x);
    mix(beacon.z);
  }
  mix(trees);
  mix(creatures);
  return (h >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 6);
}

export function biomeCounts(world: WorldData): Record<Biome | 'water', number> {
  const counts: Record<Biome | 'water', number> = { forest: 0, ruins: 0, lava: 0, coast: 0, water: 0 };
  for (let x = -180; x <= 180; x += 8) {
    for (let z = -180; z <= 180; z += 8) {
      const h = world.heightAt(x, z);
      if (h < WATER_LEVEL) counts.water++;
      else counts[world.biomeAt(x, z)]++;
    }
  }
  return counts;
}
