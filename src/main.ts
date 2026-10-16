import { Game } from './game';
import { BUILD_MARKER } from './hitfeel';

console.info(BUILD_MARKER);

const canvas = document.querySelector('#game');
const ui = document.querySelector('#ui');
if (!(canvas instanceof HTMLCanvasElement) || !(ui instanceof HTMLElement)) {
  throw new Error('Ember Wilds failed to find its canvas.');
}

const params = new URLSearchParams(location.search);
const game = new Game(canvas, ui);
game.boot({
  seed: params.get('seed'),
  play: params.get('play') === '1',
  cont: params.get('continue') === '1',
  tod: params.get('tod'),
  debug: params.get('debug') === '1',
});
