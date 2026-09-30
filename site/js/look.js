// The "look" of the title text for each clip: a font and an ink color.
//
// The ink comes from the build step (tools/build.py measured each clip and
// picked a color from its own palette that stays readable). The font rotates
// through ordinary, good-looking families - never the same one twice within
// the last few cuts.

// One weight per family keeps the download tiny (see fonts/fonts.css).
// `size` evens out how large each face looks at the same font-size for the big
// word; `detail` does the same for the small lines (delicate faces need a boost), and
// `stroke` (px) thickens the hairline faces so the small lines don't vanish.
export const FONTS = [
    { family: 'Playfair Display',   weight: 500, size: 1.00, detail: 1.00, stroke: 0, track: '-0.02em' },
    { family: 'Cormorant Garamond', weight: 600, size: 1.16, detail: 1.22, stroke: 0.35, track: '-0.01em' },
    { family: 'EB Garamond',        weight: 500, size: 1.08, detail: 1.12, stroke: 0.2, track: '-0.01em' },
    { family: 'Fraunces',           weight: 500, size: 1.00, detail: 1.00, stroke: 0, track: '-0.025em' },
    { family: 'DM Serif Display',   weight: 400, size: 1.00, detail: 1.02, stroke: 0, track: '-0.015em' },
    { family: 'Lora',               weight: 500, size: 1.02, detail: 1.00, stroke: 0, track: '-0.02em' },
    { family: 'Bodoni Moda',        weight: 500, size: 1.00, detail: 1.10, stroke: 0.3, track: '-0.02em' },
    { family: 'Inter',              weight: 500, size: 0.94, detail: 0.94, stroke: 0, track: '-0.045em' },
    { family: 'Manrope',            weight: 600, size: 0.96, detail: 0.94, stroke: 0, track: '-0.04em' },
    { family: 'Josefin Sans',       weight: 400, size: 1.06, detail: 1.08, stroke: 0.15, track: '-0.02em' },
];

/** Fetch every font up front so a cut never flashes a fallback face. */
export function preloadFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.allSettled(FONTS.map((f) => document.fonts.load(`${f.weight} 48px "${f.family}"`, 'again? 0123456789')));
}

// Halo behind the letters, as an rgb triplet: dark behind light ink, light behind dark ink.
const HALO = { light: '6 4 10', dark: '255 250 240' };

export class Look {
    constructor(root) {
        this.root = root;
        this.recent = [];
        window.addEventListener('resize', () => this.fit());
        if (document.fonts) document.fonts.addEventListener('loadingdone', () => this.fit());
    }

    /** Called at the exact moment of a hard cut. Everything changes together, no fade. */
    apply(clip) {
        const f = this._pick();
        const s = this.root.style;
        s.setProperty('--font', `"${f.family}"`);
        s.setProperty('--wght', f.weight);
        s.setProperty('--fsize', f.size);
        s.setProperty('--dsize', f.detail);
        s.setProperty('--dstroke', f.stroke + 'px');
        s.setProperty('--track', f.track);
        const ink = clip.ink || '#f4e9d0';
        const tone = clip.tone || 'light';
        s.setProperty('--ink', ink);                       // the big word
        s.setProperty('--ink2', clip.ink2 || ink);         // the small lines (they sit on different ground)
        s.setProperty('--sh-a', HALO[tone]);
        const tone2 = clip.tone2 || tone;
        s.setProperty('--sh-b', HALO[tone2]);
        // a dark rim behind pale letters must be firm; a pale rim behind dark letters should be gentle
        s.setProperty('--rim1', tone2 === 'light' ? .55 : .3);
        s.setProperty('--rim2', tone2 === 'light' ? .45 : .24);
        this.root.dataset.tone = tone;
        this.fit();                                        // same frame as the cut: the new font may be wider
    }

    /**
     * Shrink the big word just enough to fit the screen, whatever word and font are showing.
     * (Measured at full size, then --fit scales it. A 7-letter word in a wide face on a phone
     * would otherwise run off the edges.)
     */
    fit() {
        const word = this.root.querySelector('.headline');
        const box = word && word.closest('.title');
        if (!box) return;
        word.style.setProperty('--fit', '1');
        const cs = getComputedStyle(box);
        const room = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const need = word.scrollWidth;                     // the word never wraps, so this is its true width
        word.style.setProperty('--fit', need > room && room > 0 ? Math.max(0.4, (room / need) * 0.98).toFixed(3) : '1');
    }

    _pick() {
        const keep = Math.min(4, FONTS.length - 1);
        const pool = FONTS.filter((f) => !this.recent.includes(f.family));
        const f = pool[Math.floor(Math.random() * pool.length)] || FONTS[0];
        this.recent.push(f.family);
        if (this.recent.length > keep) this.recent.shift();
        return f;
    }
}
