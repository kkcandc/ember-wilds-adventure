import * as THREE from 'three';

/**
 * Traversal feel for Ember Wilds.
 * The shared kit at github.com/kkcandc/web-demo-juice-kit only publishes a
 * README, so foot dust, the sprint streak, the FOV kick, landing squash, and
 * grass that parts live here with no extra dependencies.
 * prefers-reduced-motion turns off the camera kick, streak, squash, and grass sway.
 */

export const BUILD_MARKER = 'worldfeel-2026-10-25';

export const BASE_FOV = 66;
export const DASH_FOV = 81;
export const LAND_SEC = 0.2;

const POOL = 40;
const GRASS_REACH = 4.1;

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** `amount` is 0 while walking, ~0.62 while sprinting, and 1 during a dash. */
export function strideFov(current: number, amount: number, dt: number, reduced: boolean): number {
  if (reduced) return BASE_FOV;
  const t = Math.min(1, Math.max(0, amount));
  const target = BASE_FOV + (DASH_FOV - BASE_FOV) * t;
  if (dt <= 0) return current;
  const k = 1 - Math.exp(-8 * dt);
  return current + (target - current) * k;
}

/** Age is seconds since landing, or negative when the pose is idle. */
export function squashScale(age: number, reduced: boolean): [number, number, number] {
  if (reduced || age < 0 || age > LAND_SEC) return [1, 1, 1];
  const u = 1 - age / LAND_SEC;
  const s = Math.sin(u * Math.PI);
  return [1 + 0.16 * s, 1 - 0.26 * s, 1 + 0.16 * s];
}

export function strideLean(amount: number, reduced: boolean): number {
  if (reduced) return 0;
  return Math.min(1, Math.max(0, amount)) * 0.2;
}

export interface GrassTuft {
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
}

export interface GrassField {
  mesh: THREE.InstancedMesh;
  tufts: GrassTuft[];
  base: Float32Array;
}

export class GrassPart {
  private bent = new Set<number>();
  private still = new Set<number>();
  private dummy = new THREE.Object3D();
  private up = new THREE.Vector3();
  private lastX = 1e9;
  private lastZ = 1e9;

  reset(): void {
    this.bent.clear();
    this.still.clear();
    this.lastX = 1e9;
    this.lastZ = 1e9;
  }

  sync(field: GrassField | null, px: number, pz: number, enabled: boolean): void {
    if (!field) {
      this.bent.clear();
      return;
    }
    if (enabled && this.bent.size > 0) {
      const moved = (px - this.lastX) * (px - this.lastX) + (pz - this.lastZ) * (pz - this.lastZ);
      if (moved < 0.0004) return;
    }
    this.lastX = px;
    this.lastZ = pz;
    const mesh = field.mesh;
    const arr = mesh.instanceMatrix.array as Float32Array;
    this.still.clear();
    let dirty = false;
    if (enabled) {
      const reachSq = GRASS_REACH * GRASS_REACH;
      const tufts = field.tufts;
      for (let i = 0; i < tufts.length; i++) {
        const g = tufts[i];
        const dx = g.x - px;
        const dz = g.z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 > reachSq || d2 < 0.01) continue;
        const d = Math.sqrt(d2);
        const closeness = 1 - d / GRASS_REACH;
        const lean = closeness * 1.05;
        const inv = 1 / d;
        const push = closeness * 0.9;
        const half = 0.35 * g.scale;
        this.dummy.rotation.set(dz * inv * lean, g.rot, -dx * inv * lean);
        this.dummy.scale.setScalar(g.scale);
        this.up.set(0, half, 0).applyEuler(this.dummy.rotation);
        this.dummy.position.set(g.x + dx * inv * push, g.y + 0.25 * g.scale - half, g.z + dz * inv * push).add(this.up);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
        this.still.add(i);
        this.bent.add(i);
        dirty = true;
      }
    }
    for (const i of this.bent) {
      if (this.still.has(i)) continue;
      arr.set(field.base.subarray(i * 16, i * 16 + 16), i * 16);
      this.bent.delete(i);
      dirty = true;
    }
    if (dirty) mesh.instanceMatrix.needsUpdate = true;
  }
}

function puffTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Ember Wilds could not paint foot dust.');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const ASH = [0xe7d7be, 0xcbb79a, 0xa89478] as const;
const EMBER = [0xfff1d2, 0xffc14a, 0xff7a3c] as const;

export class StrideFx {
  readonly root = new THREE.Group();
  private positions = new Float32Array(POOL * 3);
  private velocities = new Float32Array(POOL * 3);
  private colors = new Float32Array(POOL * 3);
  private lives = new Float32Array(POOL);
  private gravity = new Float32Array(POOL);
  private points: THREE.Points;
  private ribbonPivot = new THREE.Group();
  private ribbon: THREE.Mesh;
  private ribbonMat: THREE.MeshBasicMaterial;
  private ribbonOpacity = 0;
  private ribbonTarget = 0;
  private trailCd = 0;
  private tex: THREE.Texture;
  private tint = new THREE.Color();

  get reduced(): boolean {
    return prefersReducedMotion();
  }

  constructor() {
    this.tex = puffTexture();
    for (let i = 0; i < POOL; i++) this.positions[i * 3 + 1] = -400;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.85,
        map: this.tex,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        opacity: 0.9,
        sizeAttenuation: true,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.root.add(this.points);
    this.ribbonMat = new THREE.MeshBasicMaterial({
      map: this.tex,
      color: 0xff8a3c,
      transparent: true,
      depthWrite: false,
      opacity: 0,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 2.4), this.ribbonMat);
    this.ribbon.rotation.x = -Math.PI / 2;
    this.ribbon.renderOrder = 3;
    this.ribbon.frustumCulled = false;
    this.ribbonPivot.add(this.ribbon);
    this.ribbonPivot.visible = false;
    this.ribbonPivot.frustumCulled = false;
    this.root.add(this.ribbonPivot);
  }

  foot(x: number, y: number, z: number, dx: number, dz: number, sprinting: boolean): void {
    if (this.reduced) {
      this.burst(x, y + 0.12, z, 1, ASH, 0.15, 0.35, 0.22, -0.2);
      return;
    }
    const n = sprinting ? 4 : 3;
    const backX = x - dx * 0.28;
    const backZ = z - dz * 0.28;
    this.burst(backX, y + 0.1, backZ, n, ASH, 1.15, 1.6, 0.2, -1.4);
  }

  land(x: number, y: number, z: number): void {
    if (this.reduced) return;
    this.burst(x, y + 0.08, z, 8, ASH, 2.4, 1.3, 0.15, -2.2);
  }

  aim(x: number, y: number, z: number, dx: number, dz: number, amount: number, dt: number): void {
    const moving = dx * dx + dz * dz > 0.2;
    this.ribbonTarget = this.reduced || !moving ? 0 : Math.min(1, Math.max(0, amount));
    if (this.ribbonTarget > 0.04) {
      const len = 1.25 + this.ribbonTarget * 1.7;
      this.ribbonPivot.position.set(x - dx * len * 0.42, y + 0.09, z - dz * len * 0.42);
      this.ribbonPivot.rotation.y = Math.atan2(dx, dz);
      this.ribbon.scale.y = len / 2.4;
      this.ribbonMat.color.setHex(this.ribbonTarget > 0.85 ? 0xffe2a8 : 0xff7a32);
    }
    if (this.reduced || this.ribbonTarget < 0.45) return;
    this.trailCd -= dt;
    if (this.trailCd > 0) return;
    this.trailCd = this.ribbonTarget > 0.85 ? 0.035 : 0.06;
    const side = Math.random() < 0.5 ? -1 : 1;
    const px = x - dx * (0.35 + Math.random() * 0.25) + -dz * side * 0.16;
    const pz = z - dz * (0.35 + Math.random() * 0.25) + dx * side * 0.16;
    this.burst(px, y + 0.16, pz, 1, EMBER, 0.35, 1.1, 0.28, 0.4);
  }

  update(dt: number): void {
    const fade = 1 - Math.exp(-dt * 10);
    this.ribbonOpacity += (this.ribbonTarget - this.ribbonOpacity) * fade;
    this.ribbonMat.opacity = this.ribbonOpacity * 0.82;
    this.ribbonPivot.visible = this.ribbonOpacity > 0.03;
    if (dt <= 0) return;
    let alive = false;
    for (let i = 0; i < POOL; i++) {
      if (this.lives[i] <= 0) continue;
      alive = true;
      this.lives[i] -= dt;
      const o = i * 3;
      if (this.lives[i] <= 0) {
        this.positions[o + 1] = -400;
        continue;
      }
      this.velocities[o + 1] += this.gravity[i] * dt;
      this.positions[o] += this.velocities[o] * dt;
      this.positions[o + 1] += this.velocities[o + 1] * dt;
      this.positions[o + 2] += this.velocities[o + 2] * dt;
    }
    if (alive) (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private burst(
    x: number,
    y: number,
    z: number,
    count: number,
    palette: readonly number[],
    speed: number,
    lift: number,
    spread: number,
    gravity: number,
  ): void {
    let spawned = 0;
    for (let i = 0; i < POOL && spawned < count; i++) {
      if (this.lives[i] > 0) continue;
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * spread;
      const o = i * 3;
      this.lives[i] = 0.32 + Math.random() * 0.2;
      this.gravity[i] = gravity;
      this.positions[o] = x + Math.cos(ang) * rad;
      this.positions[o + 1] = y + Math.random() * 0.08;
      this.positions[o + 2] = z + Math.sin(ang) * rad;
      this.velocities[o] = Math.cos(ang) * speed * (0.35 + Math.random() * 0.65);
      this.velocities[o + 1] = lift * (0.45 + Math.random() * 0.55);
      this.velocities[o + 2] = Math.sin(ang) * speed * (0.35 + Math.random() * 0.65);
      this.tint.setHex(palette[spawned % palette.length]);
      this.colors[o] = this.tint.r;
      this.colors[o + 1] = this.tint.g;
      this.colors[o + 2] = this.tint.b;
      spawned++;
    }
    if (spawned > 0) {
      (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
