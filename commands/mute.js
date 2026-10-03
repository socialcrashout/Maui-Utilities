const { SlashCommandBuilder } = require('discord.js');
const { hasModPermission } = require('../utils/permissions');
const { performMute } = require('../utils/modCore');
const { parseDuration } = require('../utils/duration');
const { quickContainer, containerPayload } = require('../utils/modContainer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Timeout a member for a set duration')
        .addUserOption(opt => opt.setName('user').setDescription('Member to mute').setRequired(true))
        .addStringOption(opt => opt.setName('duration').setDescription('e.g. 10m, 2h, 1d, 1w').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the mute').setRequired(false)),

    async execute(interaction, client) {
        if (!hasModPermission(interaction.member)) {
            return interaction.reply({
                ...containerPayload(quickContainer('❌ Missing Permissions', "You don't have permission to mute members.")),
                ephemeral: true
            });
        }

        const targetMember = interaction.options.getMember('user');
        const durationInput = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (!targetMember) {
            return interaction.reply({
                ...containerPayload(quickContainer('❌ User Not Found', 'That user is not in this server.')),
                ephemeral: true
            });
        }

        const ms = parseDuration(durationInput);
        if (!ms) {
            return interaction.reply({
                ...containerPayload(quickContainer('❌ Invalid Duration', 'Use a format like `10m`, `2h`, `1d`, or `1w` (max 28 days).')),
                ephemeral: true
            });
        }

        await interaction.deferReply();

        const result = await performMute({
            guild: interaction.guild,
            moderator: interaction.member,
            targetMember,
            ms,
            reason,
            client
        });

        if (!result.ok) {
            return interaction.editReply(containerPayload(quickContainer('❌ Mute Failed', result.reason)));
        }

        return interaction.editReply(result.payload);
    }
};