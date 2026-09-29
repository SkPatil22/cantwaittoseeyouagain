// Small shared helpers: cookies, base-36 codecs, a seeded random generator.
//
// Cookie values are kept to [0-9a-z.] on purpose - no URL-encoding blow-up, so
// the whole puzzle fits in a few hundred bytes (browsers silently drop any
// cookie over 4096 bytes, which the old JSON format hit at ~40 pieces).

const DAY = 86400;

export const cookies = {
    get(name) {
        const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return m ? m[1] : null;
    },
    set(name, value, days = 180) {
        try {
            const secure = location.protocol === 'https:' ? '; Secure' : '';
            document.cookie = `${name}=${value}; Max-Age=${days * DAY}; Path=/; SameSite=Lax${secure}`;
        } catch { /* cookies blocked: the page still works, progress just won't persist */ }
    },
    del(name) {
        try { document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`; } catch { /* ignore */ }
    },
};

export const b36 = (n, width = 0) => Math.max(0, Math.floor(n)).toString(36).padStart(width, '0');
export const unb36 = (s) => parseInt(s, 36);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Deterministic PRNG so a saved seed always rebuilds the same piece shapes. */
export function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** In-place Fisher-Yates. */
export function shuffle(arr, rng = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/** 32-bit FNV-1a, base 36. Used to notice when the clip list has changed. */
export function hash36(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
}
