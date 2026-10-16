# Ember Wilds

A seeded open-world adventure you play in the browser. Walk an island of ash forest, violet ruins, lava rim, and salt coast. Gather, craft, and fight until the caldera either knows your name or you decide to leave it alone.

The same seed grows the same island. Checkpoints live in this browser.

## Play

```bash
npm install
npm run dev
```

Open the local address, choose a seed, and embark. A saved expedition can be continued from the title.

Share a world with a link: `?seed=tideglass`. Add `&play=1` to skip the title.

## Controls

- **WASD** move, **Shift** sprint, **Space** jump
- **Mouse** look (click the world to capture), or **arrow keys**
- **Left mouse** or **J** attack, **X** or right mouse guard, **Q** dash
- **E** gather, rest at a shrine, read a stele, open a cache, or light a beacon
- **C** craft, **I** pack, **M** atlas, **V** first or third person, **1** drink heartwine
- **Esc** pauses. The wild waits while a panel is open.

On the atlas, click a shrine you have already rested at to travel there.

## The long loop

1. Gather emberwood, stone, and fiber around the Grove Shrine.
2. Craft a Stone Hatchet, then better weapons, armor, and perks from the other biomes.
3. Craft Beacon Kindling and light the four beacons. Each lighting wakes a short fight.
4. Read steles. Eight of them leave Ember Memory in your strikes.
5. Optionally enter the Ash Caldera. Four lit beacons cool the floor and weaken the Ash Warden. A Cinder Cloak lets you stand in the heat.

Resources and most creatures return if you give them time. Night changes the light, the fog, and how boldly ash wisps approach. A Relic Lantern pushes that back.

## World rules

Terrain, biomes, ruins, shrines, beacons, creatures, and caches all come from the seed. Fighting and wandering do not. The atlas signature on the title is a fingerprint of that layout.

```bash
npm run check
```

That command rebuilds two seeds and checks that one seed stays stable while another seed does not.
