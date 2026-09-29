// The jigsaw: pieces, dragging, snapping, saved progress, and the line-wipe.
//
//  * Grid adapts to the screen (about 36-66 pieces) so pieces stay a
//    finger-friendly size on phones and the puzzle stays hard on desktop.
//  * Progress lives in one small cookie (see encodeState) - a few hundred
//    bytes, well under the 4 KB browser limit at any piece count.
//  * Pieces move with CSS transforms (GPU) and are grabbed by their real
//    outline, so overlapping pieces behave like physical ones.

import { makeGeometry } from './jigsaw.js';
import { cookies, b36, unb36, mulberry32, clamp, shuffle } from './store.js';

const COOKIE = 'pz';
const SVGNS = 'http://www.w3.org/2000/svg';
const Q = 1294;                                   // position precision in the cookie
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** How many pieces fit this screen. Target piece size 92-168 CSS px. */
export function pickGrid(w, h) {
    const target = clamp(Math.min(w, h) * 0.19, 92, 168);
    return { cols: Math.max(3, Math.round(w / target)), rows: Math.max(3, Math.round(h / target)) };
}

// Saved grids stay valid unless the screen shape changed a lot (e.g. rotated phone).
const compatible = (s, W, H) => {
    const a = (W / s.cols) / (H / s.rows);
    return a > 0.62 && a < 1.6;
};

// ---- cookie format ----------------------------------------------------------
//   1.<cols>.<rows>.<seed>.<done 0|1>.<4 chars per piece>
// Per piece: two base-36 pairs = loose position across the screen (0..1294),
// or "zzzz" once it has been placed. 60 pieces ~ 270 bytes.

function encodeState(s) {
    let body = '';
    for (const p of s.pieces) {
        body += p.placed
            ? 'zzzz'
            : b36(Math.round(clamp(p.fx, 0, 1) * Q), 2) + b36(Math.round(clamp(p.fy, 0, 1) * Q), 2);
    }
    return ['1', s.cols, s.rows, b36(s.seed), s.done ? 1 : 0, body].join('.');
}

function decodeState(raw) {
    try {
        const [v, cols, rows, seed, done, body] = String(raw).split('.');
        const C = +cols, R = +rows;
        if (v !== '1' || !(C >= 2 && C <= 40 && R >= 2 && R <= 40) || body.length !== C * R * 4) return null;
        const pieces = [];
        for (let i = 0; i < C * R; i++) {
            const t = body.slice(i * 4, i * 4 + 4);
            if (t === 'zzzz') { pieces.push({ placed: true }); continue; }
            const x = unb36(t.slice(0, 2)), y = unb36(t.slice(2));
            if (!(x >= 0 && x <= Q && y >= 0 && y <= Q)) return null;
            pieces.push({ placed: false, fx: x / Q, fy: y / Q });
        }
        return { cols: C, rows: R, seed: unb36(seed) >>> 0, done: done === '1', pieces };
    } catch { return null; }
}

function freshState({ cols, rows }) {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const rng = mulberry32(seed ^ 0x9e3779b9);
    const n = cols * rows;
    // Scatter: give every piece a random cell of a jittered grid, never on or
    // right beside its own home. Covers the whole screen (no big empty patches).
    const free = new Set([...Array(n).keys()]);
    const cellOf = new Array(n);
    for (const i of shuffle([...Array(n).keys()], rng)) {
        const hr = Math.floor(i / cols), hc = i % cols;
        const far = [...free].filter((k) => Math.max(Math.abs(Math.floor(k / cols) - hr), Math.abs((k % cols) - hc)) >= 2);
        const pool = far.length ? far : [...free];
        const k = pool[Math.floor(rng() * pool.length)];
        free.delete(k);
        cellOf[i] = k;
    }
    const pieces = cellOf.map((k) => ({
        placed: false,
        fx: clamp((((k % cols) + 0.5 + (rng() - 0.5) * 0.9) / cols), 0.03, 0.97),
        fy: clamp(((Math.floor(k / cols) + 0.5 + (rng() - 0.5) * 0.9) / rows), 0.03, 0.97),
    }));
    return { cols, rows, seed, done: false, pieces };
}

async function decode(url) {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    if (img.decode) await img.decode();
    else await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
}

// ---- the puzzle -----------------------------------------------------------

export class Puzzle extends EventTarget {
    constructor({ layer, pieces, seams, assembled, image }) {
        super();
        this.layer = layer;
        this.piecesEl = pieces;
        this.seamsEl = seams;
        this.assembledEl = assembled;
        this.image = new URL(image, document.baseURI).href;
        this.list = [];
        this.z = 10;
        this.drag = null;
        this.locked = false;
        this._move = (e) => this._onMove(e);
        this._up = (e) => this._onUp(e);
    }

    async init() {
        await decode(this.image);                       // throws if the poster can't load
        // Only wire up events once we know this puzzle is going to be used.
        this.piecesEl.addEventListener('pointerdown', (e) => this._onDown(e));
        this.piecesEl.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('resize', () => this._onResize());
        this.assembledEl.style.backgroundImage = `url("${this.image}")`;
        this._measure();
        const saved = decodeState(cookies.get(COOKIE) || '');
        if (saved && (saved.done || compatible(saved, this.W, this.H))) {
            this.state = saved;
        } else {
            this.state = freshState(pickGrid(this.W, this.H));
            this._write();
        }
        this._build();
        if (this.state.done) this._finish({ instant: true });
        else this._intro();
        this._emitProgress();
    }

    get total() { return this.list.length; }

    // ---- layout -------------------------------------------------------------

    _measure() {
        this.W = this.layer.clientWidth;
        this.H = this.layer.clientHeight;
    }

    _build() {
        const { cols, rows, seed } = this.state;
        this.geo = makeGeometry({ cols, rows, width: this.W, height: this.H, seed });
        this.snapR = Math.max(22, Math.min(this.geo.pw, this.geo.ph) * (matchMedia('(pointer: coarse)').matches ? 0.5 : 0.38));
        this.piecesEl.textContent = '';
        this.list = new Array(cols * rows);
        this.placed = 0;
        const frag = document.createDocumentFragment();
        // Stable random stacking order for this puzzle.
        const order = shuffle([...Array(cols * rows).keys()], mulberry32(seed ^ 0x51ed270b));
        for (const i of order) {
            const r = Math.floor(i / cols), c = i % cols;
            const s = this.state.pieces[i];
            const p = { i, r, c, placed: !!s.placed, cx: 0, cy: 0, el: null };
            p.el = this._makeEl(p);
            if (p.placed) {
                const h = this.geo.home(r, c);
                p.cx = h.x; p.cy = h.y;
                p.el.classList.add('placed');
                p.el.style.zIndex = 1;
                this.placed++;
            } else {
                p.cx = clamp(s.fx * this.W, 0, this.W);
                p.cy = clamp(s.fy * this.H, 0, this.H);
            }
            this.list[i] = p;
            this._apply(p);
            frag.appendChild(p.el);
        }
        this.piecesEl.appendChild(frag);
    }

    _makeEl(p) {
        const { pw, ph, M } = this.geo;
        const d = this.geo.piecePath(p.r, p.c);
        const bw = pw + 2 * M, bh = ph + 2 * M;
        const el = document.createElement('div');
        el.className = 'piece';
        el.dataset.i = p.i;
        el.style.width = bw + 'px';
        el.style.height = bh + 'px';
        el.innerHTML =
            `<svg width="${bw}" height="${bh}" viewBox="0 0 ${bw} ${bh}" aria-hidden="true">` +
            `<defs><clipPath id="pc${p.i}"><path d="${d}"/></clipPath></defs>` +
            `<path class="sh" d="${d}" filter="url(#pz-blur)"/>` +
            `<g clip-path="url(#pc${p.i})"><image href="${this.image}" x="${M - p.c * pw}" y="${M - p.r * ph}"` +
            ` width="${this.W}" height="${this.H}" preserveAspectRatio="xMidYMid slice"/></g>` +
            `<path class="sheen" d="${d}"/><path class="edge" d="${d}"/><path class="hit" d="${d}"/></svg>`;
        return el;
    }

    _boxXY(cx, cy) {
        return [cx - this.geo.pw / 2 - this.geo.M, cy - this.geo.ph / 2 - this.geo.M];
    }

    _tf(cx, cy, extra = '') {
        const [x, y] = this._boxXY(cx, cy);
        return `translate3d(${x}px,${y}px,0)${extra}`;
    }

    _apply(p, lifted = false) {
        p.el.style.transform = this._tf(p.cx, p.cy, lifted ? ' scale(1.035)' : '');
    }

    _home(p) { return this.geo.home(p.r, p.c); }

    _intro() {
        if (reduceMotion()) return;
        shuffle(this.list.slice()).forEach((p, k) => {
            p.el.animate(
                [{ opacity: 0, transform: this._tf(p.cx, p.cy, ' translateY(-16px) scale(.92)') },
                 { opacity: 1, transform: this._tf(p.cx, p.cy) }],
                { duration: 700, delay: 60 + k * 11, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
        });
    }

    _onResize() {
        clearTimeout(this._rt);
        this._rt = setTimeout(() => {
            if (this.drag) return this._onResize();     // never rebuild under someone's finger
            const w = this.layer.clientWidth, h = this.layer.clientHeight;
            if (!w || !h) return;                       // layer hidden (after the reveal): nothing to lay out
            if (Math.abs(w - this.W) < 2 && Math.abs(h - this.H) < 2) return;
            this._syncState();
            this._measure();
            if (!this.state.done && !compatible(this.state, this.W, this.H)) {
                this.state = freshState(pickGrid(this.W, this.H));    // e.g. phone rotated
            }
            this._build();
            if (this.state.done) this._buildSeams();
            this._write();
            this._emitProgress();
        }, 220);
    }

    // ---- dragging -------------------------------------------------------------

    _onDown(e) {
        if (this.locked || (e.button && e.button > 0)) return;
        const el = e.target.closest && e.target.closest('.piece');
        if (!el) return;
        const p = this.list[+el.dataset.i];
        if (!p || p.placed) return;
        e.preventDefault();
        this.drag = { p, id: e.pointerId, dx: p.cx - e.clientX, dy: p.cy - e.clientY };
        p.el.style.zIndex = ++this.z;
        p.el.classList.add('lifted');
        this._apply(p, true);
        window.addEventListener('pointermove', this._move);
        window.addEventListener('pointerup', this._up);
        window.addEventListener('pointercancel', this._up);
        this.dispatchEvent(new Event('grab'));
    }

    _onMove(e) {
        const d = this.drag;
        if (!d || e.pointerId !== d.id) return;
        d.p.cx = clamp(e.clientX + d.dx, 0, this.W);
        d.p.cy = clamp(e.clientY + d.dy, 0, this.H);
        this._apply(d.p, true);
    }

    _onUp(e) {
        const d = this.drag;
        if (!d || e.pointerId !== d.id) return;
        this.drag = null;
        window.removeEventListener('pointermove', this._move);
        window.removeEventListener('pointerup', this._up);
        window.removeEventListener('pointercancel', this._up);
        const p = d.p;
        p.el.classList.remove('lifted');
        const h = this._home(p);
        if (Math.hypot(p.cx - h.x, p.cy - h.y) <= this.snapR) {
            this._place(p, { from: this._tf(p.cx, p.cy, ' scale(1.035)') });
        } else {
            this._apply(p, false);
            this._save();
        }
    }

    _place(p, { from = null, duration = 260 } = {}) {
        const fromTf = from || this._tf(p.cx, p.cy);
        const h = this._home(p);
        p.placed = true;
        p.cx = h.x; p.cy = h.y;
        p.el.classList.add('placed');
        p.el.style.zIndex = 1;
        this._apply(p, false);
        if (!reduceMotion()) {
            p.el.animate([{ transform: fromTf }, { transform: this._tf(h.x, h.y) }],
                { duration, easing: 'cubic-bezier(.2,.9,.25,1.15)' });
            const edge = p.el.querySelector('.edge');
            edge && edge.animate([{ stroke: 'rgba(255,255,255,.95)' }, { stroke: 'rgba(255,255,255,.42)' }], { duration: 650 });
        }
        this.placed++;
        this._save();
        this._emitProgress();
        if (navigator.vibrate) { try { navigator.vibrate(10); } catch { /* not supported */ } }
        if (this.placed === this.list.length) this._finish();
    }

    // ---- solved state -----------------------------------------------------------

    _finish({ instant = false } = {}) {
        this.locked = true;
        this.state.done = true;
        this._save();
        this._buildSeams();
        this.layer.classList.add('solved');            // CSS: assembled picture on, piece outlines off, seams on
        const done = () => {
            this.piecesEl.style.display = 'none';       // the assembled picture is pixel-identical underneath
            this.dispatchEvent(new Event('complete'));
        };
        if (instant) requestAnimationFrame(done); else setTimeout(done, 520);
    }

    /** Each internal cut, once, as its own path - so each one can be wiped separately. */
    _buildSeams() {
        const s = this.seamsEl;
        s.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
        s.textContent = '';
        for (const d of this.geo.cutPaths()) {
            const path = document.createElementNS(SVGNS, 'path');
            path.setAttribute('d', d);
            path.setAttribute('pathLength', '1');
            s.appendChild(path);
        }
    }

    /**
     * Erase the puzzle lines: every segment is wiped from one end to the
     * other (direction chosen at random) at a random moment, fading as it goes.
     */
    wipeSeams() {
        const quick = reduceMotion();
        const anims = [...this.seamsEl.querySelectorAll('path')].map((p) => {
            const dir = Math.random() < 0.5 ? 1 : -1;
            const delay = Math.random() * (quick ? 200 : 1900);
            const duration = quick ? 500 : 1000 + Math.random() * 800;
            return p.animate(
                [{ strokeDashoffset: 0, opacity: 1 },
                 { strokeDashoffset: dir * 0.55, opacity: 0.6, offset: 0.55 },
                 { strokeDashoffset: dir, opacity: 0 }],
                { duration, delay, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'forwards' }).finished.catch(() => {});
        });
        return Promise.all(anims).then(() => { this.seamsEl.textContent = ''; });
    }

    // ---- helpers for the app ----------------------------------------------------

    /** Testing shortcut: snap everything home. Same code path as a real solve. */
    autocomplete() {
        if (this.state.done || this.auto) return;
        this.auto = true;
        this.locked = true;
        const loose = shuffle(this.list.filter((p) => !p.placed));
        const step = Math.min(70, 1500 / Math.max(1, loose.length));
        loose.forEach((p, k) => setTimeout(() => this._place(p, { duration: 520 }), k * step));
    }

    reset() {
        cookies.del(COOKIE);
        this.auto = false;
        this.locked = false;
        this.layer.classList.remove('solved');
        this.piecesEl.style.display = '';
        this.seamsEl.textContent = '';
        this._measure();
        this.state = freshState(pickGrid(this.W, this.H));
        this._write();
        this._build();
        this._intro();
        this._emitProgress();
        this.dispatchEvent(new Event('reset'));
    }

    // ---- persistence ---------------------------------------------------------------

    _syncState() {
        this.state.pieces = this.list.map((p) =>
            p.placed ? { placed: true } : { placed: false, fx: p.cx / this.W, fy: p.cy / this.H });
    }
    _write() { cookies.set(COOKIE, encodeState(this.state)); }
    _save() { this._syncState(); this._write(); }

    _emitProgress() {
        this.dispatchEvent(new CustomEvent('progress', { detail: { placed: this.placed, total: this.list.length } }));
    }
}
