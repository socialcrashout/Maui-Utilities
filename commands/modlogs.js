const { SlashCommandBuilder } = require('discord.js');
const { hasModPermission } = require('../utils/permissions');
const { buildModLogsContainer } = require('../utils/modCore');
const { quickContainer, containerPayload } = require('../utils/modContainer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('modlogs')
        .setDescription("View a member's warnings and mod action history")
        .addUserOption(opt => opt.setName('user').setDescription('Member to look up').setRequired(true)),

    async execute(interaction, client) {
        if (!hasModPermission(interaction.member)) {
            return interaction.reply({
                ...containerPayload(quickContainer('❌ Missing Permissions', "You don't have permission to view mod logs.")),
                ephemeral: true
            });
        }

        const targetUser = interaction.options.getUser('user');

        await interaction.deferReply();

        const container = await buildModLogsContainer({ guild: interaction.guild, targetUser });

        return interaction.editReply(containerPayload(container));
    }
};