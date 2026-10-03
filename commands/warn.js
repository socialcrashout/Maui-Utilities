const { SlashCommandBuilder } = require('discord.js');
const { hasModPermission } = require('../utils/permissions');
const { performWarn } = require('../utils/modCore');
const { quickContainer, containerPayload } = require('../utils/modContainer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Issue a warning to a member')
        .addUserOption(opt => opt.setName('user').setDescription('Member to warn').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the warning').setRequired(true)),

    async execute(interaction, client) {
        if (!hasModPermission(interaction.member)) {
            return interaction.reply({
                ...containerPayload(quickContainer('❌ Missing Permissions', "You don't have permission to warn members.")),
                ephemeral: true
            });
        }

        const targetMember = interaction.options.getMember('user');
        const reason = interaction.options.getString('reason');

        if (!targetMember) {
            return interaction.reply({
                ...containerPayload(quickContainer('❌ User Not Found', 'That user is not in this server.')),
                ephemeral: true
            });
        }

        await interaction.deferReply();

        const result = await performWarn({
            guild: interaction.guild,
            moderator: interaction.member,
            targetMember,
            reason,
            client
        });

        if (!result.ok) {
            return interaction.editReply(containerPayload(quickContainer('❌ Warn Failed', result.reason)));
        }

        return interaction.editReply(result.payload);
    }
};