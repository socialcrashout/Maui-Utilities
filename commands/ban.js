const { SlashCommandBuilder } = require('discord.js');
const { hasModPermission } = require('../utils/permissions');
const { performBan } = require('../utils/modCore');
const { quickContainer, containerPayload } = require('../utils/modContainer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a member from the server')
        .addUserOption(opt => opt.setName('user').setDescription('Member to ban').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the ban').setRequired(false)),

    async execute(interaction, client) {
        if (!hasModPermission(interaction.member)) {
            return interaction.reply({
                ...containerPayload(quickContainer('❌ Missing Permissions', "You don't have permission to ban members.")),
                ephemeral: true
            });
        }

        const targetUser = interaction.options.getUser('user');
        const targetMember = interaction.options.getMember('user'); // may be null if not in guild
        const reason = interaction.options.getString('reason') || 'No reason provided';

        await interaction.deferReply();

        const result = await performBan({
            guild: interaction.guild,
            moderator: interaction.member,
            targetMember,
            targetUser,
            reason,
            client
        });

        if (!result.ok) {
            return interaction.editReply(containerPayload(quickContainer('❌ Ban Failed', result.reason)));
        }

        return interaction.editReply(result.payload);
    }
};