// Coordinator: wires the jigsaw puzzle, the play-button reveal, the
// line-erase animation, and the slideshow + cycling text.

import { JigsawPuzzle } from '/static/puzzle.js';
import { Slideshow } from '/static/slideshow.js';

const $ = (sel) => document.querySelector(sel);

const board     = $('#puzzle-board');
const pieces    = $('#pieces-container');
const resetBtn  = $('#reset-button');
const puzzleLay = $('#puzzle-layer');
const playLay   = $('#play-overlay');
const playBtn   = $('#play-button');
const slidesLay = $('#slideshow');
const mediaEl   = $('#media-stage');
const againEl   = $('#again');
const addrEl    = $('#address');
const timeEl    = $('#time');

const puzzle = new JigsawPuzzle({ boardEl: board, piecesEl: pieces, resetBtn });
const slides = new Slideshow({
    mediaEl, againEl, addressEl: addrEl, timeEl: timeEl, interval: 5500,
});

let playArmed = false;

puzzle.addEventListener('complete', () => {
    playArmed = true;
    playLay.classList.add('visible');
    playLay.setAttribute('aria-hidden', 'false');
});

puzzle.addEventListener('reset', () => {
    playArmed = false;
    playLay.classList.remove('visible');
    playLay.setAttribute('aria-hidden', 'true');
    slidesLay.classList.remove('visible');
    slidesLay.setAttribute('aria-hidden', 'true');
    puzzleLay.classList.remove('fading');
    againEl.classList.remove('visible');
    addrEl.classList.remove('visible');
    timeEl.classList.remove('visible');
    slides.stop();
});

playBtn.addEventListener('click', async () => {
    if (!playArmed) return;
    playArmed = false;
    playBtn.disabled = true;
    // 1) Hide the play button itself.
    playLay.classList.remove('visible');
    playLay.setAttribute('aria-hidden', 'true');
    // 2) Wipe the puzzle lines from one end to the other, randomized.
    await eraseGridLines(puzzle.gridLineEls());
    // 3) Crossfade puzzle layer out while slideshow fades in.
    slidesLay.classList.add('visible');
    slidesLay.setAttribute('aria-hidden', 'false');
    slides.start();
    puzzleLay.classList.add('fading');
    // 4) Once the slideshow is visible, reveal the overlay text.
    setTimeout(() => slides.revealText(), 900);
    // 5) After the puzzle fade completes, take it out of the layout entirely.
    setTimeout(() => { puzzleLay.style.display = 'none'; }, 1300);
});

async function eraseGridLines(paths) {
    if (!paths.length) return;
    const shuffled = paths.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const totalDuration = 2200; // ms for a single line wipe
    const staggerStep   = 180;
    const tasks = shuffled.map((path, i) => new Promise((resolve) => {
        const len = path.getTotalLength();
        path.style.strokeDasharray  = len;
        path.style.strokeDashoffset = '0';
        // Force reflow so the transition starts from the dashoffset=0 frame.
        // eslint-disable-next-line no-unused-expressions
        path.getBoundingClientRect();
        const delay = i * staggerStep;
        path.style.transition =
            `stroke-dashoffset ${totalDuration}ms cubic-bezier(.6,.05,.3,1) ${delay}ms,` +
            ` opacity ${totalDuration}ms linear ${delay}ms`;
        // Direction: 50/50 wipe from start or wipe from end.
        const fromStart = Math.random() < 0.5;
        path.style.strokeDashoffset = fromStart ? `${len}` : `${-len}`;
        path.style.opacity = '0';
        setTimeout(resolve, delay + totalDuration);
    }));
    await Promise.all(tasks);
}

// Kick off
puzzle.init().catch((err) => {
    console.error('puzzle init failed', err);
});
