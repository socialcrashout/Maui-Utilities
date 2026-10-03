const { SlashCommandBuilder } = require('discord.js');
const { hasModPermission } = require('../utils/permissions');
const { performUnmute } = require('../utils/modCore');
const { quickContainer, containerPayload } = require('../utils/modContainer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Remove a timeout from a member')
        .addUserOption(opt => opt.setName('user').setDescription('Member to unmute').setRequired(true)),

    async execute(interaction, client) {
        if (!hasModPermission(interaction.member)) {
            return interaction.reply({
                ...containerPayload(quickContainer('❌ Missing Permissions', "You don't have permission to unmute members.")),
                ephemeral: true
            });
        }

        const targetMember = interaction.options.getMember('user');

        if (!targetMember) {
            return interaction.reply({
                ...containerPayload(quickContainer('❌ User Not Found', 'That user is not in this server.')),
                ephemeral: true
            });
        }

        await interaction.deferReply();

        const result = await performUnmute({
            guild: interaction.guild,
            moderator: interaction.member,
            targetMember,
            client
        });

        if (!result.ok) {
            return interaction.editReply(containerPayload(quickContainer('❌ Unmute Failed', result.reason)));
        }

        return interaction.editReply(result.payload);
    }
};