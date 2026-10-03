const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { hasModPermission } = require('../utils/permissions');

const LOG_CHANNEL_ID = '1538641855267209236';

module.exports = {
    name: 'purge',
    description: 'Delete a number of messages from this channel',
    async execute(message, args, client) {
        if (!hasModPermission(message.member)) {
            return message.reply('You do not have permission to use this command.');
        }

        const amount = parseInt(args[0], 10);
        const targetUser = message.mentions.users.first();

        if (!amount || isNaN(amount) || amount < 1 || amount > 100) {
            return message.reply('Please provide a valid number between 1 and 100. Example: `-purge 20` or `-purge 20 @user`');
        }

        const channel = message.channel;

        try {
            // Delete the command message itself first
            await message.delete().catch(() => {});

            const messages = await channel.messages.fetch({ limit: 100 });

            let toDelete = messages;
            if (targetUser) {
                toDelete = messages.filter(msg => msg.author.id === targetUser.id);
            }
            toDelete = [...toDelete.values()].slice(0, amount);

            const deleted = await channel.bulkDelete(toDelete, true);

            const confirmMsg = await channel.send({
                content: `Deleted ${deleted.size} message(s)${targetUser ? ` from ${targetUser}` : ''}.`,
            });
            setTimeout(() => confirmMsg.delete().catch(() => {}), 5000);

            // Log the usage
            try {
                const logChannel = message.guild.channels.cache.get(LOG_CHANNEL_ID);
                if (logChannel) {
                    const logContainer = new ContainerBuilder()
                        // no .setAccentColor() = no accent color
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                [
                                    `### <:velici_emoji1:1484383090276302943> Purge Command Used`,
                                    `<:summershark:1511396827520438392> Used by: ${message.author}`,
                                    `<:summershark:1511396827520438392> Channel: ${channel}`,
                                    `<:summershark:1511396827520438392> Amount: ${deleted.size}`,
                                    `<:summershark:1511396827520438392> Target: ${targetUser ? targetUser : 'Any user'}`,
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
                console.error('Failed to log purge command usage:', err);
            }
        } catch (err) {
            console.error('Failed to purge messages:', err);
            const errMsg = await channel.send('Failed to delete messages. Note: Discord cannot bulk-delete messages older than 14 days.');
            setTimeout(() => errMsg.delete().catch(() => {}), 5000);
        }
    },
};
