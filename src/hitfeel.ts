/** Combat hit-feel for Ember Wilds.
 * The shared kit at github.com/kkcandc/web-demo-juice-kit only publishes a
 * README, so these beats — hit-stop, camera kick, ember sparks, pop numbers —
 * live here with no extra dependencies.
 */

export const BUILD_MARKER = 'ember-wilds build hitfeel-2026-10-17';

/** Real-time freeze on a landed hit. ~55ms, ~70ms on a kill. */
export const HIT_STOP_SEC = 0.055;
export const HIT_STOP_KILL_SEC = 0.07;

export const EMBER_SPARKS = [0xfff6e8, 0xffd27a, 0xff7a3c, 0xffc14a] as const;
export const ASH_SPARKS = [0xe7e0d6, 0xb7aea4, 0x6e675f, 0xff8a4a] as const;

/** Small camera kick. `amount` is 0..1 and `time` advances in seconds. */
export function cameraKick(time: number, amount: number): { x: number; y: number } {
  const amp = 0.12 * amount;
  return {
    x: Math.sin(time * 68) * amp,
    y: Math.cos(time * 51) * amp * 0.72,
  };
}
