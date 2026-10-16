import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AudioBus } from './audio';
import {
  ARMOR_HP,
  ARMOR_NAME,
  BIOME_LABEL,
  CREATURES,
  DAY_SECONDS,
  MAP_EXTENT,
  MAP_RES,
  MATERIAL_NAME,
  MATERIALS,
  RECIPES,
  SAVE_KEY,
  WATER_LEVEL,
  WEAPONS,
  compassLabel,
  facingLabel,
} from './content';
import { ASH_SPARKS, EMBER_SPARKS, HIT_STOP_KILL_SEC, HIT_STOP_SEC, cameraKick } from './hitfeel';
import { Hud, type CraftRow, type PackView, type Panel } from './hud';
import { applyHeroGear, createCreature, createHero, setCreatureFlash, type HeroMesh } from './models';
import { clamp, smoothstep } from './noise';
import { buildScenery, type Scenery } from './scenery';
import type { ArmorId, Biome, CreatureKind, CreatureSpawn, MaterialId, WeaponId } from './types';
import { createWorld, type WorldData } from './worldgen';

interface BootOptions {
  seed: string | null;
  play: boolean;
  cont: boolean;
  tod: string | null;
  debug: boolean;
}

interface RunState {
  mats: Record<MaterialId, number>;
  weapons: WeaponId[];
  weapon: WeaponId;
  armors: ArmorId[];
  armor: ArmorId;
  cloak: boolean;
  striders: boolean;
  lantern: boolean;
  memory: boolean;
  kindling: number;
  heartwine: number;
  beacons: Set<string>;
  rested: Set<string>;
  respawnId: string;
  steles: Set<string>;
  caches: Set<string>;
  seen: Set<Biome>;
  bossDefeated: boolean;
  kills: number;
  play: number;
  tutorial: number;
}

interface SaveData {
  v: 1;
  seedKey: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  stamina: number;
  timeOfDay: number;
  thirdPerson: boolean;
  mats: Record<MaterialId, number>;
  weapons: WeaponId[];
  weapon: WeaponId;
  armors: ArmorId[];
  armor: ArmorId;
  cloak: boolean;
  striders: boolean;
  lantern: boolean;
  memory: boolean;
  kindling: number;
  heartwine: number;
  beacons: string[];
  rested: string[];
  respawnId: string;
  steles: string[];
  caches: string[];
  seen: Biome[];
  bossDefeated: boolean;
  kills: number;
  play: number;
  tutorial: number;
  explored: string;
  nodes: { id: string; amount: number; regenAt: number }[];
  actors: { id: string; hp: number; deadUntil: number }[];
}

interface Actor {
  spawn: CreatureSpawn;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: 'idle' | 'chase' | 'windup' | 'recover' | 'charge' | 'dead';
  timer: number;
  deadUntil: number;
  flash: number;
  recoil: number;
  recoilX: number;
  recoilZ: number;
  baseScale: number;
  group: THREE.Group;
  bar: THREE.Group;
  barFill: THREE.Mesh;
  homeX: number;
  homeZ: number;
  wander: number;
  chargeX: number;
  chargeZ: number;
  nextSummon: number;
  bob: number;
}

interface Shot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  dmg: number;
  gravity: boolean;
  mesh: THREE.Mesh;
}

interface Floater {
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  life: number;
  kind: 'note' | 'hit' | 'kill';
}

interface LiveNode {
  amount: number;
  max: number;
  regenAt: number;
}

const SPARK_POOL = 200;

class Sparks {
  private positions = new Float32Array(SPARK_POOL * 3);
  private velocities = new Float32Array(SPARK_POOL * 3);
  private lives = new Float32Array(SPARK_POOL);
  private colors = new Float32Array(SPARK_POOL * 3);
  readonly points: THREE.Points;

  constructor() {
    for (let i = 0; i < SPARK_POOL; i++) this.positions[i * 3 + 1] = -400;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.24, vertexColors: true, transparent: true, depthWrite: false }),
    );
    this.points.frustumCulled = false;
  }

  burst(x: number, y: number, z: number, hex: number, count: number): void {
    this.spray(x, y, z, count, [hex], 3.2, 2.2, 0.05);
  }

  hit(x: number, y: number, z: number): void {
    this.spray(x, y, z, 18, EMBER_SPARKS, 4.6, 2.8, 0.42);
  }

  killPuff(x: number, y: number, z: number): void {
    this.spray(x, y, z, 28, EMBER_SPARKS, 5.6, 3.6, 0.7);
    this.spray(x, y + 0.15, z, 20, ASH_SPARKS, 3.6, 2.8, 0.85);
  }

  private spray(x: number, y: number, z: number, count: number, palette: readonly number[], speed: number, lift: number, spread: number): void {
    let spawned = 0;
    for (let i = 0; i < SPARK_POOL && spawned < count; i++) {
      if (this.lives[i] > 0) continue;
      const color = new THREE.Color(palette[spawned % palette.length]);
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * spread;
      this.lives[i] = 0.32 + Math.random() * 0.3;
      this.positions[i * 3] = x + Math.cos(ang) * rad;
      this.positions[i * 3 + 1] = y + (Math.random() - 0.25) * spread;
      this.positions[i * 3 + 2] = z + Math.sin(ang) * rad;
      this.velocities[i * 3] = Math.cos(ang) * speed * (0.4 + Math.random());
      this.velocities[i * 3 + 1] = lift * (0.4 + Math.random());
      this.velocities[i * 3 + 2] = Math.sin(ang) * speed * (0.4 + Math.random());
      this.colors[i * 3] = color.r;
      this.colors[i * 3 + 1] = color.g;
      this.colors[i * 3 + 2] = color.b;
      spawned++;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < SPARK_POOL; i++) {
      if (this.lives[i] <= 0) continue;
      this.lives[i] -= dt;
      this.velocities[i * 3 + 1] -= 7 * dt;
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      if (this.lives[i] <= 0) this.positions[i * 3 + 1] = -400;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}

function emptyMats(): Record<MaterialId, number> {
  return { wood: 0, stone: 0, fiber: 0, cinder: 0, pearl: 0, relic: 0 };
}

function encodeBytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 4096)));
  }
  return btoa(bin);
}

function decodeBytes(value: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  try {
    const bin = atob(value);
    for (let i = 0; i < length && i < bin.length; i++) out[i] = bin.charCodeAt(i);
  } catch {
    out.fill(0);
  }
  return out;
}

function disposeMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(66, 1, 0.08, 520);
  private composer: EffectComposer;
  private hemi: THREE.HemisphereLight;
  private dir: THREE.DirectionalLight;
  private lantern: THREE.PointLight;
  private calderaLight: THREE.PointLight;
  private fog = new THREE.Fog(0xc9b39a, 16, 90);
  private hud: Hud;
  private audio = new AudioBus();
  private sparks = new Sparks();
  private hero: HeroMesh;
  private blob: THREE.Mesh;
  private shock: THREE.Mesh;
  private worldRoot = new THREE.Group();
  private world: WorldData | null = null;
  private scenery: Scenery | null = null;
  private actors: Actor[] = [];
  private shots: Shot[] = [];
  private nodes = new Map<string, LiveNode>();
  private run: RunState = this.freshRun();
  private mode: 'title' | 'play' | 'dead' = 'title';
  private panel: Panel = 'none';
  private keys = new Set<string>();
  private just = new Set<string>();
  private yaw = 0;
  private pitch = 0.35;
  private player = { x: 0, y: 0, z: 0, vy: 0 };
  private hp = 100;
  private stamina = 100;
  private readonly maxStamina = 100;
  private grounded = false;
  private thirdPerson = true;
  private iframe = 0;
  private attackCd = 0;
  private swing = 0;
  private dashT = 0;
  private dashCd = 0;
  private dashX = 0;
  private dashZ = 0;
  private sprintLock = false;
  private guarding = false;
  private rmb = false;
  private attackQueued = false;
  private dragging = false;
  private dragX = 0;
  private dragY = 0;
  private moved = 0;
  private gatherCd = 0;
  private footCd = 0;
  private hurtV = 0;
  private shake = 0;
  private hitStop = 0;
  private kick = 0;
  private kickTime = 0;
  private impactLife = 0;
  private impactMax = 0.2;
  private puffLife = 0;
  private puffMax = 0.48;
  private impactGlow: THREE.Mesh;
  private puffRing: THREE.Mesh;
  private burnAcc = 0;
  private burnNote = 0;
  private timeOfDay = 0.24 * DAY_SECONDS;
  private clock = 0;
  private autosave = 0;
  private deathT = 0;
  private titleOrbit = 0.4;
  private last = 0;
  private previewToken = 0;
  private waveId = 1;
  private combat = 0;
  private bootTod: number | null = null;
  private explored = new Uint8Array(MAP_RES * MAP_RES);
  private exploreCanvas = document.createElement('canvas');
  private exploreCtx: CanvasRenderingContext2D;
  private floaters: Floater[] = [];
  private readonly look = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly proj = new THREE.Vector3();
  private readonly fogColor = new THREE.Color();
  private shotGeo = new THREE.SphereGeometry(0.18, 8, 6);
  private stoneMat = new THREE.MeshStandardMaterial({ color: 0x9a9286, roughness: 0.7 });
  private wispMat = new THREE.MeshBasicMaterial({ color: 0xffb15a });
  private started = false;

  constructor(private canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.fog = this.fog;
    this.hemi = new THREE.HemisphereLight(0xffe0c2, 0x3a4a32, 0.72);
    this.dir = new THREE.DirectionalLight(0xfff1dd, 1.35);
    this.dir.castShadow = true;
    this.dir.shadow.mapSize.set(1024, 1024);
    this.dir.shadow.camera.near = 1;
    this.dir.shadow.camera.far = 70;
    this.dir.shadow.camera.left = -26;
    this.dir.shadow.camera.right = 26;
    this.dir.shadow.camera.top = 26;
    this.dir.shadow.camera.bottom = -26;
    this.dir.shadow.bias = -0.0004;
    this.lantern = new THREE.PointLight(0xffb15a, 0, 18, 1.6);
    this.calderaLight = new THREE.PointLight(0xff5a24, 2, 28, 1.4);
    this.scene.add(this.hemi, this.dir, this.dir.target, this.lantern, this.calderaLight, this.worldRoot, this.sparks.points);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.38, 0.88));
    this.composer.addPass(new OutputPass());
    this.hero = createHero();
    this.hero.group.visible = false;
    this.scene.add(this.hero.group);
    this.blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 14),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.scene.add(this.blob);
    this.shock = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.55, 28),
      new THREE.MeshBasicMaterial({ color: 0xff6a2c, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    this.shock.rotation.x = -Math.PI / 2;
    this.shock.visible = false;
    this.impactGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0xfff4e2,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.impactGlow.visible = false;
    this.puffRing = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.52, 28),
      new THREE.MeshBasicMaterial({
        color: 0xff8a3c,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.puffRing.rotation.x = -Math.PI / 2;
    this.puffRing.visible = false;
    this.scene.add(this.impactGlow, this.puffRing);
    this.exploreCanvas.width = MAP_RES;
    this.exploreCanvas.height = MAP_RES;
    const ctx = this.exploreCanvas.getContext('2d');
    if (!ctx) throw new Error('Map failed to start.');
    this.exploreCtx = ctx;
    this.hud = new Hud(ui, {
      embark: (seed) => this.embark(seed),
      continue: () => this.continueRun(),
      abandon: () => this.abandon(),
      seedPreview: (seed) => this.previewSeed(seed),
      craft: (id) => this.craft(id),
      equipWeapon: (id) => this.equipWeapon(id),
      equipArmor: (id) => this.equipArmor(id),
      open: (panel) => this.toggle(panel),
      close: () => this.setPanel('none'),
      resume: () => this.setPanel('none'),
      toTitle: () => this.toTitle(),
      saveNow: () => {
        this.save();
        this.hud.toast('Checkpoint kept.');
      },
      fullscreen: () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      },
      mute: () => this.toggleMute(),
      drink: () => this.drink(),
      travel: (x, z) => this.travel(x, z),
      wake: () => this.respawn(),
    });
    this.audio.setMuted(this.hud.isMuted());
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('beforeunload', () => {
      if (this.mode === 'play') this.save();
    });
    this.resize();
  }

  boot(opts: BootOptions): void {
    const seed = (opts.seed || 'ember').trim() || 'ember';
    this.hud.setSeed(seed);
    this.hud.showTitle();
    this.hud.setSignature('······', true);
    this.refreshContinue();
    if (opts.tod) {
      const value = Number(opts.tod);
      if (!Number.isNaN(value)) this.bootTod = value;
    }
    requestAnimationFrame(() => {
      this.buildWorld(seed);
      if (opts.cont && this.readSave()) this.continueRun();
      else if (opts.play) this.embark(seed);
      if (opts.debug) this.exposeDebug();
      this.last = performance.now();
      if (!this.started) {
        this.started = true;
        requestAnimationFrame(this.loop);
      }
    });
  }

  private get w(): WorldData {
    if (!this.world) throw new Error('The wild is not charted yet.');
    return this.world;
  }

  private loop = (now: number): void => {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;
    const frameDt = dt;
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - frameDt);
      dt = 0;
    }
    this.clock += dt;
    this.animateWorld(dt, frameDt);
    if (this.mode === 'title') this.updateTitle(dt);
    else if (this.mode === 'dead') {
      this.deathT -= dt;
      if (this.deathT <= 0) this.respawn();
    } else if (this.mode === 'play') {
      if (this.panel === 'none') this.updatePlay(dt);
      else this.hotkeys();
    }
    this.updateCamera(frameDt);
    this.drawMaps();
    this.syncHud();
    this.composer.render();
    this.just.clear();
    requestAnimationFrame(this.loop);
  };

  private updatePlay(dt: number): void {
    this.timeOfDay += dt;
    this.run.play += dt;
    this.iframe = Math.max(0, this.iframe - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.gatherCd = Math.max(0, this.gatherCd - dt);
    this.swing = Math.max(0, this.swing - dt);
    this.hurtV = Math.max(0, this.hurtV - dt * 1.4);
    if (this.attackQueued || this.just.has('KeyJ')) {
      this.attackQueued = false;
      this.melee();
    }
    if (this.keys.has('ArrowLeft')) this.yaw += dt * 1.7;
    if (this.keys.has('ArrowRight')) this.yaw -= dt * 1.7;
    if (this.keys.has('ArrowUp')) this.pitch += dt * 1.2;
    if (this.keys.has('ArrowDown')) this.pitch -= dt * 1.2;
    this.pitch = clamp(this.pitch, this.thirdPerson ? -0.85 : -1.2, this.thirdPerson ? 1.05 : 1.25);
    this.guarding = (this.keys.has('KeyX') || this.rmb) && this.stamina > 1;
    this.updatePlayer(dt);
    this.updateActors(dt);
    this.updateShots(dt);
    this.updateNodes(dt);
    this.environment(dt);
    if (this.just.has('KeyE')) this.interact(true);
    else if (this.keys.has('KeyE')) this.interact(false);
    if (this.just.has('KeyQ')) this.dash();
    if (this.just.has('Space')) this.jump();
    if (this.just.has('Digit1')) this.drink();
    if (this.just.has('KeyV')) {
      this.thirdPerson = !this.thirdPerson;
      this.hud.toast(this.thirdPerson ? 'Third person.' : 'First person.');
    }
    this.hotkeys();
    this.autosave += dt;
    if (this.autosave > 40) {
      this.autosave = 0;
      this.save();
    }
    this.markExplored(this.player.x, this.player.z, 2);
    this.tutorial();
    this.noteBiome();
  }

  private hotkeys(): void {
    if (this.just.has('KeyC')) this.toggle('craft');
    if (this.just.has('KeyI')) this.toggle('inventory');
    if (this.just.has('KeyM')) this.toggle('map');
    if (this.just.has('Escape')) {
      if (this.panel !== 'none') this.setPanel('none');
      else this.setPanel('pause');
    }
  }

  private updatePlayer(dt: number): void {
    let ix = 0;
    let iz = 0;
    if (this.keys.has('KeyW')) iz += 1;
    if (this.keys.has('KeyS')) iz -= 1;
    if (this.keys.has('KeyA')) ix -= 1;
    if (this.keys.has('KeyD')) ix += 1;
    const len = Math.hypot(ix, iz) || 1;
    ix /= len;
    iz /= len;
    const moving = ix !== 0 || iz !== 0;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const wishX = fx * iz + rx * ix;
    const wishZ = fz * iz + rz * ix;
    const groundHere = this.w.heightAt(this.player.x, this.player.z);
    const wet = groundHere < WATER_LEVEL + 0.25;
    const sprinting = this.keys.has('ShiftLeft') && moving && this.stamina > (this.sprintLock ? 14 : 0) && !this.guarding;
    if (sprinting) {
      this.stamina -= 17 * dt;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.sprintLock = true;
      }
    } else {
      const regen = this.guarding ? 4 : 16;
      this.stamina = Math.min(this.maxStamina, this.stamina + regen * dt);
      if (this.stamina > 14) this.sprintLock = false;
    }
    if (this.guarding) this.stamina = Math.max(0, this.stamina - 8 * dt);
    let speed = (sprinting ? 8.7 : 5.15) * (this.run.striders ? 1.26 : 1);
    if (this.guarding) speed *= 0.62;
    if (wet) speed *= 0.7;
    let mx = wishX * speed;
    let mz = wishZ * speed;
    if (this.dashT > 0) {
      this.dashT -= dt;
      mx = this.dashX * 16.5;
      mz = this.dashZ * 16.5;
    }
    let nx = this.player.x + mx * dt;
    let nz = this.player.z + mz * dt;
    if (Math.hypot(nx, nz) > 176) {
      nx = this.player.x;
      nz = this.player.z;
    }
    const nextH = this.w.heightAt(nx, nz);
    const horiz = Math.hypot(nx - this.player.x, nz - this.player.z);
    if (nextH < 0.7 || (this.grounded && horiz > 0.0001 && nextH > groundHere + 0.25 && (nextH - groundHere) / horiz > 2.55)) {
      nx = this.player.x;
      nz = this.player.z;
    }
    const resolved = this.resolve(nx, nz);
    const resolvedH = this.w.heightAt(resolved.x, resolved.z);
    if (resolvedH >= 0.7) {
      this.player.x = resolved.x;
      this.player.z = resolved.z;
    }
    this.player.vy -= 30 * dt;
    this.player.y += this.player.vy * dt;
    const ground = this.w.heightAt(this.player.x, this.player.z);
    if (this.player.y <= ground) {
      this.player.y = ground;
      this.player.vy = 0;
      this.grounded = true;
    } else this.grounded = false;
    if (moving && this.grounded) {
      this.footCd -= dt;
      if (this.footCd <= 0) {
        this.footCd = sprinting ? 0.28 : 0.42;
        this.audio.footsteps();
      }
    }
    const bob = moving && this.grounded ? Math.sin(this.clock * (sprinting ? 12 : 8)) * 0.045 : 0;
    this.hero.group.visible = this.thirdPerson;
    this.hero.group.position.set(this.player.x, this.player.y + bob, this.player.z);
    this.hero.group.rotation.y = this.yaw;
    const swingT = this.swing > 0 ? 1 - this.swing / 0.22 : 0;
    this.hero.hand.rotation.x = -0.55 - Math.sin(swingT * Math.PI) * 1.45;
    this.blob.position.set(this.player.x, this.player.y + 0.06, this.player.z);
    this.blob.visible = this.thirdPerson;
  }

  private resolve(x: number, z: number): { x: number; z: number } {
    let cx = x;
    let cz = z;
    const colliders = this.w.colliders;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        const dx = cx - c.x;
        const dz = cz - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + 0.42;
        if (d < min && d > 0.0001) {
          const push = (min - d) / d;
          cx += dx * push;
          cz += dz * push;
        }
      }
    }
    return { x: cx, z: cz };
  }

  private jump(): void {
    if (this.grounded) this.player.vy = 8.3;
  }

  private dash(): void {
    if (this.dashCd > 0 || this.stamina < 22) return;
    let ix = 0;
    let iz = 0;
    if (this.keys.has('KeyW')) iz += 1;
    if (this.keys.has('KeyS')) iz -= 1;
    if (this.keys.has('KeyA')) ix -= 1;
    if (this.keys.has('KeyD')) ix += 1;
    if (ix === 0 && iz === 0) iz = 1;
    const len = Math.hypot(ix, iz);
    ix /= len;
    iz /= len;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    this.dashX = fx * iz + rx * ix;
    this.dashZ = fz * iz + rz * ix;
    this.dashT = 0.18;
    this.dashCd = 0.72;
    this.iframe = Math.max(this.iframe, 0.26);
    this.stamina -= 22;
    this.audio.play('dash');
  }

  private melee(): void {
    if (this.attackCd > 0 || this.stamina < 8 || this.panel !== 'none') return;
    const weapon = WEAPONS[this.run.weapon];
    this.attackCd = weapon.cooldown;
    this.swing = 0.22;
    this.stamina -= 8;
    this.audio.play('swing');
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    let hit = false;
    const dmg = weapon.dmg * (this.run.memory ? 1.12 : 1);
    for (const actor of this.actors) {
      if (actor.state === 'dead') continue;
      const dx = actor.x - this.player.x;
      const dz = actor.z - this.player.z;
      const dist = Math.hypot(dx, dz);
      const reach = weapon.range + CREATURES[actor.spawn.kind].radius * 0.35;
      if (dist > reach || dist < 0.001) continue;
      if ((dx / dist) * fx + (dz / dist) * fz < Math.cos(0.9)) continue;
      this.damageActor(actor, dmg, weapon.knock);
      hit = true;
    }
    if (hit) this.audio.play('hit');
    else this.chop();
  }

  private chop(): void {
    const node = this.nearestNode(2.4);
    if (!node || this.gatherCd > 0) return;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const dx = node.x - this.player.x;
    const dz = node.z - this.player.z;
    const dist = Math.hypot(dx, dz) || 1;
    if ((dx / dist) * fx + (dz / dist) * fz < 0.15) return;
    this.gatherNode(node.id);
  }

  private damageActor(actor: Actor, amount: number, knock: number): void {
    if (actor.state === 'dead') return;
    const killing = actor.hp <= amount;
    actor.hp -= amount;
    actor.flash = killing ? 0.34 : 0.28;
    const dx = actor.x - this.player.x;
    const dz = actor.z - this.player.z;
    const dist = Math.hypot(dx, dz) || 1;
    const nx = dx / dist;
    const nz = dz / dist;
    actor.x += nx * knock * 0.35;
    actor.z += nz * knock * 0.35;
    actor.recoil = 1;
    actor.recoilX = nx;
    actor.recoilZ = nz;
    const radius = CREATURES[actor.spawn.kind].radius;
    const ix = actor.x - nx * radius * 0.85;
    const iy = actor.y + 1.05;
    const iz = actor.z - nz * radius * 0.85;
    // No crits in this game — a killing blow is the golden pop.
    this.float(ix, iy + (killing ? 0.85 : 0.55), iz, `${Math.round(amount)}`, killing ? '#ffd56a' : '#fff6ea', killing ? 'kill' : 'hit');
    if (killing) this.sparks.killPuff(ix, iy, iz);
    else this.sparks.hit(ix, iy, iz);
    this.flashImpact(ix, iy, iz, killing);
    this.kick = killing ? 1 : 0.78;
    this.hitStop = Math.max(this.hitStop, killing ? HIT_STOP_KILL_SEC : HIT_STOP_SEC);
    if (killing) this.kill(actor);
    else if (actor.state === 'idle') actor.state = 'chase';
  }

  private flashImpact(x: number, y: number, z: number, killing: boolean): void {
    this.impactMax = killing ? 0.32 : 0.2;
    this.impactLife = this.impactMax;
    this.impactGlow.position.set(x, y, z);
    this.impactGlow.visible = true;
    (this.impactGlow.material as THREE.MeshBasicMaterial).color.setHex(killing ? 0xffd56a : 0xfff6ea);
  }

  private kill(actor: Actor): void {
    if (actor.state === 'dead') return;
    actor.state = 'dead';
    actor.hp = 0;
    actor.group.visible = false;
    actor.bar.visible = false;
    const def = CREATURES[actor.spawn.kind];
    actor.deadUntil = def.respawn > 0 ? Date.now() + def.respawn * 1000 : Number.POSITIVE_INFINITY;
    if (!actor.spawn.summon) {
      for (const key of MATERIALS) {
        const count = def.loot[key];
        if (!count) continue;
        if (key === 'relic' && actor.spawn.kind === 'sentinel' && ((actor.homeX * 13 + actor.homeZ) % 1) > 0.72) continue;
        this.run.mats[key] += count;
        this.float(actor.x, actor.y + 1.4, actor.z, `+${count} ${MATERIAL_NAME[key]}`, '#f0c27a');
      }
    }
    this.run.kills += 1;
    this.puffMax = 0.5;
    this.puffLife = this.puffMax;
    this.puffRing.position.set(actor.x, actor.y + 0.22, actor.z);
    this.puffRing.scale.setScalar(0.35);
    this.puffRing.visible = true;
    (this.puffRing.material as THREE.MeshBasicMaterial).opacity = 0.85;
    if (actor.spawn.kind === 'warden') {
      this.run.bossDefeated = true;
      this.audio.play('boss');
      this.hud.toast('The Ash Warden stills. The caldera exhales.');
      for (const other of this.actors) {
        if (other.spawn.summon && other.state !== 'dead') {
          other.state = 'dead';
          other.hp = 0;
          other.group.visible = false;
          other.bar.visible = false;
        }
      }
      this.save();
    } else if (this.run.tutorial === 4) {
      this.run.tutorial = 5;
      this.hud.toast('The Grove Beacon is the first promise. Craft kindling, then kindle it.');
    }
  }

  private hurt(amount: number, fromX?: number, fromZ?: number): void {
    if (this.iframe > 0 || this.mode !== 'play' || this.hp <= 0) return;
    let dmg = amount;
    if (this.guarding && this.stamina > 0 && fromX !== undefined && fromZ !== undefined) {
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const dx = fromX - this.player.x;
      const dz = fromZ - this.player.z;
      const dist = Math.hypot(dx, dz) || 1;
      if ((dx / dist) * fx + (dz / dist) * fz > 0.2) {
        dmg *= 0.3;
        this.stamina = Math.max(0, this.stamina - 12);
        this.audio.play('block');
      }
    }
    if (this.run.armor === 'mail') dmg *= 0.75;
    else if (this.run.armor === 'vest') dmg *= 0.88;
    this.hp -= dmg;
    this.iframe = Math.max(this.iframe, 0.5);
    this.hurtV = 0.62;
    this.shake = Math.min(1, this.shake + 0.4);
    this.audio.play('hurt');
    this.float(this.player.x, this.player.y + 1.7, this.player.z, `${Math.round(dmg)}`, '#ffb4a8');
    if (fromX !== undefined && fromZ !== undefined) {
      const dx = this.player.x - fromX;
      const dz = this.player.z - fromZ;
      const dist = Math.hypot(dx, dz) || 1;
      this.player.x += (dx / dist) * 0.45;
      this.player.z += (dz / dist) * 0.45;
    }
    if (this.hp <= 0) this.die();
  }

  private burn(dps: number, dt: number): void {
    this.hp -= dps * dt;
    this.hurtV = Math.max(this.hurtV, 0.28);
    this.burnNote -= dt;
    if (this.burnNote <= 0) {
      this.burnNote = 0.7;
      this.float(this.player.x, this.player.y + 1.5, this.player.z, 'heat', '#ff7a3c');
    }
    if (this.hp <= 0) this.die();
  }

  private environment(dt: number): void {
    if (this.run.cloak) return;
    let heat = 0;
    const cd = Math.hypot(this.player.x - this.w.caldera.x, this.player.z - this.w.caldera.z);
    if (cd < 11.5) heat += this.run.beacons.size >= 4 ? 6 : 13;
    for (const node of this.w.nodes) {
      if (node.kind !== 'cinder') continue;
      if (Math.hypot(node.x - this.player.x, node.z - this.player.z) < 2.35) heat += 8;
    }
    if (heat > 0) this.burn(heat, dt);
  }

  private die(): void {
    this.mode = 'dead';
    this.hp = 0;
    this.deathT = 2.6;
    this.audio.play('death');
    document.exitPointerLock?.();
    const shrine = this.w.shrines.find((entry) => entry.id === this.run.respawnId) ?? this.w.shrines[0];
    this.setPanel('death');
    this.hud.renderDeath(shrine.name);
  }

  private respawn(): void {
    if (this.mode !== 'dead') return;
    const shrine = this.w.shrines.find((entry) => entry.id === this.run.respawnId) ?? this.w.shrines[0];
    this.player.x = shrine.x + 1.8;
    this.player.z = shrine.z + 1.2;
    this.player.y = this.w.heightAt(this.player.x, this.player.z);
    this.player.vy = 0;
    this.hp = this.maxHp() * 0.66;
    this.stamina = this.maxStamina;
    this.iframe = 1.4;
    this.mode = 'play';
    this.setPanel('none');
    this.hud.toast(`You wake at the ${shrine.name}.`);
    this.save();
  }

  private updateActors(dt: number): void {
    this.combat = 0;
    const sun = this.sunState();
    for (const actor of this.actors) {
      const def = CREATURES[actor.spawn.kind];
      if (actor.state === 'dead') {
        actor.group.visible = false;
        actor.bar.visible = false;
        if (this.canRespawn(actor) && Date.now() >= actor.deadUntil) this.revive(actor);
        continue;
      }
      const dx = this.player.x - actor.x;
      const dz = this.player.z - actor.z;
      const distP = Math.hypot(dx, dz);
      if (distP > 80) {
        actor.group.visible = false;
        actor.bar.visible = false;
        continue;
      }
      actor.group.visible = true;
      let aggro = distP < def.aggro;
      const homeD = Math.hypot(actor.x - actor.homeX, actor.z - actor.homeZ);
      if (homeD > 30) aggro = false;
      if (actor.hp < actor.maxHp && distP < def.aggro + 8) aggro = true;
      if (actor.spawn.kind === 'wisp') {
        const shy = sun.night < 0.45 || this.run.lantern;
        if (shy && actor.hp >= actor.maxHp - 0.1 && distP > 5.2) aggro = false;
      }
      if (aggro && (actor.state === 'chase' || actor.state === 'windup' || actor.state === 'charge')) {
        this.combat = Math.max(this.combat, clamp(1 - distP / 18, 0, 1));
      }
      if (actor.state === 'recover') {
        actor.timer -= dt;
        if (actor.timer <= 0) actor.state = 'idle';
      } else if (actor.state === 'charge') {
        actor.x += actor.chargeX * 10.5 * dt;
        actor.z += actor.chargeZ * 10.5 * dt;
        actor.timer -= dt;
        if (distP < def.range + 0.3) {
          this.hurt(def.dmg, actor.x, actor.z);
          actor.state = 'recover';
          actor.timer = 0.55;
        } else if (actor.timer <= 0) actor.state = 'idle';
      } else if (actor.state === 'windup') {
        actor.timer -= dt;
        this.face(actor, this.player.x, this.player.z);
        if (actor.spawn.kind === 'warden' && actor.hp / actor.maxHp < 0.4) {
          this.shock.visible = true;
          this.shock.position.set(actor.x, actor.y + 0.15, actor.z);
          const grow = 1 + (1 - Math.max(actor.timer, 0) / 0.48) * 8;
          this.shock.scale.setScalar(grow);
        }
        if (actor.timer <= 0) {
          const phase = actor.hp / actor.maxHp;
          if (def.ranged && distP > 2.3) this.shoot(actor, def.dmg, actor.spawn.kind === 'wisp' ? 8 : 12);
          else if (distP < def.range + 0.85) this.hurt(def.dmg, actor.x, actor.z);
          if (actor.spawn.kind === 'warden' && phase < 0.4 && distP < 6.2) this.hurt(def.dmg * 0.85, actor.x, actor.z);
          this.shock.visible = false;
          actor.state = 'recover';
          actor.timer = phase < 0.4 && actor.spawn.kind === 'warden' ? 0.32 : 0.42;
        }
      } else if (aggro) {
        actor.state = 'chase';
        this.face(actor, this.player.x, this.player.z);
        if (actor.spawn.kind === 'warden' && actor.hp / actor.maxHp < 0.7 && this.clock > actor.nextSummon) {
          actor.nextSummon = this.clock + 13;
          this.summonHound(actor);
        }
        const meleeRange = def.ranged ? 2.3 : def.range;
        if (def.charge && distP > 4.2 && distP < 12 && Math.random() < dt * 0.55) {
          actor.state = 'charge';
          actor.timer = 0.62;
          actor.chargeX = dx / (distP || 1);
          actor.chargeZ = dz / (distP || 1);
        } else if (distP <= meleeRange) {
          actor.state = 'windup';
          actor.timer = actor.spawn.kind === 'warden' && actor.hp / actor.maxHp < 0.4 ? 0.48 : def.windup;
        } else if (def.ranged && distP <= def.range && distP > 3) {
          actor.state = 'windup';
          actor.timer = def.windup;
        } else if (def.ranged && distP < 3) {
          actor.x -= -Math.sin(actor.yaw) * def.speed * dt;
          actor.z -= -Math.cos(actor.yaw) * def.speed * dt;
        } else {
          actor.x += -Math.sin(actor.yaw) * def.speed * dt;
          actor.z += -Math.cos(actor.yaw) * def.speed * dt;
        }
      } else {
        actor.state = 'idle';
        if (homeD > 7) this.face(actor, actor.homeX, actor.homeZ);
        else {
          actor.wander -= dt;
          if (actor.wander <= 0) {
            actor.wander = 1.8 + Math.random() * 2.5;
            actor.yaw += (Math.random() - 0.5) * 1.6;
          }
        }
        const pace = homeD > 7 ? 2.2 : 0.55;
        actor.x += -Math.sin(actor.yaw) * pace * dt;
        actor.z += -Math.cos(actor.yaw) * pace * dt;
      }
      const ground = this.w.heightAt(actor.x, actor.z);
      if (ground < 0.8) {
        actor.x = actor.homeX;
        actor.z = actor.homeZ;
      }
      const fly = def.flying ? 2.15 + Math.sin(this.clock * 2 + actor.bob) * 0.35 : 0;
      const sink = actor.spawn.kind === 'lurker' && actor.state === 'idle' && distP > def.aggro ? 0.55 : 0;
      actor.y = this.w.heightAt(actor.x, actor.z);
      const recoil = actor.recoil * 0.82;
      actor.group.position.set(actor.x + actor.recoilX * recoil, actor.y + fly - sink, actor.z + actor.recoilZ * recoil);
      actor.group.rotation.y = actor.yaw;
      actor.recoil = Math.max(0, actor.recoil - dt * 5.4);
      if (actor.flash > 0) {
        actor.flash = Math.max(0, actor.flash - dt);
        setCreatureFlash(actor.group, actor.flash * 7);
        actor.group.scale.setScalar(actor.baseScale * (1 + Math.min(0.14, actor.flash * 0.5)));
      } else {
        actor.group.scale.setScalar(actor.baseScale);
      }
      const angry = actor.state === 'chase' || actor.state === 'windup' || actor.state === 'charge' || actor.hp < actor.maxHp;
      actor.bar.visible = distP < 26 && angry;
      const pct = clamp(actor.hp / actor.maxHp, 0, 1);
      actor.barFill.scale.x = Math.max(0.05, pct);
      (actor.barFill.material as THREE.MeshBasicMaterial).color.setHex(pct < 0.35 ? 0xff5d4a : 0xb6f0a4);
      const lift = actor.spawn.kind === 'warden' ? 4.4 : actor.spawn.kind === 'sentinel' ? 3.1 : actor.spawn.kind === 'wisp' ? 2.3 : 2;
      actor.bar.position.set(actor.x, actor.group.position.y + lift, actor.z);
      actor.bar.lookAt(this.camera.position);
    }
    this.separateActors();
  }

  private separateActors(): void {
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i];
      if (a.state === 'dead') continue;
      for (let j = i + 1; j < this.actors.length; j++) {
        const b = this.actors[j];
        if (b.state === 'dead') continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        const min = CREATURES[a.spawn.kind].radius + CREATURES[b.spawn.kind].radius;
        if (dist < min && dist > 0.001) {
          const push = ((min - dist) / dist) * 0.5;
          a.x -= dx * push;
          a.z -= dz * push;
          b.x += dx * push;
          b.z += dz * push;
        }
      }
    }
  }

  private face(actor: Actor, x: number, z: number): void {
    const dx = x - actor.x;
    const dz = z - actor.z;
    if (Math.hypot(dx, dz) > 0.001) actor.yaw = Math.atan2(-dx, -dz);
  }

  private shoot(actor: Actor, dmg: number, speed: number): void {
    if (this.shots.length > 14) {
      const old = this.shots.shift();
      old?.mesh.removeFromParent();
    }
    const dx = this.player.x - actor.x;
    const dy = this.player.y + 1.1 - (actor.y + 1.2);
    const dz = this.player.z - actor.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const mesh = new THREE.Mesh(this.shotGeo, actor.spawn.kind === 'wisp' ? this.wispMat : this.stoneMat);
    mesh.scale.setScalar(actor.spawn.kind === 'wisp' ? 0.7 : 0.55);
    this.worldRoot.add(mesh);
    this.shots.push({
      x: actor.x,
      y: actor.y + 1.2,
      z: actor.z,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      vz: (dz / len) * speed,
      life: 2.3,
      dmg,
      gravity: actor.spawn.kind === 'sentinel',
      mesh,
    });
  }

  private updateShots(dt: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i];
      shot.life -= dt;
      if (shot.gravity) shot.vy -= 8 * dt;
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.z += shot.vz * dt;
      shot.mesh.position.set(shot.x, shot.y, shot.z);
      const dist = Math.hypot(shot.x - this.player.x, shot.z - this.player.z);
      const hit = dist < 0.7 && Math.abs(shot.y - (this.player.y + 1)) < 1.15;
      if (hit) this.hurt(shot.dmg, shot.x, shot.z);
      if (hit || shot.life <= 0 || shot.y < this.w.heightAt(shot.x, shot.z)) {
        shot.mesh.removeFromParent();
        this.shots.splice(i, 1);
      }
    }
  }

  private summonHound(warden: Actor): void {
    const summon = this.actors.find((actor) => actor.spawn.summon && actor.state === 'dead');
    if (!summon) return;
    summon.hp = summon.maxHp;
    summon.state = 'chase';
    summon.deadUntil = 0;
    summon.x = warden.x + 2.5;
    summon.z = warden.z + 1.5;
    summon.group.visible = true;
    this.hud.toast('The Warden calls a cinder hound.');
  }

  private canRespawn(actor: Actor): boolean {
    if (actor.spawn.kind === 'warden' || actor.spawn.summon || actor.spawn.id.startsWith('wave-')) return false;
    if (actor.spawn.guardian) {
      const biome = actor.spawn.id.slice('guardian-'.length);
      if (this.run.beacons.has(`beacon-${biome}`)) return false;
    }
    return true;
  }

  private revive(actor: Actor): void {
    actor.hp = actor.maxHp;
    actor.state = 'idle';
    actor.x = actor.homeX;
    actor.z = actor.homeZ;
    actor.deadUntil = 0;
    actor.flash = 0;
    actor.recoil = 0;
    setCreatureFlash(actor.group, 0);
    actor.group.scale.setScalar(actor.baseScale);
    actor.group.visible = true;
  }

  private updateNodes(dt: number): void {
    void dt;
    const now = Date.now();
    for (const node of this.w.nodes) {
      const live = this.nodes.get(node.id);
      if (!live || live.amount > 0 || now < live.regenAt) continue;
      live.amount = live.max;
      const mesh = this.scenery?.nodeMeshes.get(node.id);
      if (mesh) mesh.visible = true;
    }
  }

  private interact(edge: boolean): void {
    if (this.panel !== 'none') return;
    if (edge) {
      const shrine = this.nearestShrine(2.8);
      if (shrine) {
        this.rest(shrine.id);
        return;
      }
      const beacon = this.nearestBeacon(2.7);
      if (beacon) {
        this.lightBeacon(beacon.id);
        return;
      }
      const stele = this.nearestStele(2.5);
      if (stele) {
        this.readStele(stele.id);
        return;
      }
      const cache = this.nearestCache(2.4);
      if (cache) {
        this.openCache(cache.id);
        return;
      }
    }
    if (this.gatherCd > 0) return;
    const node = this.nearestNode(2.45);
    if (node) this.gatherNode(node.id);
  }

  private gatherNode(id: string): void {
    const live = this.nodes.get(id);
    const spot = this.w.nodes.find((node) => node.id === id);
    if (!live || !spot || live.amount <= 0) return;
    this.gatherCd = 0.32;
    live.amount -= 1;
    const bonus = this.run.weapon !== 'fists' && (spot.kind === 'wood' || spot.kind === 'fiber') ? 2 : 1;
    this.run.mats[spot.kind] += bonus;
    this.audio.play('gather');
    this.float(spot.x, spot.y + 1.1, spot.z, `+${bonus} ${MATERIAL_NAME[spot.kind]}`, '#f0c27a');
    this.sparks.burst(spot.x, spot.y + 0.4, spot.z, 0xffc27a, 7);
    if (live.amount <= 0) {
      live.regenAt = Date.now() + 75000;
      const mesh = this.scenery?.nodeMeshes.get(id);
      if (mesh) mesh.visible = false;
    }
    if (this.run.tutorial === 2) {
      this.run.tutorial = 3;
      this.hud.toast('Press C and craft a Stone Hatchet.');
    }
    this.refreshPanels();
  }

  private rest(id: string): void {
    const shrine = this.w.shrines.find((entry) => entry.id === id);
    if (!shrine) return;
    this.hp = this.maxHp();
    this.stamina = this.maxStamina;
    this.run.respawnId = shrine.id;
    this.run.rested.add(shrine.id);
    this.iframe = 1;
    this.audio.play('shrine');
    this.sparks.burst(shrine.x, shrine.y + 1.4, shrine.z, 0xffb15a, 14);
    this.hud.toast(`${shrine.name} remembers you.`);
    this.save();
  }

  private lightBeacon(id: string): void {
    const beacon = this.w.beacons.find((entry) => entry.id === id);
    if (!beacon || this.run.beacons.has(id)) return;
    if (this.run.kindling <= 0) {
      this.hud.toast('Beacon kindling is crafted from cinder and emberwood.');
      return;
    }
    this.run.kindling -= 1;
    this.run.beacons.add(id);
    const fire = this.scenery?.beaconFires.get(id);
    if (fire) fire.visible = true;
    this.audio.play('beacon');
    this.sparks.burst(beacon.x, beacon.y + 2.4, beacon.z, 0xff7a3c, 20);
    const wave: CreatureKind = beacon.biome === 'ruins' ? 'sentinel' : beacon.biome === 'lava' ? 'hound' : beacon.biome === 'coast' ? 'lurker' : 'mossback';
    this.spawnWave(beacon.x, beacon.z, wave);
    this.spawnWave(beacon.x + 2, beacon.z - 1, beacon.biome === 'lava' ? 'hound' : 'mossback');
    if (this.run.beacons.size >= 4) {
      this.scenery?.pillarFires.forEach((pillar) => {
        pillar.visible = true;
      });
      this.weakenWarden();
      this.hud.toast('All four beacons burn. The caldera cools, and the Warden is weaker.');
    } else {
      const next = this.w.beacons.find((entry) => !this.run.beacons.has(entry.id));
      if (next) this.hud.toast(`${next.name} lies ${compassLabel(next.x - beacon.x, next.z - beacon.z)}.`);
    }
    this.save();
    this.refreshPanels();
  }

  private spawnWave(x: number, z: number, kind: CreatureKind): void {
    const angle = Math.random() * Math.PI * 2;
    const actor = this.makeActor({
      id: `wave-${this.waveId++}`,
      kind,
      x: x + Math.cos(angle) * 3.5,
      z: z + Math.sin(angle) * 3.5,
    });
    actor.state = 'chase';
  }

  private readStele(id: string): void {
    const stele = this.w.steles.find((entry) => entry.id === id);
    if (!stele) return;
    const fresh = !this.run.steles.has(id);
    this.run.steles.add(id);
    if (fresh && !this.run.memory && this.run.steles.size >= 8) {
      this.run.memory = true;
      this.hud.toast('Ember Memory. The steles stay in your hand.');
    }
    const group = this.scenery?.steleMeshes.get(id);
    const glyph = group?.userData.glyph as THREE.Mesh | undefined;
    if (glyph) (glyph.material as THREE.MeshBasicMaterial).color.set(0x8a7560);
    this.setPanel('read');
    this.hud.renderLore(stele.title, stele.text);
    if (fresh) this.save();
  }

  private openCache(id: string): void {
    if (this.run.caches.has(id)) return;
    const cache = this.w.caches.find((entry) => entry.id === id);
    if (!cache) return;
    this.run.caches.add(id);
    const bits: string[] = [];
    for (const key of MATERIALS) {
      const count = cache.loot[key];
      if (!count) continue;
      this.run.mats[key] += count;
      bits.push(`${count} ${MATERIAL_NAME[key]}`);
    }
    const lid = this.scenery?.cacheMeshes.get(id)?.userData.lid as THREE.Object3D | undefined;
    if (lid) lid.rotation.x = -1.15;
    this.audio.play('gather');
    this.hud.toast(bits.length ? `Cache: ${bits.join(', ')}.` : 'The cache was empty.');
    this.save();
    this.refreshPanels();
  }

  private travel(x: number, z: number): void {
    if (this.panel !== 'map' || this.mode !== 'play') return;
    let best: { id: string; name: string; x: number; z: number; d: number } | null = null;
    for (const shrine of this.w.shrines) {
      if (!this.run.rested.has(shrine.id)) continue;
      const d = Math.hypot(shrine.x - x, shrine.z - z);
      if (d < 12 && (!best || d < best.d)) best = { id: shrine.id, name: shrine.name, x: shrine.x, z: shrine.z, d };
    }
    if (!best) {
      this.hud.toast('Click a shrine you have already rested at.');
      return;
    }
    this.player.x = best.x + 1.6;
    this.player.z = best.z + 1.1;
    this.player.y = this.w.heightAt(this.player.x, this.player.z);
    this.player.vy = 0;
    this.iframe = 0.8;
    this.setPanel('none');
    this.hud.toast(`The embers carry you to the ${best.name}.`);
    this.audio.play('shrine');
  }

  private drink(): void {
    if (this.mode !== 'play' || this.run.heartwine <= 0 || this.hp <= 0) return;
    if (this.hp >= this.maxHp()) {
      this.hud.toast('You are already whole.');
      return;
    }
    this.run.heartwine -= 1;
    this.hp = Math.min(this.maxHp(), this.hp + 48);
    this.audio.play('drink');
    this.float(this.player.x, this.player.y + 1.8, this.player.z, '+48', '#b6f0a4');
    this.refreshPanels();
  }

  private craft(id: string): void {
    const recipe = RECIPES.find((entry) => entry.id === id);
    if (!recipe || !this.canCraft(recipe)) return;
    for (const key of MATERIALS) {
      const cost = recipe.cost[key] ?? 0;
      this.run.mats[key] -= cost;
    }
    if (recipe.kind === 'weapon' && recipe.weapon) {
      if (!this.run.weapons.includes(recipe.weapon)) this.run.weapons.push(recipe.weapon);
      this.run.weapon = recipe.weapon;
      if (this.run.tutorial < 4) {
        this.run.tutorial = 4;
        this.hud.toast('Left mouse bites. Something hungry is nearby.');
      }
    } else if (recipe.kind === 'armor' && recipe.armor) {
      const before = this.maxHp();
      if (!this.run.armors.includes(recipe.armor)) this.run.armors.push(recipe.armor);
      this.run.armor = recipe.armor;
      this.hp += Math.max(0, this.maxHp() - before);
    } else if (recipe.kind === 'perk' && recipe.perk) {
      this.run[recipe.perk] = true;
    } else if (recipe.consumable === 'kindling') this.run.kindling = Math.min(8, this.run.kindling + 1);
    else if (recipe.consumable === 'heartwine') this.run.heartwine = Math.min(8, this.run.heartwine + 1);
    applyHeroGear(this.hero, this.run.weapon, this.run.armor, this.run.cloak);
    this.audio.play('craft');
    this.hud.toast(`${recipe.name} is yours.`);
    this.refreshPanels();
    this.save();
  }

  private canCraft(recipe: (typeof RECIPES)[number]): boolean {
    if (recipe.weapon && this.run.weapons.includes(recipe.weapon)) return false;
    if (recipe.armor && this.run.armors.includes(recipe.armor)) return false;
    if (recipe.perk && this.run[recipe.perk]) return false;
    if (recipe.requiresWeapon && !this.run.weapons.includes(recipe.requiresWeapon)) return false;
    if (recipe.requiresArmor && !this.run.armors.includes(recipe.requiresArmor)) return false;
    if (recipe.consumable === 'kindling' && this.run.kindling >= 8) return false;
    if (recipe.consumable === 'heartwine' && this.run.heartwine >= 8) return false;
    return MATERIALS.every((key) => this.run.mats[key] >= (recipe.cost[key] ?? 0));
  }

  private equipWeapon(id: WeaponId): void {
    if (!this.run.weapons.includes(id)) return;
    this.run.weapon = id;
    applyHeroGear(this.hero, this.run.weapon, this.run.armor, this.run.cloak);
    this.refreshPanels();
  }

  private equipArmor(id: ArmorId): void {
    if (!this.run.armors.includes(id)) return;
    this.run.armor = id;
    this.hp = Math.min(this.hp, this.maxHp());
    applyHeroGear(this.hero, this.run.weapon, this.run.armor, this.run.cloak);
    this.refreshPanels();
  }

  private maxHp(): number {
    return ARMOR_HP[this.run.armor];
  }

  private freshRun(): RunState {
    return {
      mats: emptyMats(),
      weapons: ['fists'],
      weapon: 'fists',
      armors: ['none'],
      armor: 'none',
      cloak: false,
      striders: false,
      lantern: false,
      memory: false,
      kindling: 0,
      heartwine: 0,
      beacons: new Set(),
      rested: new Set(),
      respawnId: 'shrine-forest',
      steles: new Set(),
      caches: new Set(),
      seen: new Set(['forest']),
      bossDefeated: false,
      kills: 0,
      play: 0,
      tutorial: 0,
    };
  }

  private embark(seed: string): void {
    const key = seed.trim() || 'ember';
    if (!this.world || this.world.seedKey !== key) this.buildWorld(key);
    this.run = this.freshRun();
    this.thirdPerson = true;
    this.timeOfDay = (this.bootTod ?? 0.24) * DAY_SECONDS;
    this.bootTod = null;
    this.resetActors();
    this.resetNodes();
    this.placePlayer(this.w.spawn.x, this.w.spawn.z, true);
    this.hp = this.maxHp();
    this.stamina = this.maxStamina;
    this.explored.fill(0);
    this.repaintExplore();
    this.markExplored(this.player.x, this.player.z, 3);
    this.finishEnter();
  }

  private continueRun(): void {
    const save = this.readSave();
    if (!save) return;
    if (!this.world || this.world.seedKey !== save.seedKey) this.buildWorld(save.seedKey);
    this.hud.setSeed(save.seedKey);
    this.run = {
      mats: { ...emptyMats(), ...save.mats },
      weapons: save.weapons?.length ? save.weapons : ['fists'],
      weapon: save.weapon || 'fists',
      armors: save.armors?.length ? save.armors : ['none'],
      armor: save.armor || 'none',
      cloak: !!save.cloak,
      striders: !!save.striders,
      lantern: !!save.lantern,
      memory: !!save.memory,
      kindling: save.kindling || 0,
      heartwine: save.heartwine || 0,
      beacons: new Set(save.beacons || []),
      rested: new Set(save.rested || []),
      respawnId: save.respawnId || 'shrine-forest',
      steles: new Set(save.steles || []),
      caches: new Set(save.caches || []),
      seen: new Set(save.seen || ['forest']),
      bossDefeated: !!save.bossDefeated,
      kills: save.kills || 0,
      play: save.play || 0,
      tutorial: save.tutorial || 0,
    };
    this.thirdPerson = save.thirdPerson !== false;
    this.timeOfDay = save.timeOfDay ?? 0.24 * DAY_SECONDS;
    this.yaw = save.yaw || 0;
    this.pitch = save.pitch || 0.3;
    this.resetActors();
    this.applyActorSave(save);
    this.resetNodes(save.nodes);
    this.placePlayer(save.x, save.z, false);
    this.player.y = save.y || this.player.y;
    this.hp = clamp(save.hp || this.maxHp(), 1, this.maxHp());
    this.stamina = clamp(save.stamina || this.maxStamina, 0, this.maxStamina);
    const decoded = decodeBytes(save.explored || '', MAP_RES * MAP_RES);
    this.explored.fill(0);
    this.explored.set(decoded.subarray(0, this.explored.length));
    this.repaintExplore();
    this.finishEnter();
  }

  private finishEnter(): void {
    this.mode = 'play';
    this.panel = 'none';
    this.keys.clear();
    this.just.clear();
    this.hud.showPlay();
    this.hud.setPanel('none');
    applyHeroGear(this.hero, this.run.weapon, this.run.armor, this.run.cloak);
    this.refreshVisuals();
    this.audio.ensure();
    this.audio.play('ui');
    this.iframe = 1.2;
    this.save();
    if (this.run.tutorial === 0) {
      this.run.tutorial = 1;
      this.hud.toast('Click to look. WASD walks. The Grove Shrine is at your back.');
    }
  }

  private abandon(): void {
    localStorage.removeItem(SAVE_KEY);
    this.refreshContinue();
    this.hud.toast('Checkpoint abandoned.');
  }

  private toTitle(): void {
    if (this.mode === 'play' || this.mode === 'dead') this.save();
    this.mode = 'title';
    this.panel = 'none';
    this.hero.group.visible = false;
    this.blob.visible = false;
    this.hud.showTitle();
    this.hud.setPanel('none');
    document.exitPointerLock?.();
    this.refreshContinue();
  }

  private previewSeed(seed: string): void {
    if (this.mode !== 'title') return;
    const key = seed.trim() || 'ember';
    if (this.world?.seedKey === key) return;
    const token = ++this.previewToken;
    this.hud.setSignature('······', true);
    requestAnimationFrame(() => {
      if (token !== this.previewToken || this.mode !== 'title') return;
      this.buildWorld(key);
    });
  }

  private buildWorld(seed: string): void {
    this.clearActors();
    for (const shot of this.shots) shot.mesh.removeFromParent();
    this.shots = [];
    this.scenery?.dispose();
    this.worldRoot.clear();
    this.world = createWorld(seed);
    this.scenery = buildScenery(this.world);
    this.worldRoot.add(this.scenery.root);
    this.worldRoot.add(this.shock);
    this.nodes.clear();
    for (const node of this.world.nodes) this.nodes.set(node.id, { amount: node.amount, max: node.amount, regenAt: 0 });
    for (const spawn of [...this.world.creatures, this.world.boss]) this.makeActor(spawn);
    this.calderaLight.position.set(this.world.caldera.x, 6, this.world.caldera.z);
    this.hud.setSignature(this.world.signature, false);
  }

  private makeActor(spawn: CreatureSpawn): Actor {
    const group = createCreature(spawn.kind);
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 0.14),
      new THREE.MeshBasicMaterial({ color: 0x1a120f }),
    );
    const barFill = new THREE.Mesh(
      new THREE.PlaneGeometry(1.05, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xb6f0a4 }),
    );
    barFill.position.z = 0.02;
    bar.add(bg, barFill);
    bar.visible = false;
    const base = CREATURES[spawn.kind].hp;
    const actor: Actor = {
      spawn,
      hp: spawn.tutorial ? 30 : base,
      maxHp: spawn.tutorial ? 30 : base,
      x: spawn.x,
      y: this.w.heightAt(spawn.x, spawn.z),
      z: spawn.z,
      yaw: 0,
      state: 'idle',
      timer: 0,
      deadUntil: 0,
      flash: 0,
      recoil: 0,
      recoilX: 0,
      recoilZ: 0,
      baseScale: group.scale.x || 1,
      group,
      bar,
      barFill,
      homeX: spawn.x,
      homeZ: spawn.z,
      wander: Math.random() * 2,
      chargeX: 0,
      chargeZ: 0,
      nextSummon: 8,
      bob: Math.random() * 6,
    };
    if (spawn.summon) {
      actor.hp = 0;
      actor.state = 'dead';
      actor.group.visible = false;
      actor.deadUntil = Number.POSITIVE_INFINITY;
    }
    group.position.set(actor.x, actor.y, actor.z);
    this.worldRoot.add(group, bar);
    this.actors.push(actor);
    return actor;
  }

  private clearActors(): void {
    for (const actor of this.actors) {
      disposeMaterials(actor.group);
      disposeMaterials(actor.bar);
      actor.group.removeFromParent();
      actor.bar.removeFromParent();
    }
    this.actors = [];
  }

  private resetActors(): void {
    for (const actor of this.actors) {
      const base = actor.spawn.tutorial ? 30 : CREATURES[actor.spawn.kind].hp;
      const weakened = actor.spawn.kind === 'warden' && this.run.beacons.size >= 4;
      actor.maxHp = weakened ? Math.round(base * 0.72) : base;
      actor.x = actor.homeX;
      actor.z = actor.homeZ;
      actor.y = this.w.heightAt(actor.x, actor.z);
      actor.timer = 0;
      actor.flash = 0;
      actor.recoil = 0;
      setCreatureFlash(actor.group, 0);
      actor.group.scale.setScalar(actor.baseScale);
      if (actor.spawn.summon || (actor.spawn.kind === 'warden' && this.run.bossDefeated)) {
        actor.hp = 0;
        actor.state = 'dead';
        actor.group.visible = false;
        actor.deadUntil = Number.POSITIVE_INFINITY;
      } else {
        actor.hp = actor.maxHp;
        actor.state = 'idle';
        actor.group.visible = true;
        actor.deadUntil = 0;
      }
      actor.bar.visible = false;
    }
  }

  private applyActorSave(save: SaveData): void {
    const map = new Map((save.actors || []).map((entry) => [entry.id, entry]));
    for (const actor of this.actors) {
      const saved = map.get(actor.spawn.id);
      if (!saved) continue;
      actor.hp = saved.hp;
      actor.deadUntil = saved.deadUntil;
      if (saved.hp <= 0) {
        actor.state = 'dead';
        actor.group.visible = false;
        actor.hp = 0;
      } else {
        actor.state = 'idle';
        actor.group.visible = true;
      }
    }
  }

  private resetNodes(saved?: { id: string; amount: number; regenAt: number }[]): void {
    for (const node of this.w.nodes) this.nodes.set(node.id, { amount: node.amount, max: node.amount, regenAt: 0 });
    if (!saved) return;
    for (const entry of saved) {
      const live = this.nodes.get(entry.id);
      if (!live) continue;
      live.amount = entry.amount;
      live.regenAt = entry.regenAt;
    }
  }

  private weakenWarden(): void {
    const warden = this.actors.find((actor) => actor.spawn.kind === 'warden');
    if (!warden || this.run.bossDefeated) return;
    warden.maxHp = Math.round(CREATURES.warden.hp * 0.72);
    warden.hp = Math.min(warden.hp, warden.maxHp);
  }

  private refreshVisuals(): void {
    for (const beacon of this.w.beacons) {
      const fire = this.scenery?.beaconFires.get(beacon.id);
      if (fire) fire.visible = this.run.beacons.has(beacon.id);
    }
    const lit = this.run.beacons.size >= 4;
    this.scenery?.pillarFires.forEach((fire) => {
      fire.visible = lit;
    });
    for (const node of this.w.nodes) {
      const live = this.nodes.get(node.id);
      const mesh = this.scenery?.nodeMeshes.get(node.id);
      if (mesh && live) mesh.visible = live.amount > 0;
    }
    for (const cache of this.w.caches) {
      const lid = this.scenery?.cacheMeshes.get(cache.id)?.userData.lid as THREE.Object3D | undefined;
      if (lid) lid.rotation.x = this.run.caches.has(cache.id) ? -1.15 : 0;
    }
    for (const stele of this.w.steles) {
      const glyph = this.scenery?.steleMeshes.get(stele.id)?.userData.glyph as THREE.Mesh | undefined;
      if (glyph) (glyph.material as THREE.MeshBasicMaterial).color.set(this.run.steles.has(stele.id) ? 0x8a7560 : 0xffc27a);
    }
  }

  private placePlayer(x: number, z: number, faceBeacon: boolean): void {
    this.player.x = x;
    this.player.z = z;
    this.player.y = this.w.heightAt(x, z);
    this.player.vy = 0;
    if (faceBeacon) {
      const beacon = this.w.beacons.find((entry) => entry.biome === 'forest');
      if (beacon) this.yaw = Math.atan2(-(beacon.x - x), -(beacon.z - z));
    }
  }

  private updateTitle(dt: number): void {
    this.titleOrbit += dt * 0.12;
    const spawn = this.w.spawn;
    const radius = 26;
    this.camera.position.set(spawn.x + Math.sin(this.titleOrbit) * radius, spawn.y + 16, spawn.z + Math.cos(this.titleOrbit) * radius);
    this.camera.lookAt(spawn.x, spawn.y + 1.6, spawn.z);
    this.hero.group.visible = false;
  }

  private updateCamera(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 1.5);
    this.kickTime += dt;
    const sun = this.sunState();
    const focus = this.mode === 'title' ? this.w.spawn : this.player;
    if (this.mode !== 'title') {
      this.look.set(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      this.eye.set(this.player.x, this.player.y + 1.55, this.player.z);
      if (this.thirdPerson) {
        this.camera.position.copy(this.eye).addScaledVector(this.look, -5.7);
        this.camera.position.y += 0.45;
        const ground = this.w.heightAt(this.camera.position.x, this.camera.position.z) + 0.45;
        if (this.camera.position.y < ground) this.camera.position.y = ground;
        this.camera.lookAt(this.eye);
      } else {
        this.camera.position.copy(this.eye);
        this.camera.lookAt(this.eye.clone().add(this.look));
      }
      const mag = this.shake * this.shake;
      this.camera.position.x += Math.sin(this.clock * 46) * mag * 0.32;
      this.camera.position.y += Math.cos(this.clock * 33) * mag * 0.22;
      if (this.kick > 0) {
        const kick = cameraKick(this.kickTime, this.kick);
        this.camera.position.x += kick.x;
        this.camera.position.y += kick.y;
        this.kick = Math.max(0, this.kick - dt * 6.2);
      }
    }
    this.scenery?.sky.position.copy(this.camera.position);
    if (this.scenery) this.scenery.stars.position.copy(this.camera.position);
    this.dir.position.set(focus.x + sun.sunAz * 30, focus.y + Math.max(8, sun.sunElev * 34 + 10), focus.z + 12);
    this.dir.target.position.set(focus.x, focus.y, focus.z);
    this.dir.intensity = 0.22 + sun.day * 1.45;
    this.dir.color.set(sun.low > 0.4 ? 0xffb080 : 0xfff4e4);
    this.hemi.intensity = 0.28 + sun.day * 0.55;
    this.hemi.color.set(sun.day > 0.4 ? 0xffe2c4 : 0x8aa0c8);
    this.lantern.position.set(this.player.x, this.player.y + 1.4, this.player.z);
    this.lantern.intensity = this.run.lantern ? 6 + sun.night * 10 : 0;
    const nearCaldera = Math.hypot(this.player.x - this.w.caldera.x, this.player.z - this.w.caldera.z) < 40;
    this.calderaLight.intensity = nearCaldera ? 4 + this.run.beacons.size * 1.5 : 1.2;
    const nightFog = this.run.lantern ? 28 : 0;
    this.fog.near = 10 + sun.day * 10;
    this.fog.far = 42 + sun.day * 58 + nightFog;
    this.fogColor.set(sun.night > 0.6 ? '#1a2030' : sun.low > 0.45 ? '#e39a6a' : '#cbb79a');
    if (this.w.biomeAt(focus.x, focus.z) === 'lava') this.fogColor.lerp(new THREE.Color('#6a3a2c'), 0.35);
    this.fog.color.copy(this.fogColor);
    this.tickImpact(dt);
    if (this.scenery) {
      this.scenery.skyMat.uniforms.uSunElev.value = sun.sunElev;
      this.scenery.skyMat.uniforms.uSunAz.value = sun.sunAz;
      this.scenery.skyMat.uniforms.uDay.value = sun.day;
      this.scenery.skyMat.uniforms.uLow.value = sun.low;
      this.scenery.waterMat.uniforms.uNight.value = sun.night;
      (this.scenery.stars.material as THREE.PointsMaterial).opacity = sun.night * 0.9;
    }
  }

  private tickImpact(dt: number): void {
    if (this.impactLife > 0) {
      this.impactLife = Math.max(0, this.impactLife - dt);
      const u = this.impactMax > 0 ? this.impactLife / this.impactMax : 0;
      const mat = this.impactGlow.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, u) * 0.95;
      this.impactGlow.scale.setScalar(0.7 + (1 - u) * 2.6);
      this.impactGlow.visible = u > 0.03;
    }
    if (this.puffLife > 0) {
      this.puffLife = Math.max(0, this.puffLife - dt);
      const u = this.puffMax > 0 ? this.puffLife / this.puffMax : 0;
      const mat = this.puffRing.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, u) * 0.82;
      this.puffRing.scale.setScalar(0.4 + (1 - u) * 3.6);
      this.puffRing.visible = u > 0.03;
    }
  }

  private sunState(): { tod: number; sunElev: number; sunAz: number; day: number; low: number; night: number } {
    const tod = (this.timeOfDay % DAY_SECONDS) / DAY_SECONDS;
    const sunElev = Math.sin((tod - 0.2) * Math.PI * 2);
    const sunAz = Math.cos((tod - 0.2) * Math.PI * 2);
    const day = smoothstep(-0.05, 0.35, sunElev);
    const low = smoothstep(0.45, 0.04, sunElev) * smoothstep(-0.12, 0.2, sunElev);
    return { tod, sunElev, sunAz, day, low, night: 1 - day };
  }

  private animateWorld(_dt: number, frameDt: number): void {
    this.sparks.update(frameDt);
    if (!this.scenery) return;
    this.scenery.waterMat.uniforms.uTime.value = this.clock;
    const pos = this.scenery.motePositions;
    const base = this.scenery.moteBase;
    for (let i = 0; i < base.length; i += 3) {
      pos[i] = base[i] + Math.sin(this.clock * 0.7 + i) * 0.45;
      pos[i + 1] = base[i + 1] + Math.sin(this.clock * 1.5 + i) * 0.28;
      pos[i + 2] = base[i + 2] + Math.cos(this.clock * 0.55 + i) * 0.45;
    }
    this.scenery.moteAttr.needsUpdate = true;
    for (const fire of this.scenery.beaconFires.values()) {
      if (!fire.visible) continue;
      fire.scale.y = 0.75 + Math.sin(this.clock * 6 + fire.position.x) * 0.18;
    }
  }

  private tutorial(): void {
    if (this.run.tutorial === 1 && Math.hypot(this.player.x - this.w.spawn.x, this.player.z - this.w.spawn.z) > 4) {
      this.run.tutorial = 2;
      this.hud.toast('Press E on emberwood, stone, and fiber.');
    }
  }

  private noteBiome(): void {
    const biome = this.w.biomeAt(this.player.x, this.player.z);
    if (this.run.seen.has(biome)) return;
    this.run.seen.add(biome);
    const shrine = this.w.shrines.find((entry) => entry.biome === biome);
    this.hud.toast(`${BIOME_LABEL[biome]}. ${shrine ? shrine.name + ' can hold a checkpoint.' : ''}`);
  }

  private prompt(): string {
    const shrine = this.nearestShrine(2.8);
    if (shrine) return `E  Rest at the ${shrine.name}`;
    const beacon = this.nearestBeacon(2.7);
    if (beacon) {
      if (this.run.beacons.has(beacon.id)) return `${beacon.name} burns`;
      if (this.run.kindling > 0) return `E  Kindle the ${beacon.name}`;
      return `E  ${beacon.name} needs kindling`;
    }
    const stele = this.nearestStele(2.5);
    if (stele) return `E  Read ${stele.title}`;
    const cache = this.nearestCache(2.4);
    if (cache && !this.run.caches.has(cache.id)) return 'E  Open the cache';
    const node = this.nearestNode(2.45);
    if (node) return `E  Gather ${MATERIAL_NAME[node.kind]}`;
    return '';
  }

  private nearestNode(range: number): { id: string; kind: MaterialId; x: number; z: number; y: number } | null {
    let best: { id: string; kind: MaterialId; x: number; z: number; y: number; d: number } | null = null;
    for (const node of this.w.nodes) {
      const live = this.nodes.get(node.id);
      if (!live || live.amount <= 0) continue;
      const d = Math.hypot(node.x - this.player.x, node.z - this.player.z);
      if (d < range && (!best || d < best.d)) best = { ...node, d };
    }
    return best;
  }

  private nearestShrine(range: number) {
    return this.nearest(this.w.shrines, range);
  }

  private nearestBeacon(range: number) {
    return this.nearest(this.w.beacons, range);
  }

  private nearestStele(range: number) {
    return this.nearest(this.w.steles, range);
  }

  private nearestCache(range: number) {
    return this.nearest(this.w.caches, range);
  }

  private nearest<T extends { x: number; z: number }>(items: T[], range: number): T | null {
    let best: T | null = null;
    let bestD = range;
    for (const item of items) {
      const d = Math.hypot(item.x - this.player.x, item.z - this.player.z);
      if (d < bestD) {
        best = item;
        bestD = d;
      }
    }
    return best;
  }

  private objective(): string {
    if (!this.run.weapons.includes('hatchet')) return 'Gather emberwood and stone, then craft a Stone Hatchet.';
    if (!this.run.rested.has('shrine-forest')) return 'Rest at the Grove Shrine so the wild can return you there.';
    if (!this.run.beacons.has('beacon-forest')) return 'Craft Beacon Kindling and light the Grove Beacon.';
    if (this.run.beacons.size < 4) return `Light the remaining beacons (${this.run.beacons.size}/4). Each biome keeps one.`;
    if (!this.run.bossDefeated) return 'Optional: enter the Ash Caldera and face the Warden.';
    return 'The caldera is quiet. Keep roaming — the island refills what you take.';
  }

  private tracker(): string {
    const time = this.formatTime(this.run.play);
    return `Beacons ${this.run.beacons.size}/4 · Steles ${this.run.steles.size}/12 · ${WEAPONS[this.run.weapon].name} · ${time}`;
  }

  private clockLabel(): string {
    const tod = (this.timeOfDay % DAY_SECONDS) / DAY_SECONDS;
    const day = Math.floor(this.timeOfDay / DAY_SECONDS) + 1;
    let phase = 'Night';
    if (tod >= 0.2 && tod < 0.3) phase = 'Dawn';
    else if (tod >= 0.3 && tod < 0.62) phase = 'Day';
    else if (tod >= 0.62 && tod < 0.75) phase = 'Dusk';
    return `Day ${day} · ${phase}`;
  }

  private syncHud(): void {
    if (this.mode === 'title') return;
    this.hud.setBars(this.hp, this.maxHp(), this.stamina, this.maxStamina);
    this.hud.setHurt(this.hurtV);
    this.hud.setObjective(this.objective(), this.tracker());
    const counts = MATERIALS.map((key) => `${MATERIAL_NAME[key].split(' ')[0]} ${this.run.mats[key]}`).join('   ');
    const guard = this.guarding ? ' · guarding' : '';
    this.hud.setStatus(
      `${this.clockLabel()} · facing ${facingLabel(this.yaw)}`,
      BIOME_LABEL[this.w.biomeAt(this.player.x, this.player.z)],
      counts,
      `${WEAPONS[this.run.weapon].name} · ${ARMOR_NAME[this.run.armor]}${guard}`,
      `Heartwine ${this.run.heartwine} · Kindling ${this.run.kindling}`,
    );
    this.hud.setPrompt(this.mode === 'play' && this.panel === 'none' ? this.prompt() : '');
    const projected: { x: number; y: number; text: string; color: string; life: number; kind: 'note' | 'hit' | 'kill' }[] = [];
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const floater = this.floaters[i];
      floater.life -= 0.016;
      floater.y += 0.016 * 1.1;
      if (floater.life <= 0) {
        this.floaters.splice(i, 1);
        continue;
      }
      this.proj.set(floater.x, floater.y, floater.z).project(this.camera);
      if (this.proj.z > 1) continue;
      projected.push({
        x: (this.proj.x * 0.5 + 0.5) * this.canvas.clientWidth,
        y: (-this.proj.y * 0.5 + 0.5) * this.canvas.clientHeight,
        text: floater.text,
        color: floater.color,
        life: floater.life,
        kind: floater.kind,
      });
    }
    this.hud.setFloaters(projected.slice(0, 16));
    const sun = this.sunState();
    this.audio.update(this.w.biomeAt(this.player.x, this.player.z), sun.night, this.combat);
  }

  private float(x: number, y: number, z: number, text: string, color: string, kind: 'note' | 'hit' | 'kill' = 'note'): void {
    this.floaters.push({ x, y, z, text, color, life: kind === 'kill' ? 1.15 : 0.95, kind });
    if (this.floaters.length > 16) this.floaters.shift();
  }

  private toggle(panel: Panel): void {
    if (this.mode !== 'play') return;
    this.setPanel(this.panel === panel ? 'none' : panel);
  }

  private setPanel(panel: Panel): void {
    if (this.mode === 'dead' && panel !== 'death' && panel !== 'none') return;
    this.panel = panel;
    this.hud.setPanel(panel);
    if (panel !== 'none') document.exitPointerLock?.();
    if (panel === 'craft') this.hud.renderCraft(this.craftRows());
    if (panel === 'inventory') this.hud.renderPack(this.packView());
    if (panel === 'map') this.hud.renderMap('Rested shrines can carry you. Click one you have already woken.');
    if (panel === 'pause') {
      this.hud.renderPause(
        [this.w.seedKey, `Atlas ${this.w.signature}`, this.formatTime(this.run.play), `${this.run.kills} fell`],
        this.hud.isMuted(),
      );
    }
  }

  private refreshPanels(): void {
    if (this.panel === 'craft') this.hud.renderCraft(this.craftRows());
    if (this.panel === 'inventory') this.hud.renderPack(this.packView());
  }

  private craftRows(): CraftRow[] {
    return RECIPES.map((recipe) => {
      const owned = (!!recipe.weapon && this.run.weapons.includes(recipe.weapon)) || (!!recipe.armor && this.run.armors.includes(recipe.armor)) || (!!recipe.perk && this.run[recipe.perk]);
      const cost = MATERIALS.filter((key) => recipe.cost[key]).map((key) => `${recipe.cost[key]} ${MATERIAL_NAME[key]}`).join(' · ');
      let meta = cost;
      if (recipe.requiresWeapon && !this.run.weapons.includes(recipe.requiresWeapon)) meta = `Requires ${WEAPONS[recipe.requiresWeapon].name}`;
      if (recipe.requiresArmor && !this.run.armors.includes(recipe.requiresArmor)) meta = `Requires ${ARMOR_NAME[recipe.requiresArmor]}`;
      if (owned) meta = 'Owned';
      return { id: recipe.id, title: recipe.name, meta, blurb: recipe.blurb, disabled: owned || !this.canCraft(recipe), owned };
    });
  }

  private packView(): PackView {
    const journal = [
      this.objective(),
      `Beacons ${[...this.run.beacons].join(', ') || 'none yet'}`,
      `Steles ${this.run.steles.size}/12${this.run.memory ? ' · Ember Memory' : ''}`,
      `Creatures fallen ${this.run.kills}`,
      this.run.bossDefeated ? 'The Ash Warden has gone quiet.' : 'The Ash Warden is still in the caldera.',
    ];
    const perks = [
      this.run.cloak ? 'Cinder Cloak' : '',
      this.run.striders ? 'Tide Striders' : '',
      this.run.lantern ? 'Relic Lantern' : '',
      this.run.memory ? 'Ember Memory' : '',
    ].filter(Boolean);
    return {
      mats: MATERIALS.map((id) => ({ name: MATERIAL_NAME[id], count: this.run.mats[id] })),
      weapons: (['fists', 'hatchet', 'blade', 'cleaver'] as WeaponId[]).map((id) => ({
        id,
        name: WEAPONS[id].name,
        owned: this.run.weapons.includes(id),
        equipped: this.run.weapon === id,
      })),
      armors: (['vest', 'mail'] as ArmorId[]).map((id) => ({
        id,
        name: ARMOR_NAME[id],
        owned: this.run.armors.includes(id),
        equipped: this.run.armor === id,
      })),
      perks,
      journal,
    };
  }

  private markExplored(x: number, z: number, radius: number): void {
    const cx = Math.floor(((x + MAP_EXTENT) / (MAP_EXTENT * 2)) * MAP_RES);
    const cz = Math.floor(((z + MAP_EXTENT) / (MAP_EXTENT * 2)) * MAP_RES);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const u = cx + dx;
        const v = cz + dz;
        if (u < 0 || v < 0 || u >= MAP_RES || v >= MAP_RES) continue;
        const index = v * MAP_RES + u;
        if (this.explored[index]) continue;
        this.explored[index] = 1;
        this.paintCell(index);
      }
    }
  }

  private repaintExplore(): void {
    this.exploreCtx.fillStyle = '#140e0c';
    this.exploreCtx.fillRect(0, 0, MAP_RES, MAP_RES);
    for (let i = 0; i < this.explored.length; i++) if (this.explored[i]) this.paintCell(i);
  }

  private paintCell(index: number): void {
    const u = index % MAP_RES;
    const v = Math.floor(index / MAP_RES);
    const x = ((u + 0.5) / MAP_RES) * MAP_EXTENT * 2 - MAP_EXTENT;
    const z = ((v + 0.5) / MAP_RES) * MAP_EXTENT * 2 - MAP_EXTENT;
    const h = this.w.heightAt(x, z);
    let color = '#3f6b45';
    if (h < WATER_LEVEL) color = '#1a4c56';
    else {
      const biome = this.w.biomeAt(x, z);
      color = biome === 'lava' ? '#8a3b28' : biome === 'ruins' ? '#7a7388' : biome === 'coast' ? '#c4a574' : '#3f6b45';
    }
    this.exploreCtx.fillStyle = color;
    this.exploreCtx.fillRect(u, v, 1, 1);
  }

  private drawMaps(): void {
    if (this.mode === 'title' || !this.world) return;
    this.paintMap(this.hud.mini, true);
    if (this.panel === 'map') this.paintMap(this.hud.big, false);
  }

  private paintMap(canvas: HTMLCanvasElement, mini: boolean): void {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(8, Math.floor(rect.width * ratio));
    const h = Math.max(8, Math.floor(rect.height * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#140e0c';
    ctx.fillRect(0, 0, w, h);
    if (mini) {
      const view = 86;
      const scale = MAP_RES / (MAP_EXTENT * 2);
      const sw = view * scale;
      const sx = (this.player.x + MAP_EXTENT) * scale - sw / 2;
      const sy = (this.player.z + MAP_EXTENT) * scale - sw / 2;
      ctx.drawImage(this.exploreCanvas, sx, sy, sw, sw, 0, 0, w, h);
    } else {
      ctx.drawImage(this.exploreCanvas, 0, 0, w, h);
    }
    const project = (x: number, z: number) => {
      if (mini) {
        const half = 43;
        return { px: ((x - this.player.x) / half) * (w / 2) + w / 2, py: ((z - this.player.z) / half) * (h / 2) + h / 2 };
      }
      return { px: ((x + MAP_EXTENT) / (MAP_EXTENT * 2)) * w, py: ((z + MAP_EXTENT) / (MAP_EXTENT * 2)) * h };
    };
    const marks: { x: number; z: number; color: string; label?: string }[] = [];
    for (const shrine of this.w.shrines) {
      const known = this.run.rested.has(shrine.id) || this.explored[this.cellIndex(shrine.x, shrine.z)] === 1;
      if (known) marks.push({ x: shrine.x, z: shrine.z, color: this.run.rested.has(shrine.id) ? '#f0c27a' : '#d9cbb8', label: mini ? undefined : shrine.name });
    }
    for (const beacon of this.w.beacons) {
      marks.push({
        x: beacon.x,
        z: beacon.z,
        color: this.run.beacons.has(beacon.id) ? '#ff7a3c' : '#8ec8ff',
        label: mini ? undefined : beacon.name,
      });
    }
    if (this.run.beacons.size >= 2 || this.explored[this.cellIndex(this.w.caldera.x, this.w.caldera.z)]) {
      marks.push({ x: this.w.caldera.x, z: this.w.caldera.z, color: '#ff5d4a', label: mini ? undefined : 'Ash Caldera' });
    }
    for (const mark of marks) {
      const p = project(mark.x, mark.z);
      ctx.fillStyle = mark.color;
      ctx.beginPath();
      ctx.arc(p.px, p.py, mini ? 4 : 6, 0, Math.PI * 2);
      ctx.fill();
      if (mark.label) {
        ctx.fillStyle = '#f4efe6';
        ctx.font = `${Math.max(11, Math.floor(w / 48))}px Outfit, sans-serif`;
        ctx.fillText(mark.label, p.px + 8, p.py + 4);
      }
    }
    const player = project(this.player.x, this.player.z);
    ctx.save();
    ctx.translate(player.px, player.py);
    ctx.rotate(-this.yaw);
    ctx.fillStyle = '#fff8ee';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private cellIndex(x: number, z: number): number {
    const u = Math.floor(((x + MAP_EXTENT) / (MAP_EXTENT * 2)) * MAP_RES);
    const v = Math.floor(((z + MAP_EXTENT) / (MAP_EXTENT * 2)) * MAP_RES);
    if (u < 0 || v < 0 || u >= MAP_RES || v >= MAP_RES) return 0;
    return v * MAP_RES + u;
  }

  private save(): void {
    if (!this.world || this.mode === 'title') return;
    const data: SaveData = {
      v: 1,
      seedKey: this.world.seedKey,
      x: this.player.x,
      y: this.player.y,
      z: this.player.z,
      yaw: this.yaw,
      pitch: this.pitch,
      hp: this.hp,
      stamina: this.stamina,
      timeOfDay: this.timeOfDay,
      thirdPerson: this.thirdPerson,
      mats: this.run.mats,
      weapons: this.run.weapons,
      weapon: this.run.weapon,
      armors: this.run.armors,
      armor: this.run.armor,
      cloak: this.run.cloak,
      striders: this.run.striders,
      lantern: this.run.lantern,
      memory: this.run.memory,
      kindling: this.run.kindling,
      heartwine: this.run.heartwine,
      beacons: [...this.run.beacons],
      rested: [...this.run.rested],
      respawnId: this.run.respawnId,
      steles: [...this.run.steles],
      caches: [...this.run.caches],
      seen: [...this.run.seen],
      bossDefeated: this.run.bossDefeated,
      kills: this.run.kills,
      play: this.run.play,
      tutorial: this.run.tutorial,
      explored: encodeBytes(this.explored),
      nodes: [...this.nodes.entries()].filter(([, live]) => live.amount < live.max).map(([id, live]) => ({ id, amount: live.amount, regenAt: live.regenAt })),
      actors: this.actors.filter((actor) => actor.hp < actor.maxHp || actor.state === 'dead').map((actor) => ({ id: actor.spawn.id, hp: actor.hp, deadUntil: actor.deadUntil })),
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      this.refreshContinue();
    } catch {
      this.hud.toast('The checkpoint could not be written.');
    }
  }

  private readSave(): SaveData | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as SaveData;
      if (data.v !== 1 || !data.seedKey) return null;
      return data;
    } catch {
      return null;
    }
  }

  private refreshContinue(): void {
    const save = this.readSave();
    if (!save) {
      this.hud.setContinue(null);
      return;
    }
    this.hud.setContinue(`${save.seedKey} · ${this.formatTime(save.play || 0)}`);
  }

  private toggleMute(): void {
    const muted = !this.hud.isMuted();
    this.hud.setMuted(muted);
    this.audio.setMuted(muted);
    this.audio.ensure();
    if (this.panel === 'pause') {
      this.hud.renderPause(
        [this.w.seedKey, `Atlas ${this.w.signature}`, this.formatTime(this.run.play), `${this.run.kills} fell`],
        muted,
      );
    }
  }

  private formatTime(seconds: number): string {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`;
  }

  private bindInput(): void {
    window.addEventListener('keydown', (event) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (typing) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      if (!event.repeat) this.just.add(event.code);
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    this.canvas.addEventListener('mousedown', (event) => {
      this.audio.ensure();
      if (this.mode === 'title' || this.panel !== 'none') return;
      if (event.button === 2) {
        this.rmb = true;
        return;
      }
      if (event.button !== 0) return;
      this.dragging = true;
      this.dragX = event.clientX;
      this.dragY = event.clientY;
      this.moved = 0;
      if (document.pointerLockElement === this.canvas) this.attackQueued = true;
      else this.canvas.requestPointerLock?.();
    });
    window.addEventListener('mouseup', (event) => {
      if (event.button === 2) this.rmb = false;
      if (event.button === 0) {
        if (this.dragging && this.moved < 6 && document.pointerLockElement !== this.canvas && this.mode === 'play' && this.panel === 'none') {
          this.attackQueued = true;
        }
        this.dragging = false;
      }
    });
    window.addEventListener('mousemove', (event) => {
      if (document.pointerLockElement === this.canvas) {
        this.yaw -= event.movementX * 0.0022;
        this.pitch -= event.movementY * 0.0018;
      } else if (this.dragging && this.mode === 'play' && this.panel === 'none') {
        this.yaw -= event.movementX * 0.005;
        this.pitch -= event.movementY * 0.004;
        this.moved += Math.abs(event.movementX) + Math.abs(event.movementY);
      }
      this.pitch = clamp(this.pitch, -1.2, 1.2);
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.canvas.style.cursor = document.pointerLockElement === this.canvas ? 'none' : 'default';
    });
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }

  private exposeDebug(): void {
    const api = {
      pos: () => ({ x: this.player.x, z: this.player.z, biome: this.w.biomeAt(this.player.x, this.player.z), hp: this.hp }),
      give: () => {
        this.run.mats.wood += 20;
        this.run.mats.stone += 20;
        this.run.mats.fiber += 20;
        this.run.mats.cinder += 20;
        this.run.mats.pearl += 10;
        this.run.mats.relic += 8;
        this.run.kindling += 4;
        this.run.heartwine += 4;
      },
      kit: () => {
        api.give();
        this.craft('hatchet');
        this.craft('blade');
        this.craft('vest');
        this.craft('cloak');
        this.craft('striders');
        this.craft('lantern');
        this.craft('kindling');
        this.craft('heartwine');
      },
      goto: (id: string) => {
        const place = [...this.w.shrines, ...this.w.beacons].find((entry) => entry.id === id);
        if (id === 'caldera') {
          this.player.x = this.w.caldera.x + 8;
          this.player.z = this.w.caldera.z;
        } else if (place) {
          this.player.x = place.x + 2;
          this.player.z = place.z + 2;
        }
        this.player.y = this.w.heightAt(this.player.x, this.player.z);
      },
      tod: (t: number) => {
        this.timeOfDay = t * DAY_SECONDS;
      },
      beacons: () => {
        for (const beacon of this.w.beacons) this.run.beacons.add(beacon.id);
        this.refreshVisuals();
        this.weakenWarden();
      },
    };
    (window as unknown as { __ember: typeof api }).__ember = api;
  }
}
