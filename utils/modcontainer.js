const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags
} = require('discord.js');

/**
 * Builds a Components V2 container with NO accent color (default neutral bar).
 *
 * @param {Object} opts
 * @param {string} opts.heading - Main title line
 * @param {Array<{label: string, value: string}>} [opts.fields] - key/value rows
 * @param {string} [opts.description] - free-text block, shown under the heading
 * @param {string} [opts.footer] - small muted line at the bottom
 */
function buildModContainer({ heading, fields = [], description, footer }) {
    const container = new ContainerBuilder();
    // Intentionally never calling .setAccentColor() here — keeps the left bar neutral/gray.

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ${heading}`)
    );

    if (description) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(description)
        );
    }

    if (fields.length) {
        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
        );

        const body = fields.map(f => `**${f.label}:** ${f.value}`).join('\n');
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
    }

    if (footer) {
        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
        );
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer}`));
    }

    return container;
}

// Wraps a container in the message payload shape needed for Components V2.
function containerPayload(container, extra = {}) {
    return {
        flags: MessageFlags.IsComponentsV2,
        components: [container],
        ...extra
    };
}

// Quick helper for simple one-line success/error replies, still container-based.
function quickContainer(heading, description) {
    return buildModContainer({ heading, description });
}

/**
 * Sends a container to the configured MOD_LOG_CHANNEL_ID.
 * Silently no-ops (with a console warning) if the channel/env var isn't set up,
 * so a broken log channel never breaks the actual mod action.
 */
async function sendModLogMessage(guild, payload) {
    const channelId = process.env.MOD_LOG_CHANNEL_ID;
    if (!channelId) {
        console.warn('MOD_LOG_CHANNEL_ID is not set in .env — skipping mod log message.');
        return;
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
        console.warn(`MOD_LOG_CHANNEL_ID (${channelId}) is invalid or not text-based.`);
        return;
    }

    const container = buildModContainer(payload);

    await channel.send(containerPayload(container)).catch(err => {
        console.error('Failed to send mod log message:', err);
    });
}

module.exports = { buildModContainer, containerPayload, quickContainer, sendModLogMessage };