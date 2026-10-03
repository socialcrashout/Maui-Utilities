const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const LOG_CHANNEL_ID = '1538641855267209236';
const ALLOWED_ROLE_ID = '1471629811221794827'; // role allowed to use -say

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

        await channel.send({ content: messageContent });

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
                                `<:summershark:1511396827520438392> Said: ${messageContent}`,
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