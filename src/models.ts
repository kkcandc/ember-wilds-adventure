import * as THREE from 'three';
import type { ArmorId, CreatureKind, WeaponId } from './types';

const box = new THREE.BoxGeometry(1, 1, 1);
const sph = new THREE.IcosahedronGeometry(0.5, 0);
const cone = new THREE.ConeGeometry(0.5, 1, 5);
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);

function mat(color: number, emissive = 0x000000, emissiveIntensity = 0, opacity = 1): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.78,
    metalness: 0.06,
    emissive,
    emissiveIntensity,
    flatShading: true,
    transparent: opacity < 1,
    opacity,
  });
  material.userData.baseE = material.emissive.clone();
  material.userData.baseI = emissiveIntensity;
  return material;
}

function part(geo: THREE.BufferGeometry, color: number, emissive = 0, emI = 0, opacity = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat(color, emissive, emI, opacity));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export interface HeroMesh {
  group: THREE.Group;
  hand: THREE.Group;
  weapon: THREE.Mesh;
  cloth: THREE.MeshStandardMaterial;
  cloak: THREE.Mesh;
}

export function createHero(): HeroMesh {
  const group = new THREE.Group();
  const cloth = mat(0xd4834a);
  const skin = mat(0xc49a78);
  const body = new THREE.Mesh(box, cloth);
  body.scale.set(0.52, 0.72, 0.32);
  body.position.y = 1.05;
  body.castShadow = true;
  const head = part(sph, 0xc49a78);
  head.scale.set(0.34, 0.36, 0.34);
  head.position.y = 1.62;
  const legL = part(cyl, 0x2c2420);
  const legR = part(cyl, 0x2c2420);
  legL.scale.set(0.14, 0.55, 0.14);
  legR.scale.set(0.14, 0.55, 0.14);
  legL.position.set(-0.14, 0.28, 0);
  legR.position.set(0.14, 0.28, 0);
  const hand = new THREE.Group();
  hand.position.set(0.32, 1.15, 0.12);
  const arm = part(box, 0xc49a78);
  arm.scale.set(0.1, 0.34, 0.1);
  arm.position.y = -0.05;
  const weapon = part(box, 0xc4a484);
  weapon.scale.set(0.08, 0.08, 0.42);
  weapon.position.set(0, -0.05, 0.28);
  hand.add(arm, weapon);
  const cloak = part(cone, 0x8a3418, 0x5a1c08, 0.35);
  cloak.scale.set(0.7, 1.05, 0.45);
  cloak.position.set(0, 1.15, -0.12);
  cloak.rotation.x = 0.15;
  cloak.visible = false;
  group.add(body, head, legL, legR, hand, cloak);
  void skin;
  return { group, hand, weapon, cloth, cloak };
}

export function applyHeroGear(hero: HeroMesh, weapon: WeaponId, armor: ArmorId, cloak: boolean): void {
  const weaponColor: Record<WeaponId, number> = {
    fists: 0xc4a484,
    hatchet: 0xb9bcc4,
    blade: 0xff6a32,
    cleaver: 0xd5dee8,
  };
  const weaponScale: Record<WeaponId, [number, number, number]> = {
    fists: [0.08, 0.08, 0.28],
    hatchet: [0.18, 0.12, 0.72],
    blade: [0.07, 0.1, 1.02],
    cleaver: [0.2, 0.12, 1.2],
  };
  const [sx, sy, sz] = weaponScale[weapon];
  hero.weapon.scale.set(sx, sy, sz);
  const wmat = hero.weapon.material as THREE.MeshStandardMaterial;
  wmat.color.setHex(weaponColor[weapon]);
  wmat.emissive.setHex(weapon === 'blade' || weapon === 'cleaver' ? 0xff4d1a : 0x000000);
  wmat.emissiveIntensity = weapon === 'fists' ? 0 : weapon === 'hatchet' ? 0.05 : 0.45;
  hero.cloth.color.setHex(armor === 'mail' ? 0xb7b4c2 : armor === 'vest' ? 0xc4894a : 0xd4834a);
  hero.cloak.visible = cloak;
}

export function createCreature(kind: CreatureKind): THREE.Group {
  const group = new THREE.Group();
  if (kind === 'mossback') {
    const body = part(sph, 0x3e6b38);
    body.scale.set(1.15, 0.72, 1.4);
    body.position.y = 0.72;
    const shell = part(cone, 0x244428);
    shell.scale.set(1.05, 0.7, 1.05);
    shell.position.y = 1.18;
    group.add(body, shell);
    for (const [x, z] of [[-0.38, 0.42], [0.38, 0.42], [-0.38, -0.42], [0.38, -0.42]] as const) {
      const leg = part(cyl, 0x243222);
      leg.scale.set(0.16, 0.42, 0.16);
      leg.position.set(x, 0.2, z);
      group.add(leg);
    }
    addEyes(group, 0.22, 0.86, 0.62, 0.1);
  } else if (kind === 'stag') {
    const body = part(box, 0x6a4328);
    body.scale.set(0.55, 0.55, 1.35);
    body.position.y = 1.05;
    const neck = part(box, 0x7a4e30);
    neck.scale.set(0.28, 0.55, 0.28);
    neck.position.set(0, 1.35, 0.55);
    neck.rotation.x = -0.5;
    const head = part(box, 0x5c3a22);
    head.scale.set(0.28, 0.28, 0.55);
    head.position.set(0, 1.62, 0.85);
    group.add(body, neck, head);
    for (const side of [-1, 1]) {
      const ant = part(cone, 0xd9c7a4);
      ant.scale.set(0.12, 0.55, 0.12);
      ant.position.set(side * 0.16, 1.95, 0.78);
      ant.rotation.z = side * -0.4;
      group.add(ant);
    }
    for (const [x, z] of [[-0.22, 0.4], [0.22, 0.4], [-0.22, -0.45], [0.22, -0.45]] as const) {
      const leg = part(cyl, 0x3a2a1c);
      leg.scale.set(0.1, 0.85, 0.1);
      leg.position.set(x, 0.42, z);
      group.add(leg);
    }
    group.scale.setScalar(1.12);
  } else if (kind === 'sentinel') {
    const body = part(box, 0x7c768c, 0x3a3450, 0.15);
    body.scale.set(0.72, 1.55, 0.42);
    body.position.y = 1.55;
    const head = part(box, 0x918ca2, 0xd6b25e, 0.35);
    head.scale.set(0.42, 0.38, 0.38);
    head.position.y = 2.55;
    const glyph = part(box, 0xf0d48a, 0xf0d48a, 0.8);
    glyph.scale.set(0.12, 0.55, 0.08);
    glyph.position.set(0, 1.6, 0.24);
    group.add(body, head, glyph);
    group.scale.setScalar(1.08);
  } else if (kind === 'hound') {
    const body = part(box, 0x2a2222);
    body.scale.set(0.48, 0.38, 1.15);
    body.position.y = 0.48;
    const head = part(box, 0x3a2a28, 0xff5a1f, 0.25);
    head.scale.set(0.36, 0.32, 0.42);
    head.position.set(0, 0.62, 0.62);
    const tail = part(cone, 0xff6a2a, 0xff4d12, 1.1);
    tail.scale.set(0.12, 0.45, 0.12);
    tail.position.set(0, 0.7, -0.62);
    tail.rotation.x = 1.4;
    group.add(body, head, tail);
    addEyes(group, 0.1, 0.72, 0.78, 0.06, 0xffb15a);
    for (const [x, z] of [[-0.18, 0.32], [0.18, 0.32], [-0.18, -0.38], [0.18, -0.38]] as const) {
      const leg = part(cyl, 0x1c1616);
      leg.scale.set(0.08, 0.32, 0.08);
      leg.position.set(x, 0.16, z);
      group.add(leg);
    }
  } else if (kind === 'lurker') {
    const body = part(sph, 0x2c6d72);
    body.scale.set(1.45, 0.42, 1.15);
    body.position.y = 0.42;
    const belly = part(sph, 0xc2b59a);
    belly.scale.set(0.8, 0.22, 0.7);
    belly.position.y = 0.28;
    group.add(body, belly);
    addEyes(group, 0.28, 0.62, 0.42, 0.1, 0xd7fff8);
    group.scale.setScalar(1.2);
  } else if (kind === 'wisp') {
    const body = part(sph, 0xffc27a, 0xff7a2a, 2.1, 0.88);
    body.scale.setScalar(0.55);
    body.position.y = 1.4;
    const core = part(sph, 0xfff1d2, 0xfff1d2, 1.4, 0.95);
    core.scale.setScalar(0.22);
    core.position.y = 1.4;
    group.add(body, core);
  } else {
    const body = part(box, 0x2a1814, 0xff4d1a, 0.35);
    body.scale.set(1.3, 1.8, 0.8);
    body.position.y = 1.7;
    const head = part(box, 0x1a100e, 0xff6a2a, 0.5);
    head.scale.set(0.7, 0.55, 0.6);
    head.position.y = 2.9;
    group.add(body, head);
    for (const side of [-1, 1]) {
      const horn = part(cone, 0x120e0c);
      horn.scale.set(0.16, 0.7, 0.16);
      horn.position.set(side * 0.28, 3.35, 0);
      horn.rotation.z = side * -0.35;
      group.add(horn);
      const crack = part(box, 0xff5a1f, 0xff5a1f, 1.3);
      crack.scale.set(0.08, 0.9, 0.08);
      crack.position.set(side * 0.25, 1.7, 0.42);
      group.add(crack);
    }
    const armL = part(box, 0x3a221c, 0xff4d1a, 0.2);
    const armR = part(box, 0x3a221c, 0xff4d1a, 0.2);
    armL.scale.set(0.28, 1.1, 0.28);
    armR.scale.set(0.28, 1.1, 0.28);
    armL.position.set(-0.85, 1.7, 0.1);
    armR.position.set(0.85, 1.7, 0.2);
    group.add(armL, armR);
    group.scale.setScalar(1.7);
  }
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    if (!material.emissive) return;
    if (!material.userData.baseE) {
      material.userData.baseE = material.emissive.clone();
      material.userData.baseI = material.emissiveIntensity || 0;
    }
  });
  return group;
}

function addEyes(group: THREE.Group, x: number, y: number, z: number, s: number, color = 0x111111): void {
  for (const side of [-1, 1]) {
    const eye = part(sph, color, color === 0x111111 ? 0x000000 : color, color === 0x111111 ? 0 : 0.6);
    eye.scale.setScalar(s);
    eye.position.set(side * x, y, z);
    group.add(eye);
  }
}

export function setCreatureFlash(group: THREE.Group, amount: number): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    const base = material.userData.baseE as THREE.Color | undefined;
    if (!base || !material.emissive) return;
    if (amount > 0.02) {
      const hot = Math.min(1, amount / 1.6);
      material.emissive.setRGB(1, 0.42 + hot * 0.52, 0.18 + hot * 0.62);
      material.emissiveIntensity = 1.15 + amount * 1.4;
    } else {
      material.emissive.copy(base);
      material.emissiveIntensity = material.userData.baseI as number;
    }
  });
}
