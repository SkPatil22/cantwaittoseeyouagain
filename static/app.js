// Coordinator: figures out the puzzle image (first frame of the first
// slideshow clip when it's a video), wires the play-button reveal, the
// line-erase animation, and the slideshow + cycling text.

import { JigsawPuzzle } from '/static/puzzle.js';
import { Slideshow, LANDSCAPES, isVideoSrc, extractFirstFrame } from '/static/slideshow.js';

const $ = (sel) => document.querySelector(sel);

const board      = $('#puzzle-board');
const pieces     = $('#pieces-container');
const resetBtn   = $('#reset-button');
const puzzleLay  = $('#puzzle-layer');
const playLay    = $('#play-overlay');
const playBtn    = $('#play-button');
const slidesLay  = $('#slideshow');
const mediaEl    = $('#media-stage');
const againEl    = $('#again');
const addrEl     = $('#address');
const timeEl     = $('#time');
const ssToggle   = $('#slideshow-toggle');

const slides = new Slideshow({
    mediaEl, againEl, addressEl: addrEl, timeEl: timeEl, interval: 5500,
});

let puzzle = null;
let playArmed = false;

async function resolvePuzzleImage() {
    const first = LANDSCAPES[0];
    if (isVideoSrc(first)) {
        try {
            return await extractFirstFrame(first);
        } catch (err) {
            console.warn('first-frame extract failed, falling back', err);
        }
    }
    return first;
}

(async () => {
    const puzzleImg = await resolvePuzzleImage();
    puzzle = new JigsawPuzzle({
        boardEl: board, piecesEl: pieces, resetBtn, puzzleImg,
    });
    puzzle.addEventListener('complete', onComplete);
    puzzle.addEventListener('reset', onReset);
    try { await puzzle.init(); }
    catch (err) { console.error('puzzle init failed', err); }
})();

function onComplete() {
    playArmed = true;
    playLay.classList.add('visible');
    playLay.setAttribute('aria-hidden', 'false');
}

function onReset() {
    playArmed = false;
    playLay.classList.remove('visible');
    playLay.setAttribute('aria-hidden', 'true');
    slidesLay.classList.remove('visible');
    slidesLay.setAttribute('aria-hidden', 'true');
    ssToggle.classList.remove('visible');
    puzzleLay.classList.remove('fading');
    puzzleLay.style.display = '';
    resetBtn.classList.remove('hidden');
    againEl.classList.remove('visible');
    addrEl.classList.remove('visible');
    timeEl.classList.remove('visible');
    slides.stop();
}

playBtn.addEventListener('click', async () => {
    if (!playArmed) return;
    playArmed = false;
    playBtn.disabled = true;
    playLay.classList.remove('visible');
    playLay.setAttribute('aria-hidden', 'true');
    resetBtn.classList.add('hidden');

    await eraseLines(puzzle.gridLineEls());

    slidesLay.classList.add('visible');
    slidesLay.setAttribute('aria-hidden', 'false');
    slides.start();
    ssToggle.classList.add('visible');
    puzzleLay.classList.add('fading');
    setTimeout(() => slides.revealText(), 900);
    setTimeout(() => { puzzleLay.style.display = 'none'; }, 1300);
});

// Each piece's outline is a closed jigsaw loop. Setting stroke-dasharray to
// its length and animating dashoffset toward that length wipes the stroke
// away "from one end to the other" along the path direction.
async function eraseLines(paths) {
    if (!paths.length) return;
    const shuffled = paths.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const wipeMs   = 1400;
    const stepMs   = 70;
    const tasks = shuffled.map((p, i) => new Promise((resolve) => {
        const len = p.getTotalLength();
        p.style.strokeDasharray  = len;
        p.style.strokeDashoffset = '0';
        p.getBoundingClientRect();  // force commit
        const delay = i * stepMs;
        p.style.transition =
            `stroke-dashoffset ${wipeMs}ms cubic-bezier(.6,.05,.3,1) ${delay}ms,` +
            ` opacity ${wipeMs}ms linear ${delay}ms`;
        const dir = Math.random() < 0.5 ? len : -len;
        p.style.strokeDashoffset = dir;
        p.style.opacity = '0';
        setTimeout(resolve, delay + wipeMs);
    }));
    await Promise.all(tasks);
}

// "again" cheat code: type those five letters anywhere to autocomplete.
{
    let buf = '';
    window.addEventListener('keydown', (e) => {
        if (!e.key || e.key.length !== 1) return;
        const k = e.key.toLowerCase();
        if (!/[a-z]/.test(k)) return;
        buf = (buf + k).slice(-5);
        if (buf === 'again' && puzzle && !playArmed) {
            buf = '';
            puzzle.autocomplete();
        }
    });
}

// Slideshow play/pause toggle (bottom-right while cycling)
ssToggle.addEventListener('click', () => {
    if (slides.paused) {
        slides.resume();
        ssToggle.classList.remove('paused');
        ssToggle.setAttribute('aria-label', 'pause');
    } else {
        slides.pause();
        ssToggle.classList.add('paused');
        ssToggle.setAttribute('aria-label', 'play');
    }
});
