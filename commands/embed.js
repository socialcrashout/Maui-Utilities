const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

const isAttachmentUrl = value => typeof value === 'string' && /^attachment:\/\//i.test(value);

function sanitizePayload(payload) {
  const changes = { removedMedia: 0, fixedButtons: 0 };

  function clean(value) {
    if (Array.isArray(value)) return value.map(clean).filter(item => item !== null);
    if (!value || typeof value !== 'object') return value;

    // Discohook JSON can contain references to files that were uploaded to
    // Discohook, but those files are not attached to this Discord request.
    if (value.media && isAttachmentUrl(value.media.url)) {
      changes.removedMedia++;
      return null;
    }
    if (value.file && isAttachmentUrl(value.file.url)) {
      changes.removedMedia++;
      return null;
    }

    if (value.type === 2 && value.custom_id && value.url) {
      // Link buttons use a URL; interactive buttons use a custom ID. Discord
      // rejects a button that has both, so keep the option indicated by style.
      if (value.style === 5) delete value.custom_id;
      else delete value.url;
      changes.fixedButtons++;
    }

    // Attachment URLs are also invalid in embed image/thumbnail fields here.
    for (const field of ['image', 'thumbnail']) {
      if (value[field] && isAttachmentUrl(value[field].url)) {
        delete value[field];
        changes.removedMedia++;
      }
    }

    for (const [key, child] of Object.entries(value)) {
      const cleaned = clean(child);
      if (cleaned === null) delete value[key];
      else value[key] = cleaned;
    }

    // An empty media gallery is invalid; remove it after its unattached images
    // have been filtered out.
    if (value.type === 12 && Array.isArray(value.items) && value.items.length === 0) return null;
    // A link button whose URL is an unavailable local attachment cannot work.
    if (value.type === 2 && value.style === 5 && isAttachmentUrl(value.url)) {
      changes.removedMedia++;
      return null;
    }

    return value;
  }

  return { payload: clean(payload), changes };
}

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

    // This command accepts JSON only, not the image files referenced by the
    // payload. Drop stale attachment references and repair invalid URL buttons.
    delete payload.attachments;
    const sanitized = sanitizePayload(payload);
    payload = sanitized.payload;

    // 4. Send it via a raw REST call so Components V2 / flags come through
    //    untouched (discord.js's builders don't fully support V2 yet)
    try {
      await interaction.client.rest.post(
        `/channels/${interaction.channelId}/messages`,
        { body: payload }
      );
      const notes = [];
      if (sanitized.changes.removedMedia) notes.push(`${sanitized.changes.removedMedia} unavailable attachment image(s) omitted`);
      if (sanitized.changes.fixedButtons) notes.push(`${sanitized.changes.fixedButtons} button(s) repaired`);
      await interaction.editReply(notes.length ? `Sent ✅ (${notes.join('; ')}).` : 'Sent ✅');
    } catch (err) {
      console.error('Embed payload rejected:', err.rawError || err);
      const details = err.rawError?.errors
        ? JSON.stringify(err.rawError.errors).slice(0, 1200)
        : err.message;
      await interaction.editReply(
        `Discord could not send that message: ${details}\n` +
        `If the JSON references local images, upload those files separately or replace them with public image URLs.`
      );
    }
  },
};
