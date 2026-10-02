import { createWorld, biomeCounts } from '../src/worldgen';

function fingerprint(seed: string): string {
  const world = createWorld(seed);
  const beacon = world.beacons.map((b) => `${b.biome}:${b.x.toFixed(2)}:${b.z.toFixed(2)}`).join('|');
  const shrine = world.shrines.map((s) => `${s.id}:${s.x.toFixed(2)}:${s.z.toFixed(2)}`).join('|');
  return [
    world.signature,
    world.spawn.x.toFixed(3),
    world.spawn.z.toFixed(3),
    world.caldera.x.toFixed(3),
    world.caldera.z.toFixed(3),
    world.trees.length,
    world.rocks.length,
    world.nodes.length,
    world.creatures.length,
    world.steles.length,
    world.caches.length,
    beacon,
    shrine,
  ].join('~');
}

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

const emberA = createWorld('ember');
const emberB = createWorld('ember');
const other = createWorld('tideglass');

assert(fingerprint('ember') === fingerprint('ember'), 'same seed drifted');
assert(fingerprint('ember') !== fingerprint('tideglass'), 'different seeds collided');
assert(emberA.signature === emberB.signature, 'signature mismatch');
assert(emberA.beacons.length === 4, 'expected 4 beacons');
assert(emberA.shrines.length === 4, 'expected 4 shrines');
assert(emberA.steles.length >= 8, `steles ${emberA.steles.length}`);
assert(emberA.boss.kind === 'warden', 'missing warden');

for (let i = 0; i < emberA.beacons.length; i++) {
  for (let j = i + 1; j < emberA.beacons.length; j++) {
    const d = Math.hypot(emberA.beacons[i].x - emberA.beacons[j].x, emberA.beacons[i].z - emberA.beacons[j].z);
    assert(d > 28, `beacons too close ${emberA.beacons[i].biome} ${emberA.beacons[j].biome} ${d.toFixed(1)}`);
  }
}

const counts = biomeCounts(emberA);
console.log('biomes', counts);
console.log('atlas', emberA.signature, 'trees', emberA.trees.length, 'rocks', emberA.rocks.length, 'nodes', emberA.nodes.length);
console.log('creatures', emberA.creatures.length, 'ruins', emberA.ruins.length, 'steles', emberA.steles.length);
console.log('other atlas', other.signature);

const kinds = new Map<string, number>();
for (const node of emberA.nodes) kinds.set(node.kind, (kinds.get(node.kind) ?? 0) + 1);
console.log('nodes', Object.fromEntries(kinds));

assert(counts.forest > 40, `forest thin ${counts.forest}`);
assert(counts.coast > 12, `coast thin ${counts.coast}`);
assert(counts.lava > 8, `lava thin ${counts.lava}`);
assert(counts.ruins > 8, `ruins thin ${counts.ruins}`);
assert((kinds.get('wood') ?? 0) >= 10, 'wood nodes');
assert((kinds.get('cinder') ?? 0) >= 4, 'cinder nodes');
assert((kinds.get('pearl') ?? 0) >= 3, 'pearl nodes');
for (const beacon of emberA.beacons) {
  assert(emberA.biomeAt(beacon.x, beacon.z) === beacon.biome, `beacon biome ${beacon.biome} got ${emberA.biomeAt(beacon.x, beacon.z)} h=${emberA.heightAt(beacon.x, beacon.z).toFixed(2)}`);
}
for (const shrine of emberA.shrines) {
  const h = emberA.heightAt(shrine.x, shrine.z);
  assert(h > 1.1, `shrine low ${shrine.id} ${h}`);
  console.log(shrine.id, emberA.biomeAt(shrine.x, shrine.z), h.toFixed(2));
}
assert(emberA.creatures.filter((c) => c.kind === 'mossback').length >= 4, 'mossbacks');
assert(emberA.trees.length > 180, 'trees sparse');

const spawnH = emberA.heightAt(emberA.spawn.x, emberA.spawn.z);
assert(spawnH > 2, `spawn underwater ${spawnH}`);
console.log('world check ok', emberA.seedKey, 'spawnH', spawnH.toFixed(2));
