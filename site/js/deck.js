// The playlist order.
//
// One random shuffle, saved in a cookie, that plays every clip exactly once
// before a fresh shuffle starts - and a fresh shuffle never opens with the clip
// that just played. Position is saved too, so a returning guest carries on
// through the deck instead of seeing the same opening clip every visit.
//
//   current()  the clip that will play next (the puzzle picture is its poster)
//   after()    the one after that (for pre-loading)
//   consume(i) "clip i has been shown" - advance past it and save
//   markBad()  skip a clip that failed to load

import { cookies, b36, unb36, hash36, shuffle } from './store.js';

const COOKIE = 'dk';

export class Deck {
    constructor(ids) {
        this.n = ids.length;
        this.fp = hash36(ids.join('|'));     // changes when clips are added/removed -> reshuffle
        this.bad = new Set();
        this.upcoming = null;                // the next deck, created only when needed
        const saved = this._read();
        if (saved) {
            this.order = saved.order;
            this.pos = saved.pos;
        } else {
            this.order = shuffle([...Array(this.n).keys()]);
            this.pos = 0;
            this._write();
        }
    }

    current() {
        const f = this._firstPlayable(0);
        return f ? f.idx : null;
    }

    after() {
        const f = this._firstPlayable(0);
        if (!f) return null;
        const g = this._firstPlayable(f.abs - this.pos + 1);
        return g ? g.idx : f.idx;
    }

    /** Mark a clip as shown. Pass its index so we can never drift out of step with what's on screen. */
    consume(idx) {
        let hit = null;
        if (idx != null) {
            for (let abs = this.pos; abs < this.n * 2; abs++) {
                if (this._at(abs) === idx) { hit = { idx, abs }; break; }
            }
        }
        const f = hit || this._firstPlayable(0);
        if (!f) return null;
        this._advanceTo(f.abs + 1);
        return f.idx;
    }

    markBad(idx) { this.bad.add(idx); }

    // ---- internals -----------------------------------------------------------

    _next() {
        if (!this.upcoming) {
            const o = shuffle([...Array(this.n).keys()]);
            const last = this.order[this.n - 1];
            if (this.n > 1 && o[0] === last) {
                const j = 1 + Math.floor(Math.random() * (this.n - 1));
                [o[0], o[j]] = [o[j], o[0]];
            }
            this.upcoming = o;
        }
        return this.upcoming;
    }

    // Absolute offsets run over [order..., upcoming...].
    _at(abs) { return abs < this.n ? this.order[abs] : this._next()[abs - this.n]; }

    _firstPlayable(fromOffset) {
        for (let abs = this.pos + fromOffset; abs < this.n * 2; abs++) {
            const idx = this._at(abs);
            if (!this.bad.has(idx)) return { idx, abs };
        }
        return null;
    }

    _advanceTo(abs) {
        if (abs >= this.n) {
            this.order = this._next();
            this.upcoming = null;
            this.pos = abs - this.n;
        } else {
            this.pos = abs;
        }
        this._write();
    }

    _read() {
        try {
            const [v, pos, fp, ord] = (cookies.get(COOKIE) || '').split('.');
            if (v !== '1' || fp !== this.fp || !ord || ord.length !== this.n * 2) return null;
            const order = [];
            for (let i = 0; i < this.n; i++) order.push(unb36(ord.slice(i * 2, i * 2 + 2)));
            const p = unb36(pos);
            const ok = new Set(order).size === this.n && order.every((x) => x >= 0 && x < this.n) && p >= 0 && p < this.n;
            return ok ? { order, pos: p } : null;
        } catch { return null; }
    }

    _write() {
        cookies.set(COOKIE, ['1', b36(this.pos), this.fp, this.order.map((i) => b36(i, 2)).join('')].join('.'));
    }
}
