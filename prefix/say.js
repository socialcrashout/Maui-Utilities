const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const LOG_CHANNEL_ID = '1538641855267209236';
const ALLOWED_ROLE_ID = '1471629811221794827'; // role allowed to use -say
const TEXT_DISPLAY_LIMIT = 3900;

function splitLongMessage(text) {
    const chunks = [];
    let remaining = text;

    while (remaining.length > TEXT_DISPLAY_LIMIT) {
        let splitAt = remaining.lastIndexOf('\n\n', TEXT_DISPLAY_LIMIT);
        if (splitAt < TEXT_DISPLAY_LIMIT / 2) splitAt = remaining.lastIndexOf('\n', TEXT_DISPLAY_LIMIT);
        if (splitAt < TEXT_DISPLAY_LIMIT / 2) splitAt = remaining.lastIndexOf(' ', TEXT_DISPLAY_LIMIT);
        if (splitAt <= 0) splitAt = TEXT_DISPLAY_LIMIT;

        let chunk = remaining.slice(0, splitAt).trimEnd();
        remaining = remaining.slice(splitAt).trimStart();

        // Keep fenced code blocks valid when an unusually long post crosses a chunk.
        const openFence = (chunk.match(/```/g) || []).length % 2 === 1;
        if (openFence) {
            chunk += '\n```';
            remaining = `\`\`\`\n${remaining}`;
        }
        chunks.push(chunk);
    }

    if (remaining) chunks.push(remaining);
    return chunks;
}

function makeMessageContainer(content) {
    return new ContainerBuilder()
        // No accent color: keep the server's neutral Components V2 style.
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

module.exports = {
    name: 'say',
    description: 'Make the bot say something',
    async execute(message, args, client) {
        // Role check
        if (!message.member.roles.cache.has(ALLOWED_ROLE_ID)) {
            return message.reply('You do not have permission to use this command.');
        }

        const messageContent = args.join(' ');

        if (!messageContent) {
            return message.reply('Please provide a message. Example: `-say Hello world`');
        }

        const channel = message.channel;
        const chunks = splitLongMessage(messageContent);

        for (const chunk of chunks) {
            await channel.send({
                components: [makeMessageContainer(chunk)],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        await message.delete().catch(() => {});

        // Log the usage
        try {
            const logChannel = message.guild.channels.cache.get(LOG_CHANNEL_ID);
            if (logChannel) {
                const logContainer = new ContainerBuilder()
                    // no .setAccentColor() = no accent color
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            [
                                `### <:velici_emoji1:1484383090276302943> Say Command Used`,
                                `<:summershark:1511396827520438392> Used by: ${message.author}`,
                                `<:summershark:1511396827520438392> Said: ${messageContent.slice(0, 1500)}${messageContent.length > 1500 ? '… (truncated in log)' : ''}`,
                                `<:summershark:1511396827520438392> Channel: ${channel}`,
                            ].join('\n')
                        )
                    );

                await logChannel.send({
                    components: [logContainer],
                    flags: MessageFlags.IsComponentsV2,
                    allowedMentions: { parse: [] },
                });
            }
        } catch (err) {
            console.error('Failed to log say command usage:', err);
        }
    },
};
