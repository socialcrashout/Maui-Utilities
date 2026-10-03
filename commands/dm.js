const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    MessageFlags,
} = require('discord.js');

const LOG_CHANNEL_ID = '1538641855267209236';
const ALLOWED_ROLE_ID = '1471629811221794827'; // role allowed to use /dm

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dm')
        .setDescription('Send a direct message to a user')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to DM')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('The message to send')
                .setRequired(true)
        ),

    async execute(interaction) {
        // Role check
        if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true,
            });
        }

        const targetUser = interaction.options.getUser('user');
        const messageContent = interaction.options.getString('message');

        try {
            await targetUser.send({ content: messageContent });
            await interaction.reply({ content: `Sent.`, ephemeral: true });
        } catch (err) {
            console.error('Failed to send DM:', err);
            return interaction.reply({
                content: `Could not DM ${targetUser} — they may have DMs disabled or have blocked the bot.`,
                ephemeral: true,
            });
        }

        // Log the usage
        try {
            const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
            if (logChannel) {
                const logContainer = new ContainerBuilder()
                    // no .setAccentColor() = no accent color
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            [
                                `### <:velici_emoji1:1484383090276302943> DM Command Used`,
                                `<:summershark:1511396827520438392> Used by: ${interaction.user}`,
                                `<:summershark:1511396827520438392> Sent to: ${targetUser}`,
                                `<:summershark:1511396827520438392> Said: ${messageContent}`,
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
            console.error('Failed to log dm command usage:', err);
        }
    },
};