// Parses strings like "10m", "2h", "1d", "3w" into milliseconds.
// Returns null if the string doesn't match the expected format.
//
// options.cap: if true (default), durations longer than MAX_TIMEOUT_MS
// get clamped down to MAX_TIMEOUT_MS — this is what you want for
// Discord timeouts, which have a hard 28-day limit.
// Pass { cap: false } for LOA requests, which have no such limit.
function parseDuration(input, options = {}) {
    const { cap = true } = options;

    if (!input) return null;

    const match = /^(\d+)\s*(s|m|h|d|w)$/i.exec(input.trim());
    if (!match) return null;

    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    const multipliers = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
        w: 7 * 24 * 60 * 60 * 1000
    };

    const ms = amount * multipliers[unit];
    const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // Discord's hard cap on timeouts

    if (ms <= 0) return null;
    if (cap && ms > MAX_TIMEOUT_MS) return MAX_TIMEOUT_MS;

    return ms;
}

// Turns milliseconds back into a compact human string, e.g. "1d 2h"
function formatDuration(ms) {
    if (!ms) return 'N/A';

    let remaining = Math.floor(ms / 1000);
    const units = [
        ['w', 604800],
        ['d', 86400],
        ['h', 3600],
        ['m', 60],
        ['s', 1]
    ];

    const parts = [];
    for (const [label, secs] of units) {
        const val = Math.floor(remaining / secs);
        if (val > 0) {
            parts.push(`${val}${label}`);
            remaining -= val * secs;
        }
    }

    return parts.length ? parts.join(' ') : '0s';
}

module.exports = { parseDuration, formatDuration };