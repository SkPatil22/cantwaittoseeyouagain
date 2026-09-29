// The few knobs worth turning. Everything else lives in the code.

export default {
    // How long each clip is on screen, in seconds. (tools/build.py keeps 7s of each clip.)
    clipSeconds: 5.5,

    // Type this word anywhere to auto-solve the puzzle - handy for testing.
    // Also works as a link: https://your-site/#again . Set to '' to switch it off.
    cheatWord: 'again',

    // Optional: Cloudflare Web Analytics token, for a visit count on any host.
    // Not needed if you switched Web Analytics on in the Cloudflare Pages dashboard.
    analyticsToken: '',
};
