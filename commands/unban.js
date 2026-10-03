const { SlashCommandBuilder } = require('discord.js');
const { hasModPermission } = require('../utils/permissions');
const { performUnban } = require('../utils/modCore');
const { quickContainer, containerPayload } = require('../utils/modContainer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user by ID')
        .addStringOption(opt => opt.setName('user_id').setDescription('The user ID to unban').setRequired(true)),

    async execute(interaction, client) {
        if (!hasModPermission(interaction.member)) {
            return interaction.reply({
                ...containerPayload(quickContainer('❌ Missing Permissions', "You don't have permission to unban members.")),
                ephemeral: true
            });
        }

        const targetId = interaction.options.getString('user_id').trim();

        if (!/^\d{16,20}$/.test(targetId)) {
            return interaction.reply({
                ...containerPayload(quickContainer('❌ Invalid ID', 'That does not look like a valid Discord user ID.')),
                ephemeral: true
            });
        }

        await interaction.deferReply();

        const result = await performUnban({
            guild: interaction.guild,
            moderator: interaction.member,
            targetId,
            client
        });

        if (!result.ok) {
            return interaction.editReply(containerPayload(quickContainer('❌ Unban Failed', result.reason)));
        }

        return interaction.editReply(result.payload);
    }
};