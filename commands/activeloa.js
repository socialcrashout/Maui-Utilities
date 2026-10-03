const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../config/config');
const loaManager = require('../utils/loaManager');
const { buildContainer } = require('../utils/loaEmbeds');
const { formatDate } = require('../utils/dataformat');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activeloa')
    .setDescription('View everyone currently on LOA'),

  async execute(interaction) {
    // Permission check — only LOA managers can view the active list
    if (!interaction.member.roles.cache.has(config.LOA_MANAGER_ROLE_ID)) {
      return interaction.reply({
        content: 'You do not have permission to use this command.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const active = loaManager.getActiveLOAs(interaction.guildId);

    if (active.length === 0) {
      return interaction.reply({
        content: 'No one is currently on LOA.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const lines = ['## Active LOAs', `Currently ${active.length} member(s) on LOA.`, '---'];

    active.forEach((r, i) => {
      lines.push(
        `<@${r.userId}>\n**Reason:** ${r.reason}\n**Start Date:** ${formatDate(
          r.startTimestamp
        )}\n**End Date:** ${formatDate(r.endTimestamp)}`
      );
      if (i < active.length - 1) lines.push('---');
    });

    const container = buildContainer(lines);

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};