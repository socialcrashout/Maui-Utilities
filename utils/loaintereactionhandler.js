const {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const config = require('../config');
const loaManager = require('./loaManager');
const { buildContainer } = require('./loaEmbeds');
const { formatDate } = require('./dateFormat');

/**
 * Call this from your existing interactionCreate event, before your
 * normal command-dispatch logic, e.g.:
 *
 *   const { handleLOAInteraction } = require('./utils/loaInteractionHandler');
 *
 *   client.on('interactionCreate', async (interaction) => {
 *     if (interaction.customId?.startsWith('loa_')) {
 *       return handleLOAInteraction(interaction);
 *     }
 *     // ...your existing slash-command handling
 *   });
 */
async function handleLOAInteraction(interaction) {
  if (interaction.isButton() && interaction.customId.startsWith('loa_approve_')) {
    return handleApprove(interaction);
  }
  if (interaction.isButton() && interaction.customId.startsWith('loa_decline_')) {
    return handleDeclineButton(interaction);
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('loa_decline_modal_')) {
    return handleDeclineModal(interaction);
  }
}

function isManager(interaction) {
  return interaction.member.roles.cache.has(config.LOA_MANAGER_ROLE_ID);
}

async function handleApprove(interaction) {
  if (!isManager(interaction)) {
    return interaction.reply({
      content: 'You do not have permission to review LOA requests.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const recordId = interaction.customId.replace('loa_approve_', '');
  const record = loaManager.getRecordById(recordId);

  if (!record || record.status !== 'pending') {
    return interaction.reply({
      content: 'This request is no longer pending.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const startTimestamp = Date.now();
  const endTimestamp = startTimestamp + record.durationMs;

  loaManager.approveLOA(record.id, {
    reviewedBy: interaction.user.id,
    startTimestamp,
    endTimestamp,
  });

  const targetMember = await interaction.guild.members.fetch(record.userId).catch(() => null);

  // Assign the LOA role
  if (targetMember) {
    try {
      const role = await interaction.guild.roles.fetch(config.LOA_ROLE_ID);
      if (role) await targetMember.roles.add(role);
    } catch (err) {
      console.error('[LOA] Failed to add LOA role:', err);
    }
  }

  // Update the review message in place (removes the buttons)
  const resultContainer = buildContainer([
    '## LOA Request Approved',
    `${interaction.user} approved this request.`,
    '---',
    `<@${record.userId}>`,
    `**Reason:** ${record.reason}`,
    `**Start Date:** ${formatDate(startTimestamp)}`,
    `**End Date:** ${formatDate(endTimestamp)}`,
  ]);
  await interaction.update({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });

  // DM the requester
  if (targetMember) {
    const dmContainer = buildContainer([
      '## LOA Approved',
      'Your Leave of Absence request has been approved.',
      '---',
      `**Reason:** ${record.reason}`,
      `**Start Date:** ${formatDate(startTimestamp)}`,
      `**End Date:** ${formatDate(endTimestamp)}`,
    ]);
    await targetMember.send({ components: [dmContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
  }

  // Inactivity log
  const logChannel = await interaction.guild.channels.fetch(config.LOG_CHANNEL_ID).catch(() => null);
  if (logChannel) {
    const logContainer = buildContainer([
      '## Inactivity Started',
      `<@${record.userId}> has started their Leave of Absence. Approved by ${interaction.user}.`,
      '---',
      `**Reason:** ${record.reason}`,
      `**Start Date:** ${formatDate(startTimestamp)}`,
      `**End Date:** ${formatDate(endTimestamp)}`,
      `**Record ID:** \`${record.id}\``,
    ]);
    await logChannel.send({ components: [logContainer], flags: MessageFlags.IsComponentsV2 });
  }
}

async function handleDeclineButton(interaction) {
  if (!isManager(interaction)) {
    return interaction.reply({
      content: 'You do not have permission to review LOA requests.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const recordId = interaction.customId.replace('loa_decline_', '');
  const record = loaManager.getRecordById(recordId);

  if (!record || record.status !== 'pending') {
    return interaction.reply({
      content: 'This request is no longer pending.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`loa_decline_modal_${recordId}`)
    .setTitle('Decline LOA Request');

  const reasonInput = new TextInputBuilder()
    .setCustomId('decline_reason')
    .setLabel('Reason for declining')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  await interaction.showModal(modal);
}

async function handleDeclineModal(interaction) {
  const recordId = interaction.customId.replace('loa_decline_modal_', '');
  const record = loaManager.getRecordById(recordId);

  if (!record || record.status !== 'pending') {
    return interaction.reply({
      content: 'This request is no longer pending.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const declineReason = interaction.fields.getTextInputValue('decline_reason');

  loaManager.declineLOA(record.id, {
    reviewedBy: interaction.user.id,
    declineReason,
  });

  // Update the original review message in place (removes the buttons)
  if (record.messageId && record.channelId) {
    const channel = await interaction.guild.channels.fetch(record.channelId).catch(() => null);
    const message = channel ? await channel.messages.fetch(record.messageId).catch(() => null) : null;
    if (message) {
      const resultContainer = buildContainer([
        '## LOA Request Declined',
        `${interaction.user} declined this request.`,
        '---',
        `<@${record.userId}>`,
        `**Reason for Request:** ${record.reason}`,
        `**Decline Reason:** ${declineReason}`,
      ]);
      await message.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
  }

  await interaction.reply({ content: 'Request declined.', flags: MessageFlags.Ephemeral });

  // DM the requester
  const targetMember = await interaction.guild.members.fetch(record.userId).catch(() => null);
  if (targetMember) {
    const dmContainer = buildContainer([
      '## LOA Declined',
      'Your Leave of Absence request has been declined.',
      '---',
      `**Reason for Request:** ${record.reason}`,
      `**Decline Reason:** ${declineReason}`,
    ]);
    await targetMember.send({ components: [dmContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
  }

  // Log
  const logChannel = await interaction.guild.channels.fetch(config.LOG_CHANNEL_ID).catch(() => null);
  if (logChannel) {
    const logContainer = buildContainer([
      '## LOA Request Declined',
      `<@${record.userId}>'s Leave of Absence request was declined by ${interaction.user}.`,
      '---',
      `**Decline Reason:** ${declineReason}`,
      `**Record ID:** \`${record.id}\``,
    ]);
    await logChannel.send({ components: [logContainer], flags: MessageFlags.IsComponentsV2 });
  }
}

module.exports = { handleLOAInteraction };