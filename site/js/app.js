// Wires the page together:  loading -> puzzle -> play -> line-wipe -> reveal.
//
// The page is driven by a few classes on <body>:
//   ready       puzzle is on screen        play-ready  puzzle solved, button shown
//   wiping      lines are being erased     playing     video + words are showing
//   idle        (while playing) controls have faded away

import config from './config.js';
import { Puzzle } from './puzzle.js';
import { Deck } from './deck.js';
import { Slideshow } from './slideshow.js';
import { Look, preloadFonts } from './look.js';

const $ = (s) => document.querySelector(s);
const body = document.body;
const dom = {
    puzzle: $('#puzzle'), pieces: $('#pieces'), seams: $('#seams'), assembled: $('#assembled'),
    slideshow: $('#slideshow'), videos: $('#videos'), title: $('#title'),
    play: $('#play'), reset: $('#reset'), toggle: $('#toggle'),
    hint: $('#hint'), progress: $('#progress i'), notice: $('#notice'),
};
const dev = ['localhost', '127.0.0.1'].includes(location.hostname) || /[?&]debug\b/.test(location.search);
const idle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 800));

main().catch(fail);

async function main() {
    startAnalytics();
    const { clips } = await loadManifest();
    const deck = new Deck(clips.map((c) => c.id));

    // The puzzle picture is the poster (first frame) of the clip that plays first,
    // so the moment the lines vanish the picture simply starts to move.
    let puzzle = null, first = null;
    for (let tries = 0; tries < clips.length && !puzzle; tries++) {
        const idx = deck.current();
        if (idx == null) break;
        const candidate = new Puzzle({
            layer: dom.puzzle, pieces: dom.pieces, seams: dom.seams, assembled: dom.assembled,
            image: clips[idx].poster,
        });
        try { await candidate.init(); puzzle = candidate; first = idx; }
        catch (err) { console.warn('poster failed, trying the next clip:', clips[idx].id, err); deck.markBad(idx); }
    }
    if (!puzzle) throw new Error('none of the clip pictures could be loaded');

    const look = new Look(dom.slideshow);
    const slides = new Slideshow({ root: dom.videos, clips, deck, showSeconds: config.clipSeconds });
    slides.addEventListener('cut', (e) => look.apply(e.detail.clip));
    slides.prime(first);                   // start fetching the first clip while they solve
    idle(preloadFonts);                    // ...and the fonts, so no cut ever shows a fallback face

    body.classList.add('ready');
    wirePuzzle(puzzle);
    wirePlay(puzzle, slides);
    wireControls(puzzle, slides);
}

// ---- loading -----------------------------------------------------------------

async function loadManifest() {
    const res = await fetch(new URL('clips/media.json', document.baseURI));
    if (!res.ok) throw new Error(`clips/media.json not found (HTTP ${res.status})`);
    const m = await res.json();
    const clips = (m.clips || []).filter((c) => c && c.src && c.poster);
    if (!clips.length) throw new Error('clips/media.json has no clips');
    return { clips };
}

function fail(err) {
    console.error(err);
    body.classList.add('ready');
    dom.notice.hidden = false;
    dom.notice.textContent = dev
        ? `${err.message}. Run  python tools/build.py  first.`
        : 'something went wrong. try refreshing.';
}

function startAnalytics() {
    if (!config.analyticsToken) return;
    const s = document.createElement('script');
    s.defer = true;
    s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    s.dataset.cfBeacon = JSON.stringify({ token: config.analyticsToken });
    document.head.appendChild(s);
}

// ---- puzzle ------------------------------------------------------------------

function wirePuzzle(puzzle) {
    let grabbed = false;
    let solved = false;
    const showHint = () => setTimeout(() => { if (!grabbed && !solved) dom.hint.classList.add('on'); }, 1600);

    puzzle.addEventListener('progress', (e) => {
        const { placed, total } = e.detail;
        dom.progress.style.setProperty('--p', total ? placed / total : 0);
    });
    puzzle.addEventListener('grab', () => { grabbed = true; dom.hint.classList.remove('on'); });
    puzzle.addEventListener('complete', () => {
        solved = true;
        dom.hint.classList.remove('on');
        body.classList.add('play-ready');
    });
    puzzle.addEventListener('reset', () => {
        grabbed = false; solved = false;
        body.classList.remove('play-ready');
        showHint();
    });
    if (!puzzle.state.done) showHint();

    // Testing shortcuts: type the word, or open the page with #again on the end.
    const word = (config.cheatWord || '').toLowerCase();
    if (word) {
        let buf = '';
        window.addEventListener('keydown', (e) => {
            if (e.metaKey || e.ctrlKey || e.altKey || !e.key || e.key.length !== 1) return;
            buf = (buf + e.key.toLowerCase()).slice(-word.length);
            if (buf === word) { buf = ''; puzzle.autocomplete(); }
        });
        if (location.hash.slice(1).toLowerCase() === word) setTimeout(() => puzzle.autocomplete(), 1400);
    }
}

// ---- play: wipe the lines, then let the picture come alive ------------------

function wirePlay(puzzle, slides) {
    let started = false;
    dom.play.addEventListener('click', async () => {
        if (started) return;
        started = true;
        slides.arm();                                   // must run inside the tap (iOS)
        body.classList.remove('play-ready');
        body.classList.add('wiping');
        await puzzle.wipeSeams();
        try {
            await slides.reveal();                      // waits for a real frame: never black
        } catch (err) {
            started = false;
            body.classList.remove('wiping');
            return fail(err);
        }
        body.classList.remove('wiping');
        body.classList.add('playing');
        dom.slideshow.setAttribute('aria-hidden', 'false');
        setTimeout(() => dom.title.classList.add('in'), 700);
        setTimeout(() => { dom.puzzle.hidden = true; }, 1700);   // free the pieces once covered
    });
}

// ---- small controls -----------------------------------------------------------

function wireControls(puzzle, slides) {
    // "start over": asks by turning into a pill, not with a browser dialog.
    let confirmTimer;
    const cancel = () => {
        clearTimeout(confirmTimer);
        dom.reset.classList.remove('confirm');
        dom.reset.setAttribute('aria-label', 'Start the puzzle over');
    };
    dom.reset.addEventListener('click', () => {
        if (!dom.reset.classList.contains('confirm')) {
            dom.reset.classList.add('confirm');
            dom.reset.setAttribute('aria-label', 'Tap again to start over');
            confirmTimer = setTimeout(cancel, 3200);
            return;
        }
        cancel();
        puzzle.reset();
    });

    dom.toggle.addEventListener('click', () => {
        if (slides.paused) slides.resume(); else slides.pause();
        dom.toggle.classList.toggle('paused', slides.paused);
        dom.toggle.setAttribute('aria-label', slides.paused ? 'Play' : 'Pause');
    });

    // While the video plays, the controls (and cursor) fade away until you move.
    let idleTimer;
    const wake = () => {
        body.classList.remove('idle');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => body.classList.add('idle'), 2600);
    };
    for (const t of ['pointermove', 'pointerdown', 'keydown']) window.addEventListener(t, wake, { passive: true });
    wake();
}
