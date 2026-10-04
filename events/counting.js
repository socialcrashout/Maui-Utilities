const fs = require('fs');
const path = require('path');
const { Events } = require('discord.js');
const { buildModContainer, containerPayload } = require('../utils/modcontainer');

// Counting settings
const COUNTING_CHANNEL_ID = '1471679451862663179';
const STATE_FILE = path.join(__dirname, '..', 'data', 'counting.json');
const HISTORY_PAGE_LIMIT = 100;
const HISTORY_MAX_PAGES = 50;

function loadState() {
    try {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (Number.isSafeInteger(state.count) && state.count >= 0) {
            return { count: state.count, lastUserId: state.lastUserId || null };
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Could not read counting state; starting from zero:', error);
        }
    }
    return { count: 0, lastUserId: null };
}

let state = loadState();
let historyReady = false;

function saveState() {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const temporaryFile = `${STATE_FILE}.tmp`;
    fs.writeFileSync(temporaryFile, `${JSON.stringify(state, null, 2)}\n`);
    fs.renameSync(temporaryFile, STATE_FILE);
}

async function sendStatus(channel, heading, description, extra = {}) {
    const container = buildModContainer({ heading, description });
    await channel.send(containerPayload(container, extra));
}

function componentText(message) {
    const pieces = [message.content || ''];
    const visit = component => {
        if (!component || typeof component !== 'object') return;
        if (typeof component.content === 'string') pieces.push(component.content);
        for (const child of component.components || []) visit(child);
    };
    for (const component of message.components || []) {
        visit(typeof component.toJSON === 'function' ? component.toJSON() : component);
    }
    return pieces.join('\n');
}

function isResetNotice(message) {
    return message.author.bot && componentText(message).includes('Counting reset');
}

function replayMessages(messages, firstResetIndex = -1) {
    const ordered = [...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const lastResetIndex = ordered.reduce((found, message, index) => isResetNotice(message) ? index : found, firstResetIndex);
    const replayFrom = lastResetIndex >= 0 ? lastResetIndex + 1 : 0;
    let rebuilt = { count: 0, lastUserId: null };

    // If history was truncated before the most recent reset, use its first
    // visible number as a checkpoint, then validate every newer message.
    if (lastResetIndex < 0) {
        const firstNumber = ordered.slice(replayFrom).find(message =>
            !message.author.bot && /^\d+$/.test(message.content.trim()) && Number.isSafeInteger(Number(message.content.trim()))
        );
        if (firstNumber) rebuilt.count = Number(firstNumber.content.trim()) - 1;
    }

    for (const message of ordered.slice(replayFrom)) {
        if (message.author.bot) continue;
        const text = message.content.trim();
        if (!/^\d+$/.test(text)) continue;
        const number = Number(text);
        if (!Number.isSafeInteger(number)) continue;
        if (message.author.id === rebuilt.lastUserId || number !== rebuilt.count + 1) {
            rebuilt = { count: 0, lastUserId: null };
        } else {
            rebuilt = { count: number, lastUserId: message.author.id };
        }
    }
    return rebuilt;
}

async function recoverStateFromHistory(channel, beforeMessageId) {
    const messages = [];
    let before = beforeMessageId;
    for (let pageNumber = 0; pageNumber < HISTORY_MAX_PAGES; pageNumber++) {
        const page = await channel.messages.fetch({ limit: HISTORY_PAGE_LIMIT, before });
        if (!page.size) break;
        const pageMessages = [...page.values()];
        messages.push(...pageMessages);
        if (pageMessages.some(isResetNotice) || page.size < HISTORY_PAGE_LIMIT) break;
        before = page.last().id;
    }

    state = replayMessages(messages);
    try {
        saveState();
    } catch (error) {
        console.error('Could not save the recovered counting state:', error);
    }
    historyReady = true;
}

// Process counting messages in order so two rapid messages cannot use stale state.
let messageQueue = Promise.resolve();

module.exports = {
    name: Events.MessageCreate,
    once: false,
    execute(message) {
        if (message.author.bot || !message.guild || message.channelId !== COUNTING_CHANNEL_ID) return;

        const text = message.content.trim();
        // Let non-number messages pass without interrupting the count.
        if (!/^\d+$/.test(text)) return;

        messageQueue = messageQueue
            .then(async () => {
                // The local JSON file may reset on redeploy. Rebuild once from
                // channel history before trusting it, excluding this message.
                if (!historyReady) await recoverStateFromHistory(message.channel, message.id);

                const number = Number(text);
                if (!Number.isSafeInteger(number)) return;

                let resetReason = null;
                if (state.lastUserId === message.author.id) {
                    resetReason = 'The same person cannot count twice in a row.';
                } else if (number !== state.count + 1) {
                    resetReason = `The next number was **${state.count + 1}**, but **${number}** was sent.`;
                }

                if (resetReason) {
                    state = { count: 0, lastUserId: null };
                    saveState();
                    await sendStatus(message.channel, 'Counting reset', `${resetReason}\nStart again at **1**.`);
                    return;
                }

                try {
                    await message.react('✅');
                } catch (error) {
                    console.error('Could not mark the accepted counting message:', error);
                    await sendStatus(message.channel, 'Could not mark count', 'I could not add the ✅ reaction. Please check that I have Add Reactions permission.');
                    return;
                }

                state = { count: number, lastUserId: message.author.id };
                saveState();
            })
            .catch(error => console.error('Counting system error:', error));
    },
};
