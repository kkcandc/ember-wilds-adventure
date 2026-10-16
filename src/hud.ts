import { MAP_EXTENT, MUTE_KEY } from './content';
import type { ArmorId, WeaponId } from './types';

export type Panel = 'none' | 'inventory' | 'craft' | 'map' | 'pause' | 'read' | 'death';

export interface HudHooks {
  embark: (seed: string) => void;
  continue: () => void;
  abandon: () => void;
  seedPreview: (seed: string) => void;
  craft: (id: string) => void;
  equipWeapon: (id: WeaponId) => void;
  equipArmor: (id: ArmorId) => void;
  open: (panel: Panel) => void;
  close: () => void;
  resume: () => void;
  toTitle: () => void;
  saveNow: () => void;
  fullscreen: () => void;
  mute: () => void;
  drink: () => void;
  travel: (x: number, z: number) => void;
  wake: () => void;
}

export interface CraftRow {
  id: string;
  title: string;
  meta: string;
  blurb: string;
  disabled: boolean;
  owned: boolean;
}

export interface PackView {
  mats: { name: string; count: number }[];
  weapons: { id: WeaponId; name: string; owned: boolean; equipped: boolean }[];
  armors: { id: ArmorId; name: string; owned: boolean; equipped: boolean }[];
  perks: string[];
  journal: string[];
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  kind?: 'note' | 'hit' | 'kill';
}

export class Hud {
  readonly mini: HTMLCanvasElement;
  readonly big: HTMLCanvasElement;
  private root: HTMLElement;
  private title: HTMLElement;
  private play: HTMLElement;
  private seedInput: HTMLInputElement;
  private sig: HTMLElement;
  private continueBtn: HTMLButtonElement;
  private abandonBtn: HTMLButtonElement;
  private objective: HTMLElement;
  private tracker: HTMLElement;
  private clock: HTMLElement;
  private biome: HTMLElement;
  private prompt: HTMLElement;
  private resources: HTMLElement;
  private counts: HTMLElement;
  private gearline: HTMLElement;
  private hp: HTMLElement;
  private st: HTMLElement;
  private hurt: HTMLElement;
  private crosshair: HTMLElement;
  private toastHost: HTMLElement;
  private floaterHost: HTMLElement;
  private modal: HTMLElement;
  private sheet: HTMLElement;
  private floaterPool: HTMLElement[] = [];
  private muted = false;

  constructor(root: HTMLElement, private hooks: HudHooks) {
    this.root = root;
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
    root.innerHTML = `
      <div id="vignette"></div>
      <div id="hurt"></div>
      <section id="title">
        <div class="brand">
          <p class="eyebrow">Seeded open wild</p>
          <h1 class="wordmark"><span>EMBER</span><span>WILDS</span></h1>
          <p class="tag">Ash forest, violet ruins, a lava rim, and a salt coast. The same seed grows the same island.</p>
          <div class="seed-row">
            <label for="seed">Seed</label>
            <input id="seed" maxlength="32" value="ember" autocomplete="off" />
            <button class="tiny" id="shuffle" type="button">Shuffle</button>
          </div>
          <p class="atlas">Atlas <b id="sig">······</b></p>
          <div class="actions">
            <button class="primary" id="embark" type="button">Embark</button>
            <button class="ghost" id="continue" type="button" disabled>Continue</button>
            <button class="text" id="abandon" type="button">Abandon checkpoint</button>
          </div>
          <p class="warn">One checkpoint lives in this browser. Embarking a new expedition replaces it when the wild saves.</p>
          <ul class="chips">
            <li><kbd>WASD</kbd> move</li>
            <li><kbd>Mouse</kbd> look</li>
            <li><kbd>LMB</kbd> or <kbd>J</kbd> attack</li>
            <li><kbd>E</kbd> gather</li>
            <li><kbd>C</kbd> craft</li>
            <li><kbd>Q</kbd> dash</li>
            <li><kbd>X</kbd> guard</li>
            <li><kbd>V</kbd> camera</li>
            <li><kbd>M</kbd> map</li>
            <li><kbd>1</kbd> drink</li>
          </ul>
        </div>
      </section>
      <section id="hud" class="hidden">
        <div class="top-left">
          <p id="objective"></p>
          <p id="tracker"></p>
        </div>
        <div class="top-right">
          <canvas id="mini" width="168" height="168"></canvas>
          <p class="clock" id="clock"></p>
          <p class="biome" id="biome"></p>
        </div>
        <div id="crosshair"></div>
        <div id="prompt" class="hidden"></div>
        <div class="bottom">
          <div class="resources" id="resources"></div>
          <div class="vitals">
            <div class="bar hp"><span id="hp"></span></div>
            <div class="bar st"><span id="st"></span></div>
            <p id="gearline"></p>
          </div>
          <div class="consumables">
            <button class="tiny" id="drink" type="button">Drink heartwine</button>
            <p id="counts"></p>
          </div>
        </div>
        <div class="dock">
          <button class="tiny" id="open-pack" type="button">Pack <kbd>I</kbd></button>
          <button class="tiny" id="open-craft" type="button">Craft <kbd>C</kbd></button>
          <button class="tiny" id="open-map" type="button">Map <kbd>M</kbd></button>
          <button class="tiny" id="open-pause" type="button">Pause</button>
        </div>
      </section>
      <div id="floaters"></div>
      <div id="toasts"></div>
      <div id="modal" class="modal hidden"><div class="sheet" id="sheet"></div></div>
    `;
    this.title = this.q('#title');
    this.play = this.q('#hud');
    this.seedInput = this.q('#seed') as HTMLInputElement;
    this.sig = this.q('#sig');
    this.continueBtn = this.q('#continue') as HTMLButtonElement;
    this.abandonBtn = this.q('#abandon') as HTMLButtonElement;
    this.objective = this.q('#objective');
    this.tracker = this.q('#tracker');
    this.clock = this.q('#clock');
    this.biome = this.q('#biome');
    this.prompt = this.q('#prompt');
    this.resources = this.q('#resources');
    this.counts = this.q('#counts');
    this.gearline = this.q('#gearline');
    this.hp = this.q('#hp');
    this.st = this.q('#st');
    this.hurt = this.q('#hurt');
    this.crosshair = this.q('#crosshair');
    this.toastHost = this.q('#toasts');
    this.floaterHost = this.q('#floaters');
    this.modal = this.q('#modal');
    this.sheet = this.q('#sheet');
    this.mini = this.q('#mini') as HTMLCanvasElement;
    this.big = document.createElement('canvas');
    this.big.id = 'bigmap';
    for (let i = 0; i < 16; i++) {
      const el = document.createElement('div');
      el.className = 'floater hidden';
      this.floaterHost.append(el);
      this.floaterPool.push(el);
    }
    this.q('#embark').addEventListener('click', () => hooks.embark(this.seedValue()));
    this.continueBtn.addEventListener('click', () => hooks.continue());
    this.abandonBtn.addEventListener('click', () => hooks.abandon());
    this.q('#shuffle').addEventListener('click', () => {
      const bank = ['ashgrove', 'saltroad', 'cinderwell', 'quietarch', 'tideglass', 'briar', 'lantern', 'mossbell', 'warden', 'ember'];
      const next = `${bank[Math.floor(Math.random() * bank.length)]}-${1000 + Math.floor(Math.random() * 9000)}`;
      this.seedInput.value = next;
      hooks.seedPreview(next);
    });
    let timer = 0;
    this.seedInput.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => hooks.seedPreview(this.seedInput.value), 280);
    });
    this.seedInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') hooks.embark(this.seedValue());
    });
    this.q('#drink').addEventListener('click', () => hooks.drink());
    this.q('#open-pack').addEventListener('click', () => hooks.open('inventory'));
    this.q('#open-craft').addEventListener('click', () => hooks.open('craft'));
    this.q('#open-map').addEventListener('click', () => hooks.open('map'));
    this.q('#open-pause').addEventListener('click', () => hooks.open('pause'));
    this.big.addEventListener('click', (event) => {
      const rect = this.big.getBoundingClientRect();
      const u = (event.clientX - rect.left) / rect.width;
      const v = (event.clientY - rect.top) / rect.height;
      hooks.travel((u * 2 - 1) * MAP_EXTENT, (v * 2 - 1) * MAP_EXTENT);
    });
  }

  seedValue(): string {
    return this.seedInput.value.trim() || 'ember';
  }

  setSeed(seed: string): void {
    this.seedInput.value = seed;
  }

  setSignature(signature: string, charting = false): void {
    this.sig.textContent = charting ? 'charting…' : signature;
  }

  setContinue(label: string | null): void {
    this.continueBtn.disabled = !label;
    this.continueBtn.textContent = label ? `Continue · ${label}` : 'Continue';
    this.abandonBtn.classList.toggle('hidden', !label);
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  }

  showTitle(): void {
    this.title.classList.remove('hidden');
    this.play.classList.add('hidden');
    this.modal.classList.add('hidden');
    this.crosshair.classList.add('hidden');
  }

  showPlay(): void {
    this.title.classList.add('hidden');
    this.play.classList.remove('hidden');
    this.crosshair.classList.remove('hidden');
  }

  setPanel(panel: Panel): void {
    const open = panel !== 'none';
    this.modal.classList.toggle('hidden', !open);
    this.crosshair.classList.toggle('hidden', open || this.play.classList.contains('hidden'));
    if (!open) this.sheet.innerHTML = '';
  }

  setObjective(primary: string, secondary: string): void {
    this.objective.textContent = primary;
    this.tracker.textContent = secondary;
  }

  setStatus(clock: string, biome: string, resources: string, gear: string, counts: string): void {
    this.clock.textContent = clock;
    this.biome.textContent = biome;
    this.resources.textContent = resources;
    this.gearline.textContent = gear;
    this.counts.textContent = counts;
  }

  setBars(hp: number, maxHp: number, stamina: number, maxStamina: number): void {
    this.hp.style.width = `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%`;
    this.st.style.width = `${Math.max(0, Math.min(100, (stamina / maxStamina) * 100))}%`;
    this.play.classList.toggle('low', hp / maxHp < 0.3);
  }

  setPrompt(text: string): void {
    this.prompt.textContent = text;
    this.prompt.classList.toggle('hidden', !text);
  }

  setHurt(amount: number): void {
    this.hurt.style.opacity = String(Math.max(0, Math.min(0.85, amount)));
  }

  toast(message: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    this.toastHost.append(el);
    while (this.toastHost.children.length > 3) this.toastHost.firstChild?.remove();
    window.setTimeout(() => el.remove(), 3400);
  }

  setFloaters(items: Floater[]): void {
    for (let i = 0; i < this.floaterPool.length; i++) {
      const el = this.floaterPool[i];
      const item = items[i];
      if (!item || item.life <= 0) {
        el.classList.add('hidden');
        continue;
      }
      el.classList.remove('hidden', 'hit', 'kill');
      if (item.kind === 'hit') el.classList.add('hit');
      if (item.kind === 'kill') el.classList.add('kill');
      el.style.left = `${item.x}px`;
      el.style.top = `${item.y}px`;
      el.style.color = item.color;
      el.style.fontSize = item.kind === 'kill' ? '36px' : item.kind === 'hit' ? '23px' : '18px';
      el.style.opacity = String(Math.max(0, item.life));
      el.textContent = item.text;
    }
  }

  renderCraft(rows: CraftRow[]): void {
    this.sheet.innerHTML = `<h2>Craft fire</h2><p class="sub">Work from what the island gave you. Upgrades remember their parents.</p>`;
    for (const row of rows) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `recipe${row.owned ? ' on' : ''}`;
      button.disabled = row.disabled;
      button.innerHTML = `<strong>${row.title}</strong><span>${row.meta}</span><span>${row.blurb}</span>`;
      button.addEventListener('click', () => this.hooks.craft(row.id));
      this.sheet.append(button);
    }
    this.sheet.append(this.closeRow());
  }

  renderPack(view: PackView): void {
    this.sheet.innerHTML = `<h2>Pack</h2><p class="sub">What you carry is what you keep.</p>`;
    const mats = document.createElement('div');
    for (const mat of view.mats) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span>${mat.name}</span><strong>${mat.count}</strong>`;
      mats.append(row);
    }
    this.sheet.append(mats);
    const gear = document.createElement('div');
    gear.innerHTML = `<h3>Gear</h3>`;
    for (const weapon of view.weapons) {
      gear.append(this.equipButton(`${weapon.name}${weapon.equipped ? ' · in hand' : ''}`, !weapon.owned, () => this.hooks.equipWeapon(weapon.id)));
    }
    for (const armor of view.armors) {
      if (armor.id === 'none') continue;
      gear.append(this.equipButton(`${armor.name}${armor.equipped ? ' · worn' : ''}`, !armor.owned, () => this.hooks.equipArmor(armor.id)));
    }
    if (view.perks.length) {
      const perks = document.createElement('p');
      perks.className = 'lore';
      perks.textContent = view.perks.join(' · ');
      gear.append(perks);
    }
    this.sheet.append(gear);
    const journal = document.createElement('div');
    journal.innerHTML = `<h3>Field notes</h3>`;
    for (const line of view.journal) {
      const p = document.createElement('p');
      p.className = 'lore';
      p.textContent = line;
      journal.append(p);
    }
    this.sheet.append(journal, this.closeRow());
  }

  renderMap(note: string): void {
    this.sheet.innerHTML = `<h2>Atlas</h2><p class="sub">${note}</p>`;
    this.sheet.append(this.big, this.closeRow());
  }

  renderPause(lines: string[], muted: boolean): void {
    this.sheet.innerHTML = `<h2>Paused</h2><p class="sub">${lines.join(' · ')}</p>
      <ul class="chips">
        <li><kbd>WASD</kbd> move</li><li><kbd>Mouse</kbd> or <kbd>Arrows</kbd> look</li>
        <li><kbd>Shift</kbd> sprint</li><li><kbd>Space</kbd> jump</li><li><kbd>LMB</kbd> or <kbd>J</kbd> attack</li>
        <li><kbd>E</kbd> gather / rest / kindle</li><li><kbd>Q</kbd> dash</li><li><kbd>X</kbd> or right mouse guard</li>
        <li><kbd>V</kbd> first / third person</li><li><kbd>1</kbd> heartwine</li>
      </ul>`;
    const actions = document.createElement('div');
    actions.className = 'sheet-actions';
    actions.append(
      this.action('Resume', () => this.hooks.resume()),
      this.action('Save checkpoint', () => this.hooks.saveNow()),
      this.action(muted ? 'Unmute' : 'Mute', () => this.hooks.mute()),
      this.action('Fullscreen', () => this.hooks.fullscreen()),
      this.action('Title', () => this.hooks.toTitle()),
    );
    this.sheet.append(actions);
  }

  renderLore(title: string, text: string): void {
    this.sheet.innerHTML = `<p class="eyebrow">Stele</p><h2>${title}</h2><p class="quote">${text}</p>`;
    this.sheet.append(this.closeRow());
  }

  renderDeath(place: string): void {
    this.sheet.innerHTML = `<p class="eyebrow">Down</p><h2>The wild folds you back</h2><p class="sub">You will wake at ${place}, pack intact.</p>`;
    const actions = document.createElement('div');
    actions.className = 'sheet-actions';
    const wake = this.action('Wake', () => this.hooks.wake());
    wake.classList.add('primary');
    actions.append(wake);
    this.sheet.append(actions);
  }

  private equipButton(label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'equip';
    button.disabled = disabled;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private action(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private closeRow(): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'sheet-actions';
    actions.append(this.action('Close', () => this.hooks.close()));
    return actions;
  }

  private q(selector: string): HTMLElement {
    const node = this.root.querySelector(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node as HTMLElement;
  }
}
