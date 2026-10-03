const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    MessageFlags,
    InteractionResponseFlags,
} = require('discord.js');

const LOG_CHANNEL_ID = '1538641855267209236';
const ALLOWED_ROLE_ID = '1471629811221794827'; // role allowed to use /say

module.exports = {
    data: new SlashCommandBuilder()
        .setName('say')
        .setDescription('Make the bot say something')
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('The message to send')
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option
                .setName('embed')
                .setDescription('Send as a V2 embed component (true) or plain text (false)')
                .setRequired(false)
        ),

    async execute(interaction) {
        // Role check
        if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                flags: InteractionResponseFlags.Ephemeral,
            });
        }

        const messageContent = interaction.options.getString('message');
        const useEmbed = interaction.options.getBoolean('embed') ?? false;

        // Acknowledge the interaction to avoid timing out when performing channel actions
        await interaction.deferReply({ flags: InteractionResponseFlags.Ephemeral }).catch(() => null);

        if (useEmbed) {
            const container = new ContainerBuilder()
                // no .setAccentColor() = no accent color
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(messageContent)
                );

            await interaction.channel.send({
                components: [container],
                flags: MessageFlags.IsComponentsV2,
            });
        } else {
            await interaction.channel.send({ content: messageContent });
        }

        await interaction.editReply({ content: 'Sent.' }).catch(async (err) => {
            // If editing reply failed because the interaction is unknown/expired, try replying non-ephemerally
            try {
                await interaction.followUp({ content: 'Sent.', ephemeral: true });
            } catch (e) {
                console.error('Failed to acknowledge say command to user:', e);
            }
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
                                `### <:velici_emoji1:1484383090276302943> Say Command Used`,
                                `<:summershark:1511396827520438392> Used by: ${interaction.user}`,
                                `<:summershark:1511396827520438392> Said: ${messageContent}`,
                                `<:summershark:1511396827520438392> Channel: ${interaction.channel}`,
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