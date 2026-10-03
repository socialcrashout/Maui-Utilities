const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../config/config');
const loaManager = require('../utils/loaManager');
const { parseDuration, formatDuration } = require('../utils/duration');
const { formatDate } = require('../utils/dataformat');
const { buildReviewContainer } = require('../utils/loaEmbeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('requestloa')
    .setDescription('Request a Leave of Absence')
    .addStringOption(opt =>
      opt
        .setName('duration')
        .setDescription('How long you need (e.g. 3d, 12h, 1w, 45m)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason').setDescription('Reason for your LOA').setRequired(true)
    ),

  async execute(interaction) {
    const member = interaction.member;

    // Permission check — only staff can request an LOA
    if (!member.roles.cache.has(config.STAFF_ROLE_ID)) {
      return interaction.reply({
        content: 'You do not have permission to use this command.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Prevent duplicate requests/LOAs
    if (loaManager.getActiveOrPendingLOA(interaction.guildId, member.id)) {
      return interaction.reply({
        content: 'You already have a pending request or an active LOA.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const durationInput = interaction.options.getString('duration');
    const reason = interaction.options.getString('reason');
    const durationMs = parseDuration(durationInput, { cap: false });

    if (!durationMs) {
      return interaction.reply({
        content: 'Invalid duration format. Use something like `3d`, `12h`, `1w`, or `30m`.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const record = loaManager.createPendingLOA({
      guildId: interaction.guildId,
      userId: member.id,
      reason,
      durationMs,
    });

    await interaction.reply({
      content: 'Your LOA request has been submitted for review.',
      flags: MessageFlags.Ephemeral,
    });

    // Post to the review channel with Approve/Decline buttons
    const reviewChannel = await interaction.guild.channels
      .fetch(config.LOA_REQUEST_CHANNEL_ID)
      .catch(() => null);

    if (reviewChannel) {
      const reviewContainer = buildReviewContainer(
        [
          '## New LOA Request',
          `${member} is requesting a Leave of Absence.`,
          '---',
          `**Duration:** ${formatDuration(durationMs)}`,
          `**Reason:** ${reason}`,
          `**Requested:** ${formatDate(record.requestedAt)}`,
        ],
        record.id
      );

      const sent = await reviewChannel.send({
        components: [reviewContainer],
        flags: MessageFlags.IsComponentsV2,
      });

      loaManager.setMessageRef(record.id, sent.id, sent.channelId);
    } else {
      console.error('[LOA] LOA_REQUEST_CHANNEL_ID is not set or invalid — request was saved but not posted for review.');
    }
  },
};