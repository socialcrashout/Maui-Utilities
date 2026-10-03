const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    MessageFlags,
} = require('discord.js');
const { hasModPermission } = require('../utils/permissions');

const LOG_CHANNEL_ID = '1538641855267209236';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Delete a number of messages from this channel')
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Number of messages to delete (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('Only delete messages from this user')
                .setRequired(false)
        ),

    async execute(interaction) {
        if (!hasModPermission(interaction.member)) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true,
            });
        }

        const amount = interaction.options.getInteger('amount');
        const targetUser = interaction.options.getUser('user');

        await interaction.deferReply({ ephemeral: true });

        try {
            const messages = await interaction.channel.messages.fetch({ limit: 100 });

            let toDelete = messages;
            if (targetUser) {
                toDelete = messages.filter(msg => msg.author.id === targetUser.id);
            }
            toDelete = [...toDelete.values()].slice(0, amount);

            const deleted = await interaction.channel.bulkDelete(toDelete, true);

            await interaction.editReply({
                content: `Deleted ${deleted.size} message(s)${targetUser ? ` from ${targetUser}` : ''}.`,
            });

            // Log the usage
            try {
                const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
                if (logChannel) {
                    const logContainer = new ContainerBuilder()
                        // no .setAccentColor() = no accent color
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                [
                                    `### <:velici_emoji1:1484383090276302943> Purge Command Used`,
                                    `<:summershark:1511396827520438392> Used by: ${interaction.user}`,
                                    `<:summershark:1511396827520438392> Channel: ${interaction.channel}`,
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
            await interaction.editReply({
                content: 'Failed to delete messages. Note: Discord cannot bulk-delete messages older than 14 days.',
            });
        }
    },
};
