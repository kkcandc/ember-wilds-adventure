import * as THREE from 'three';
import { WATER_LEVEL } from './content';
import { hash2 } from './noise';
import type { GrassField } from './worldfeel';
import type { WorldData } from './worldgen';
import type { MaterialId } from './types';

const box = new THREE.BoxGeometry(1, 1, 1);
const sph = new THREE.IcosahedronGeometry(0.5, 0);
const cone = new THREE.ConeGeometry(0.5, 1, 6);
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.6, 5);
const leafGeo = new THREE.ConeGeometry(0.85, 1.8, 6);
const rockGeo = new THREE.DodecahedronGeometry(0.55, 0);
const grassGeo = new THREE.ConeGeometry(0.18, 0.7, 4);
const plane = new THREE.PlaneGeometry(1.4, 1.4);

export interface Scenery {
  root: THREE.Group;
  sky: THREE.Mesh;
  skyMat: THREE.ShaderMaterial;
  waterMat: THREE.ShaderMaterial;
  stars: THREE.Points;
  beaconFires: Map<string, THREE.Mesh>;
  nodeMeshes: Map<string, THREE.Group>;
  steleMeshes: Map<string, THREE.Group>;
  cacheMeshes: Map<string, THREE.Group>;
  pillarFires: THREE.Mesh[];
  motePositions: Float32Array;
  moteBase: Float32Array;
  moteAttr: THREE.BufferAttribute;
  grass: GrassField | null;
  dispose: () => void;
}

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function standard(color: number, emissive = 0, intensity = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: intensity,
    roughness: 0.82,
    metalness: 0.04,
    flatShading: true,
  });
}

export function buildScenery(world: WorldData): Scenery {
  const root = new THREE.Group();
  const disposables: { geo?: THREE.BufferGeometry; mat?: THREE.Material }[] = [];

  const terrain = buildTerrain(world);
  terrain.receiveShadow = true;
  terrain.frustumCulled = false;
  root.add(terrain);
  disposables.push({ geo: terrain.geometry, mat: terrain.material as THREE.Material });

  const waterGeo = new THREE.PlaneGeometry(520, 520, 48, 48);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uNight: { value: 0 },
    },
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.z += sin(position.x * 0.18 + uTime * 1.3) * 0.18;
        p.z += cos(position.y * 0.14 + uTime) * 0.12;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uNight;
      varying vec2 vUv;
      void main() {
        float ripple = sin(vUv.x * 50.0) * sin(vUv.y * 36.0);
        vec3 deep = vec3(0.08, 0.32, 0.38);
        vec3 shoal = vec3(0.20, 0.55, 0.52);
        vec3 col = mix(deep, shoal, 0.35 + ripple * 0.08);
        col = mix(col, col * 0.35, uNight);
        gl_FragColor = vec4(col, 0.72);
      }
    `,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = WATER_LEVEL;
  water.renderOrder = 2;
  water.frustumCulled = false;
  root.add(water);
  disposables.push({ geo: waterGeo, mat: waterMat });

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSunElev: { value: 0.4 },
      uSunAz: { value: 0.2 },
      uDay: { value: 1 },
      uLow: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vDir = worldPos.xyz - cameraPosition;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uSunElev;
      uniform float uSunAz;
      uniform float uDay;
      uniform float uLow;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 zenith = mix(vec3(0.07, 0.09, 0.16), vec3(0.33, 0.58, 0.86), uDay);
        vec3 hor = mix(vec3(0.16, 0.14, 0.2), vec3(0.95, 0.62, 0.36), clamp(uLow + uDay * 0.25, 0.0, 1.0));
        hor = mix(hor, vec3(0.98, 0.42, 0.24), uLow);
        float t = smoothstep(-0.08, 0.48, h);
        vec3 col = mix(hor, zenith, t);
        vec3 sunDir = normalize(vec3(uSunAz, max(uSunElev, -0.2), 0.2));
        float sun = pow(max(dot(dir, sunDir), 0.0), 420.0);
        col += vec3(1.0, 0.86, 0.55) * sun * (0.35 + uDay);
        float moon = pow(max(dot(dir, normalize(-sunDir)), 0.0), 520.0);
        col += vec3(0.75, 0.84, 1.0) * moon * (1.0 - uDay) * 1.4;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 24, 16), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  root.add(sky);
  disposables.push({ geo: sky.geometry, mat: skyMat });

  const starCount = 280;
  const starPos = new Float32Array(starCount * 3);
  let written = 0;
  for (let i = 0; i < 800 && written < starCount; i++) {
    const a = hash2(i, 2, 11) * Math.PI * 2;
    const y = hash2(i, 9, 12) * 2 - 0.15;
    if (y < 0.15) continue;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const r = 390;
    starPos[written * 3] = Math.cos(a) * ring * r;
    starPos[written * 3 + 1] = y * r;
    starPos[written * 3 + 2] = Math.sin(a) * ring * r;
    written++;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xf4efe6, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0 }),
  );
  stars.frustumCulled = false;
  root.add(stars);
  disposables.push({ geo: starGeo, mat: stars.material as THREE.Material });

  addInstances(root, disposables, trunkGeo, world.trees, (p) => {
    const dummy = new THREE.Object3D();
    dummy.position.set(p.x, p.y + 0.8 * p.scale, p.z);
    dummy.scale.set(p.scale, p.scale, p.scale);
    dummy.rotation.y = p.rot;
    dummy.updateMatrix();
    return { matrix: dummy.matrix, color: new THREE.Color(p.variant === 1 ? '#6a5344' : '#6b4632') };
  });
  addInstances(root, disposables, leafGeo, world.trees, (p) => {
    const dummy = new THREE.Object3D();
    dummy.position.set(p.x, p.y + 2.15 * p.scale, p.z);
    dummy.scale.setScalar(p.scale * (p.variant === 1 ? 0.8 : 1));
    dummy.rotation.y = p.rot;
    dummy.updateMatrix();
    const color = p.variant === 1 ? new THREE.Color('#7a6848') : new THREE.Color().setHSL(0.3, 0.42, 0.22 + (p.scale % 0.2));
    return { matrix: dummy.matrix, color };
  });
  addInstances(root, disposables, rockGeo, world.rocks, (p) => {
    const dummy = new THREE.Object3D();
    dummy.position.set(p.x, p.y + 0.25 * p.scale, p.z);
    dummy.scale.setScalar(p.scale);
    dummy.rotation.set(p.rot * 0.2, p.rot, p.scale);
    dummy.updateMatrix();
    const color = p.variant === 1 ? '#4a403c' : p.variant === 2 ? '#8a8494' : '#6d6458';
    return { matrix: dummy.matrix, color: new THREE.Color(color) };
  });
  const grassMesh = addInstances(root, disposables, grassGeo, world.grasses, (p) => {
    const dummy = new THREE.Object3D();
    dummy.position.set(p.x, p.y + 0.25 * p.scale, p.z);
    dummy.scale.setScalar(p.scale);
    dummy.rotation.y = p.rot;
    dummy.updateMatrix();
    return { matrix: dummy.matrix, color: new THREE.Color().setHSL(0.28, 0.45, 0.32 + (p.scale % 0.15)) };
  });
  const grass: GrassField | null = grassMesh
    ? {
        mesh: grassMesh,
        tufts: world.grasses.map((p) => ({ x: p.x, y: p.y, z: p.z, rot: p.rot, scale: p.scale })),
        base: new Float32Array(grassMesh.instanceMatrix.array),
      }
    : null;
  if (grassMesh) grassMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  addInstances(root, disposables, grassGeo, world.reeds, (p) => {
    const dummy = new THREE.Object3D();
    dummy.position.set(p.x, p.y + 0.35 * p.scale, p.z);
    dummy.scale.set(p.scale * 0.45, p.scale * 1.4, p.scale * 0.45);
    dummy.rotation.y = p.rot;
    dummy.updateMatrix();
    return { matrix: dummy.matrix, color: new THREE.Color('#c2b07a') };
  });
  const crackMat = new THREE.MeshBasicMaterial({ color: 0xff5a24 });
  const cracks = new THREE.InstancedMesh(plane, crackMat, Math.max(1, world.cracks.length));
  cracks.frustumCulled = false;
  const dummy = new THREE.Object3D();
  world.cracks.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.x = -Math.PI / 2;
    dummy.rotation.z = p.rot;
    dummy.scale.set(p.scale, p.scale * 0.45, 1);
    dummy.updateMatrix();
    cracks.setMatrixAt(i, dummy.matrix);
  });
  if (world.cracks.length === 0) cracks.count = 0;
  cracks.instanceMatrix.needsUpdate = true;
  root.add(cracks);
  disposables.push({ mat: crackMat });

  const stone = lambert(0x8a8478);
  const ruinMat = lambert(0x6e6878);
  const pierMat = lambert(0xb08960);
  for (const block of world.ruins) {
    const mesh = new THREE.Mesh(box, block.h < 0.4 ? pierMat : ruinMat);
    mesh.position.set(block.x, block.y, block.z);
    mesh.scale.set(block.w, block.h, block.d);
    mesh.rotation.y = block.rot;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  const pillarFires: THREE.Mesh[] = [];
  for (const pillar of world.pillars) {
    const mesh = new THREE.Mesh(cyl, stone);
    mesh.position.set(pillar.x, pillar.y + pillar.h / 2, pillar.z);
    mesh.scale.set(pillar.r, pillar.h, pillar.r);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    if (pillar.h > 2.4) {
      const fire = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: 0xff6a2c }));
      fire.position.set(pillar.x, pillar.y + pillar.h + 0.45, pillar.z);
      fire.scale.set(0.35, 0.7, 0.35);
      fire.visible = false;
      root.add(fire);
      pillarFires.push(fire);
    }
  }

  const beaconFires = new Map<string, THREE.Mesh>();
  for (const beacon of world.beacons) {
    const group = new THREE.Group();
    const foot = new THREE.Mesh(cyl, stone);
    foot.scale.set(1.15, 0.35, 1.15);
    foot.position.y = 0.18;
    const column = new THREE.Mesh(cyl, lambert(0x9a9284));
    column.scale.set(0.42, 2.5, 0.42);
    column.position.y = 1.45;
    const fire = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: 0xff7a32 }));
    fire.position.y = 2.95;
    fire.scale.set(0.55, 0.9, 0.55);
    fire.visible = false;
    column.castShadow = true;
    group.add(foot, column, fire);
    group.position.set(beacon.x, beacon.y, beacon.z);
    root.add(group);
    beaconFires.set(beacon.id, fire);
  }

  for (const shrine of world.shrines) {
    const group = new THREE.Group();
    const foot = new THREE.Mesh(cyl, lambert(0xcbb892));
    foot.scale.set(1.3, 0.28, 1.3);
    foot.position.y = 0.14;
    const column = new THREE.Mesh(cyl, lambert(0xe6d7b8));
    column.scale.set(0.28, 2.1, 0.28);
    column.position.y = 1.2;
    const ember = new THREE.Mesh(sph, new THREE.MeshBasicMaterial({ color: 0xffb15a }));
    ember.scale.setScalar(0.22);
    ember.position.y = 2.45;
    column.castShadow = true;
    group.add(foot, column, ember);
    group.position.set(shrine.x, shrine.y, shrine.z);
    root.add(group);
  }

  const nodeMeshes = new Map<string, THREE.Group>();
  for (const node of world.nodes) {
    const mesh = buildNode(node.kind);
    mesh.position.set(node.x, node.y, node.z);
    root.add(mesh);
    nodeMeshes.set(node.id, mesh);
  }

  const steleMeshes = new Map<string, THREE.Group>();
  for (const stele of world.steles) {
    const group = new THREE.Group();
    const slab = new THREE.Mesh(box, lambert(0xd9d3c5));
    slab.scale.set(0.42, 1.55, 0.16);
    slab.position.y = 0.78;
    slab.castShadow = true;
    const glyph = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xffc27a }));
    glyph.scale.set(0.08, 0.55, 0.04);
    glyph.position.set(0, 0.9, 0.1);
    group.add(slab, glyph);
    group.position.set(stele.x, stele.y, stele.z);
    group.userData.glyph = glyph;
    root.add(group);
    steleMeshes.set(stele.id, group);
  }

  const cacheMeshes = new Map<string, THREE.Group>();
  for (const cache of world.caches) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(box, standard(0x6a4a32));
    body.scale.set(0.85, 0.42, 0.55);
    body.position.y = 0.21;
    body.castShadow = true;
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.42, -0.22);
    const lid = new THREE.Mesh(box, standard(0x8a6240));
    lid.scale.set(0.88, 0.12, 0.55);
    lid.position.set(0, 0.06, 0.22);
    pivot.add(lid);
    group.add(body, pivot);
    group.position.set(cache.x, cache.y, cache.z);
    group.userData.lid = pivot;
    root.add(group);
    cacheMeshes.set(cache.id, group);
  }

  const moteCount = 110;
  const motePositions = new Float32Array(moteCount * 3);
  const moteBase = new Float32Array(moteCount * 3);
  const moteColors = new Float32Array(moteCount * 3);
  const sources = [...world.trees.slice(0, 70), ...world.cracks.slice(0, 40)];
  for (let i = 0; i < moteCount; i++) {
    const src = sources[i % Math.max(1, sources.length)];
    const lava = i >= 70;
    moteBase[i * 3] = (src?.x ?? 0) + (hash2(i, 1, 4) - 0.5) * 4;
    moteBase[i * 3 + 1] = (src?.y ?? 2) + 1.2 + hash2(i, 2, 4);
    moteBase[i * 3 + 2] = (src?.z ?? 0) + (hash2(i, 3, 4) - 0.5) * 4;
    motePositions.set(moteBase.subarray(i * 3, i * 3 + 3), i * 3);
    const color = new THREE.Color(lava ? '#ff7a3c' : '#d6f5a3');
    moteColors[i * 3] = color.r;
    moteColors[i * 3 + 1] = color.g;
    moteColors[i * 3 + 2] = color.b;
  }
  const moteGeo = new THREE.BufferGeometry();
  const moteAttr = new THREE.BufferAttribute(motePositions, 3);
  moteGeo.setAttribute('position', moteAttr);
  moteGeo.setAttribute('color', new THREE.BufferAttribute(moteColors, 3));
  const motes = new THREE.Points(
    moteGeo,
    new THREE.PointsMaterial({ size: 0.18, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  motes.frustumCulled = false;
  root.add(motes);
  disposables.push({ geo: moteGeo, mat: motes.material as THREE.Material });

  return {
    root,
    sky,
    skyMat,
    waterMat,
    stars,
    beaconFires,
    nodeMeshes,
    steleMeshes,
    cacheMeshes,
    pillarFires,
    motePositions,
    moteBase,
    moteAttr,
    grass,
    dispose() {
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        const geo = mesh.geometry as THREE.BufferGeometry | undefined;
        if (geo && !SHARED_GEOS.has(geo)) geo.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose();
      });
      root.removeFromParent();
      disposables.length = 0;
    },
  };
}

function buildTerrain(world: WorldData): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(480, 480, 150, 150);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = world.heightAt(x, z);
    pos.setY(i, h);
    const biome = world.biomeAt(x, z);
    const heat = world.heatAt(x, z);
    if (h < WATER_LEVEL - 0.15) color.set('#143f49');
    else if (biome === 'coast') color.set(h < WATER_LEVEL + 0.45 ? '#a88862' : '#d7bc8e');
    else if (biome === 'lava') color.set(heat > 0.74 ? '#6a2e24' : '#3c342f');
    else if (biome === 'ruins') color.set('#6d6876');
    else color.set(h > 8 ? '#3e6844' : '#5c8748');
    const n = hash2(i, i % 17, 5);
    color.offsetHSL(0, 0, (n - 0.5) * 0.06);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

const SHARED_GEOS = new Set<THREE.BufferGeometry>([box, sph, cone, cyl, trunkGeo, leafGeo, rockGeo, grassGeo, plane]);

function addInstances<T>(
  root: THREE.Group,
  disposables: { geo?: THREE.BufferGeometry; mat?: THREE.Material }[],
  geo: THREE.BufferGeometry,
  props: T[],
  place: (prop: T, index: number) => { matrix: THREE.Matrix4; color: THREE.Color },
): THREE.InstancedMesh | null {
  if (props.length === 0) return null;
  const material = new THREE.MeshLambertMaterial({ flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, material, props.length);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  props.forEach((prop, index) => {
    const placed = place(prop, index);
    mesh.setMatrixAt(index, placed.matrix);
    mesh.setColorAt(index, placed.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  root.add(mesh);
  disposables.push({ mat: material });
  return mesh;
}

function buildNode(kind: MaterialId): THREE.Group {
  const group = new THREE.Group();
  if (kind === 'wood') {
    for (const rot of [0.2, 1.1, 2.2]) {
      const log = new THREE.Mesh(cyl, lambert(0x8a5a32));
      log.scale.set(0.16, 1.1, 0.16);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = rot;
      log.position.y = 0.28;
      group.add(log);
    }
  } else if (kind === 'stone') {
    const rock = new THREE.Mesh(rockGeo, lambert(0x8d8680));
    rock.position.y = 0.35;
    rock.scale.setScalar(0.9);
    group.add(rock);
  } else if (kind === 'fiber') {
    for (let i = 0; i < 4; i++) {
      const tuft = new THREE.Mesh(cone, lambert(0x7dbe55));
      tuft.scale.set(0.35, 0.7, 0.35);
      tuft.position.set(Math.cos(i) * 0.22, 0.35, Math.sin(i) * 0.22);
      group.add(tuft);
    }
  } else if (kind === 'cinder') {
    const rock = new THREE.Mesh(rockGeo, standard(0x2a2422, 0xff4d1a, 0.35));
    rock.position.y = 0.32;
    const glow = new THREE.Mesh(sph, new THREE.MeshBasicMaterial({ color: 0xff6a2c }));
    glow.scale.setScalar(0.16);
    glow.position.y = 0.55;
    group.add(rock, glow);
  } else if (kind === 'pearl') {
    const ring = new THREE.Mesh(cyl, lambert(0xd9c7a2));
    ring.scale.set(0.55, 0.12, 0.55);
    ring.position.y = 0.08;
    const pearl = new THREE.Mesh(sph, new THREE.MeshBasicMaterial({ color: 0xd7fff6 }));
    pearl.scale.setScalar(0.16);
    pearl.position.y = 0.28;
    group.add(ring, pearl);
  }
  return group;
}
