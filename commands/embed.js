const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Send a raw embed/message JSON payload (e.g. from Discohook) to this channel')
    .addStringOption(option =>
      option
        .setName('json')
        .setDescription('Paste the Discohook "Message Contents (JSON)" here')
        .setRequired(false)
    )
    .addAttachmentOption(option =>
      option
        .setName('file')
        .setDescription('Or upload a .json file instead (for long payloads)')
        .setRequired(false)
    )
    // remove/change this if you want anyone to be able to use it
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const jsonOption = interaction.options.getString('json');
    const fileOption = interaction.options.getAttachment('file');

    if (!jsonOption && !fileOption) {
      return interaction.reply({
        content: 'Give me either the `json` text or a `.json` file to send.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // 1. Get the raw JSON text, either from the option or the uploaded file
    let rawText = jsonOption;
    if (!rawText && fileOption) {
      try {
        const res = await fetch(fileOption.url);
        rawText = await res.text();
      } catch (err) {
        return interaction.editReply(`Couldn't download that file: ${err.message}`);
      }
    }

    // 2. Parse it
    let payload;
    try {
      payload = JSON.parse(rawText);
    } catch (err) {
      return interaction.editReply(
        `That's not valid JSON: ${err.message}\n` +
        `Tip: use Discohook's "JSON Editor" or the code icon (</>) to grab the exact payload.`
      );
    }

    // 3. Strip fields Discord's message-create endpoint doesn't accept
    //    (Discohook sometimes includes these for its own UI/backup purposes)
    delete payload.webhook_id;
    delete payload.id;
    delete payload.channel_id;
    delete payload.timestamp;
    delete payload.edited_timestamp;
    delete payload.author;
    delete payload.type;

    // Discohook's export includes stale `attachments` metadata pointing at
    // files that no longer exist server-side. Sending it as-is makes
    // Discord reject the request with ATTACHMENT_NOT_FOUND, so drop it.
    delete payload.attachments;

    // 4. Send it via a raw REST call so Components V2 / flags come through
    //    untouched (discord.js's builders don't fully support V2 yet)
    try {
      await interaction.client.rest.post(
        `/channels/${interaction.channelId}/messages`,
        { body: payload }
      );
      await interaction.editReply('Sent ✅');
    } catch (err) {
      console.error(err);
      await interaction.editReply(
        `Discord rejected that payload: ${err.message}\n` +
        `Double-check it's the full message JSON (not just an embed object).`
      );
    }
  },
};