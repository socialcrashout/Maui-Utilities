const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../config/config');
const loaManager = require('../utils/loaManager');
const { buildContainer } = require('../utils/loaEmbeds');
const { formatDate } = require('../utils/dataformat');

const STATUS_LABELS = {
  pending: 'Pending Review',
  active: 'Active',
  ended_early: 'Ended Early',
  expired: 'Completed',
  declined: 'Declined',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loahistory')
    .setDescription("View a member's LOA history")
    .addUserOption(opt =>
      opt.setName('member').setDescription('The member to look up').setRequired(true)
    ),

  async execute(interaction) {
    // Permission check — only LOA managers can view history
    if (!interaction.member.roles.cache.has(config.LOA_MANAGER_ROLE_ID)) {
      return interaction.reply({
        content: 'You do not have permission to use this command.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const targetUser = interaction.options.getUser('member');
    const history = loaManager.getUserHistory(interaction.guildId, targetUser.id);

    if (history.length === 0) {
      return interaction.reply({
        content: `${targetUser} has no LOA history.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const shown = history.slice(0, 10);
    const lines = ['## LOA History', `${targetUser} — ${history.length} record(s) on file`, '---'];

    shown.forEach((r, i) => {
      const statusLabel = STATUS_LABELS[r.status] || r.status;
      const entryLines = [`**Status:** ${statusLabel}`, `**Reason:** ${r.reason}`];

      if (r.status === 'declined') {
        entryLines.push(`**Decline Reason:** ${r.declineReason}`);
      } else if (r.startTimestamp) {
        entryLines.push(`**Start Date:** ${formatDate(r.startTimestamp)}`);
        entryLines.push(
          r.actualEndTimestamp
            ? `**End Date:** ${formatDate(r.actualEndTimestamp)}`
            : `**Expected End:** ${formatDate(r.endTimestamp)}`
        );
      }

      lines.push(entryLines.join('\n'));
      if (i < shown.length - 1) lines.push('---');
    });

    const container = buildContainer(lines);

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};