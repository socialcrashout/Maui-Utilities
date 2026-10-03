const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../config/config');
const loaManager = require('../utils/loaManager');
const { buildContainer } = require('../utils/loaEmbeds');
const { formatDate } = require('../utils/dataformat');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('endloa')
    .setDescription("End a staff member's LOA early")
    .addUserOption(opt =>
      opt.setName('member').setDescription('The staff member to end LOA for').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason').setDescription('Reason for ending it early').setRequired(false)
    ),

  async execute(interaction) {
    const executor = interaction.member;

    // Permission check — only LOA managers can end others' LOAs
    if (!executor.roles.cache.has(config.LOA_MANAGER_ROLE_ID)) {
      return interaction.reply({
        content: 'You do not have permission to use this command.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const targetUser = interaction.options.getUser('member');
    const endReason = interaction.options.getString('reason') || 'No reason provided';

    const record = loaManager.getActiveLOA(interaction.guildId, targetUser.id);
    if (!record) {
      return interaction.reply({
        content: `${targetUser} does not have an active LOA.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Remove the LOA role
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (targetMember) {
      try {
        const role = await interaction.guild.roles.fetch(config.LOA_ROLE_ID);
        if (role) await targetMember.roles.remove(role);
      } catch (err) {
        console.error('[LOA] Failed to remove LOA role:', err);
      }
    }

    const updated = loaManager.endLOA(record.id, {
      endedBy: executor.id,
      endReason,
      status: 'ended_early',
    });

    const confirmContainer = buildContainer([
      '## LOA Ended',
      `${targetUser}'s LOA has been ended early.`,
      '---',
      `**Reason:** ${endReason}`,
    ]);

    await interaction.reply({
      components: [confirmContainer],
      flags: MessageFlags.IsComponentsV2,
    });

    // DM the affected member
    if (targetMember) {
      const dmContainer = buildContainer([
        '## LOA Ended Early',
        'Your Leave of Absence has been ended early by staff.',
        '---',
        `**Reason:** ${endReason}`,
      ]);
      await targetMember.send({ components: [dmContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }

    // Inactivity log
    const logChannel = await interaction.guild.channels.fetch(config.LOG_CHANNEL_ID).catch(() => null);
    if (logChannel) {
      const logContainer = buildContainer([
        '## Inactivity Ended (Early)',
        `${targetUser}'s Leave of Absence was ended early by ${executor}, and the LOA role was removed.`,
        '---',
        `**Original Reason:** ${updated.reason}`,
        `**End Reason:** ${endReason}`,
        `**Start Date:** ${formatDate(updated.startTimestamp)}`,
        `**End Date:** ${formatDate(updated.actualEndTimestamp)}`,
        `**Record ID:** \`${updated.id}\``,
      ]);
      await logChannel.send({
        components: [logContainer],
        flags: MessageFlags.IsComponentsV2,
      });
    }
  },
};