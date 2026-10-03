const { SlashCommandBuilder } = require('discord.js');
const { hasModPermission } = require('../utils/permissions');
const { performKick } = require('../utils/modCore');
const { quickContainer, containerPayload } = require('../utils/modContainer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a member from the server')
        .addUserOption(opt => opt.setName('user').setDescription('Member to kick').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the kick').setRequired(false)),

    async execute(interaction, client) {
        if (!hasModPermission(interaction.member)) {
            return interaction.reply({
                ...containerPayload(quickContainer('❌ Missing Permissions', "You don't have permission to kick members.")),
                ephemeral: true
            });
        }

        const targetMember = interaction.options.getMember('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (!targetMember) {
            return interaction.reply({
                ...containerPayload(quickContainer('❌ User Not Found', 'That user is not in this server.')),
                ephemeral: true
            });
        }

        await interaction.deferReply();

        const result = await performKick({
            guild: interaction.guild,
            moderator: interaction.member,
            targetMember,
            reason,
            client
        });

        if (!result.ok) {
            return interaction.editReply(containerPayload(quickContainer('❌ Kick Failed', result.reason)));
        }

        return interaction.editReply(result.payload);
    }
};