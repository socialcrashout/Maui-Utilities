const fs = require('fs');
const path = require('path');
const { Events } = require('discord.js');
const { buildModContainer, containerPayload } = require('../utils/modcontainer');

// Counting settings
const COUNTING_CHANNEL_ID = '1471679451862663179';
const STATE_FILE = path.join(__dirname, '..', 'data', 'counting.json');

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

                state = { count: number, lastUserId: message.author.id };
                saveState();
                await sendStatus(
                    message.channel,
                    'Count accepted',
                    `**${number}** — <@${message.author.id}> counted. The next number is **${number + 1}**.`,
                    { allowedMentions: { users: [message.author.id] } }
                );
            })
            .catch(error => console.error('Counting system error:', error));
    },
};
