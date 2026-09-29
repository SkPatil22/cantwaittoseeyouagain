// Hard-cut video slideshow built on exactly two <video> elements.
//
//   front  visible, playing
//   back   hidden *behind* front (same size, lower z-index), already loaded
//
// A cut is only made once the back video is loaded AND has painted a real
// frame, then the two swap places in a single style change - so a cut is
// instant and can never show black. Clips that fail or stall are skipped.
// Two elements (not one per clip) keeps decoders and memory low, and the same
// two elements are "unlocked" by the guest's tap so iOS lets them keep playing.

const READY_MS = 12000;     // give a clip this long to become playable
const FRAME_MS = 1600;      // ...and this long to paint its first frame

/** Resolves when the element has actually presented a frame (or after a timeout). */
function firstFrame(el) {
    return new Promise((resolve) => {
        const t = setTimeout(resolve, FRAME_MS);
        const done = () => { clearTimeout(t); resolve(); };
        if ('requestVideoFrameCallback' in el) {
            el.requestVideoFrameCallback(done);
        } else if (!el.paused && el.readyState >= 3) {
            requestAnimationFrame(() => requestAnimationFrame(done));
        } else {
            el.addEventListener('playing', () => requestAnimationFrame(done), { once: true });
        }
    });
}

export class Slideshow extends EventTarget {
    constructor({ root, clips, deck, showSeconds = 5.5 }) {
        super();
        this.root = root;
        this.clips = clips;
        this.deck = deck;
        this.showSeconds = showSeconds;
        this.front = this._mk();
        this.back = this._mk();
        this.userPaused = false;
        this.cutting = false;
        this.running = false;
        this._revealing = false;
        this._prep = null;           // the one in-flight "load the next clip" job
        document.addEventListener('visibilitychange', () => {
            if (!this.running) return;
            if (document.hidden) this.front.pause();
            else if (!this.userPaused) this.front.play().catch(() => {});
        });
    }

    get paused() { return this.userPaused; }

    _mk() {
        const v = document.createElement('video');
        v.muted = true;
        v.defaultMuted = true;
        v.playsInline = true;
        v.loop = false;
        v.preload = 'auto';
        v.controls = false;
        v.disablePictureInPicture = true;
        v.tabIndex = -1;
        v.setAttribute('muted', '');
        v.setAttribute('playsinline', '');
        v.setAttribute('aria-hidden', 'true');
        this.root.appendChild(v);
        return v;
    }

    /** Start loading the first clip now so it is ready the moment the guest hits play. */
    prime(idx) {
        this._load(this.front, idx).then((ok) => { if (ok) this._prepareNext(); });
    }

    /**
     * Call synchronously inside the guest's tap. Starting playback here is what
     * lets iOS (especially in Low Power Mode) keep these elements playing later.
     */
    arm() {
        for (const el of [this.front, this.back]) {
            if (!el.getAttribute('src')) continue;
            const p = el.play();
            if (p && p.then) {
                p.then(() => {
                    if (this._revealing) return;         // the real start is already under way
                    el.pause();
                    try { el.currentTime = 0; } catch { /* not seekable yet */ }
                }).catch(() => {});
            }
        }
    }

    /** Show the first clip and start cycling. Throws if nothing is playable. */
    async reveal() {
        this._revealing = true;
        let ok = await this.front._ready;
        for (let tries = 0; !ok && tries < this.clips.length; tries++) {
            this.deck.markBad(this.front._idx);
            const idx = this.deck.current();
            if (idx == null) break;
            ok = await this._load(this.front, idx);
        }
        if (!ok) throw new Error('no playable clips');
        this.deck.consume(this.front._idx);
        await this._play(this.front);
        this.front.classList.add('front');
        this.running = true;
        if (this.clips.length < 2) this.front.loop = true;
        this._emitCut(this.front);
        this._watch();
        this._prepareNext();
    }

    pause() {
        this.userPaused = true;
        this.front.pause();
    }

    resume() {
        this.userPaused = false;
        this.front.play().catch(() => {});
    }

    stop() {
        this.running = false;
        for (const el of [this.front, this.back]) { el.pause(); el.classList.remove('front'); }
    }

    // ---- loading ---------------------------------------------------------------

    _load(el, idx) {
        const clip = this.clips[idx];
        const tok = (el._tok = {});
        el.pause();
        el.ontimeupdate = null;
        el.onended = null;
        el._idx = idx;
        el._state = 'loading';
        el.poster = new URL(clip.poster, document.baseURI).href;
        el.src = new URL(clip.src, document.baseURI).href;
        el.load();
        el._ready = new Promise((resolve) => {
            let settled = false;
            const finish = (ok) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                el.removeEventListener('canplay', onOk);
                el.removeEventListener('error', onErr);
                if (el._tok === tok) el._state = ok ? 'ready' : 'failed';
                resolve(ok && el._tok === tok);          // a newer load supersedes this one
            };
            const onOk = () => finish(true);
            const onErr = () => finish(false);
            const timer = setTimeout(() => finish(false), READY_MS);
            el.addEventListener('canplay', onOk);
            el.addEventListener('error', onErr);
            if (el.readyState >= 3) finish(true);
        });
        return el._ready;
    }

    _nextIdx() {
        let i = this.deck.current();
        if (i === this.front._idx) i = this.deck.after();   // front not consumed yet (before reveal)
        return i;
    }

    /**
     * Get the upcoming clip loaded into `back`. Serialised on purpose: one job at a
     * time, and it keeps going - skipping clips that fail - until `back` holds
     * something playable. Resolves true if it does, false if nothing else can play.
     */
    _prepareNext() {
        if (this.clips.length < 2) return Promise.resolve(false);
        if (this._prep) return this._prep;
        this._prep = (async () => {
            for (let tries = 0; tries < this.clips.length; tries++) {
                const idx = this._nextIdx();
                if (idx == null || idx === this.front._idx) return false;
                if (this.back._idx === idx && this.back._state === 'ready') return true;   // already loaded
                if (await this._load(this.back, idx)) return true;
                this.deck.markBad(idx);                      // failed or stalled: skip it for good
            }
            return false;
        })().finally(() => { this._prep = null; });
        return this._prep;
    }

    // ---- playing & cutting ------------------------------------------------------

    async _play(el) {
        try { el.currentTime = 0; } catch { /* not seekable yet */ }
        try { await el.play(); } catch { /* autoplay refused: the poster frame stays up */ }
        await firstFrame(el);
    }

    _watch() {
        const el = this.front;
        if (this.clips.length < 2) return;
        const limit = Math.min(this.showSeconds, Math.max(2, (el.duration || 99) - 0.3));
        const check = () => {
            if (el === this.front && !this.cutting && !this.userPaused && el.currentTime >= limit) this._cut();
        };
        el.ontimeupdate = check;
        el.onended = () => { if (el === this.front && !this.cutting) this._cut(); };
        if ('requestVideoFrameCallback' in el) {             // frame-accurate timing where available
            const tick = () => { if (el !== this.front) return; check(); el.requestVideoFrameCallback(tick); };
            el.requestVideoFrameCallback(tick);
        }
    }

    async _cut() {
        if (this.cutting) return;
        this.cutting = true;
        try {
            // If the next clip isn't ready yet, keep the current picture moving (loop it)
            // rather than freezing on its last frame.
            const front = this.front;
            const keepMoving = () => { front.loop = true; if (front.paused && !this.userPaused) front.play().catch(() => {}); };
            const ready = this.back._state === 'ready' && this.back._idx !== front._idx;
            if (!ready) keepMoving();
            const ok = await this._prepareNext();
            const next = this.back;
            if (!ok || next._state !== 'ready' || next._idx === front._idx) {
                return;                                          // nothing else playable: the loop carries on
            }
            await this._play(next);                              // decoding + painting behind the front video
            if (this.userPaused) { next.pause(); return; }       // guest paused while we waited: stay put
            next.classList.add('front');                         // one style flush = one instant cut
            front.classList.remove('front');
            front.loop = false;
            this.front = next;
            this.back = front;
            front.pause();
            this.deck.consume(next._idx);
            this._emitCut(next);
            this._watch();
            this._prepareNext();
        } finally {
            this.cutting = false;
        }
    }

    _emitCut(el) {
        this.dispatchEvent(new CustomEvent('cut', { detail: { clip: this.clips[el._idx], index: el._idx } }));
    }
}
