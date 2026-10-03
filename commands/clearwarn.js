const { SlashCommandBuilder } = require('discord.js');
const { hasModPermission } = require('../utils/permissions');
const { performClearWarn } = require('../utils/modCore');
const { quickContainer, containerPayload } = require('../utils/modContainer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clearwarn')
        .setDescription('Clear a single warning from a member')
        .addUserOption(opt => opt.setName('user').setDescription('Member whose warning to clear').setRequired(true))
        .addStringOption(opt =>
            opt.setName('warning')
                .setDescription('Warning ID or list number from /modlogs')
                .setRequired(true)
        ),

    async execute(interaction, client) {
        if (!hasModPermission(interaction.member)) {
            return interaction.reply({
                ...containerPayload(quickContainer('❌ Missing Permissions', "You don't have permission to clear warnings.")),
                ephemeral: true
            });
        }

        const targetUser = interaction.options.getUser('user');
        const ref = interaction.options.getString('warning').trim();

        await interaction.deferReply();

        const result = await performClearWarn({
            guild: interaction.guild,
            moderator: interaction.member,
            targetUser,
            ref,
            client
        });

        if (!result.ok) {
            return interaction.editReply(containerPayload(quickContainer('❌ Clear Failed', result.reason)));
        }

        return interaction.editReply(result.payload);
    }
};