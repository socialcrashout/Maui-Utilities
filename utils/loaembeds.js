const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

/**
 * Builds a Components V2 Container from an array of lines.
 * Pass the string '---' anywhere in the array to insert a separator.
 * No accent color is set, per the requested plain/no-color style.
 */
function buildContainer(lines) {
  const container = new ContainerBuilder();

  for (const line of lines) {
    if (line === '---') {
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
      );
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(line));
    }
  }

  return container;
}

/**
 * Same as buildContainer, but with an Approve/Decline button row
 * attached — used for the pending-request review message.
 */
function buildReviewContainer(lines, recordId) {
  const container = buildContainer(lines);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`loa_approve_${recordId}`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`loa_decline_${recordId}`)
      .setLabel('Decline')
      .setStyle(ButtonStyle.Danger)
  );

  container.addActionRowComponents(row);
  return container;
}

module.exports = { buildContainer, buildReviewContainer };