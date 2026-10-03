const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { buildModContainer, containerPayload } = require('../utils/modcontainer');

function feedbackPayload(heading, description) {
  return containerPayload(buildModContainer({ heading, description }), {
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  });
}

const isAttachmentUrl = value => typeof value === 'string' && /^attachment:\/\//i.test(value);

function attachmentName(url) {
  return isAttachmentUrl(url) ? decodeURIComponent(url.slice('attachment://'.length)) : null;
}

function sanitizePayload(payload, availableAttachments = new Set()) {
  const changes = { removedMedia: 0, fixedButtons: 0 };
  const hasAttachment = url => {
    const name = attachmentName(url);
    return name !== null && availableAttachments.has(name);
  };

  function clean(value) {
    if (Array.isArray(value)) return value.map(clean).filter(item => item !== null);
    if (!value || typeof value !== 'object') return value;

    // Keep attachment references only when the matching image is attached to
    // this Discord request.
    if (value.media && isAttachmentUrl(value.media.url) && !hasAttachment(value.media.url)) {
      changes.removedMedia++;
      return null;
    }
    if (value.file && isAttachmentUrl(value.file.url) && !hasAttachment(value.file.url)) {
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

    // Remove embed images only when their attachment was not uploaded here.
    for (const field of ['image', 'thumbnail']) {
      if (value[field] && isAttachmentUrl(value[field].url) && !hasAttachment(value[field].url)) {
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

function collectAttachmentReferences(value, references = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectAttachmentReferences(item, references);
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) collectAttachmentReferences(child, references);
  } else if (isAttachmentUrl(value)) {
    references.add(attachmentName(value));
  }
  return [...references];
}

function replaceAttachmentReferences(value, replacements) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => { value[index] = replaceAttachmentReferences(item, replacements); });
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      value[key] = replaceAttachmentReferences(child, replacements);
    }
  } else if (isAttachmentUrl(value)) {
    const replacement = replacements.get(attachmentName(value));
    return replacement ? `attachment://${replacement}` : value;
  }
  return value;
}

function getImageOptions(interaction) {
  const images = [];
  for (let i = 1; i <= 10; i++) {
    const attachment = interaction.options.getAttachment(`image${i}`);
    if (attachment) images.push(attachment);
  }
  return images;
}

async function prepareImageFiles(payload, interaction) {
  const references = collectAttachmentReferences(payload);
  const uploadedImages = getImageOptions(interaction);
  const replacements = new Map();
  const used = new Set();
  const filesByName = new Map();

  // Match explicit filenames first so earlier unmatched references do not
  // accidentally consume an image intended for a later exact match.
  for (let i = 0; i < references.length; i++) {
    const reference = references[i];
    const image = uploadedImages.find(candidate =>
      !used.has(candidate.id) && candidate.name.toLowerCase() === reference.toLowerCase()
    );
    if (!image) continue;

    used.add(image.id);
    const safeName = image.name.replace(/[^a-zA-Z0-9_.-]/g, '_') || `image-${i + 1}`;
    let uniqueName = safeName;
    let suffix = 2;
    while (filesByName.has(uniqueName)) {
      const dot = safeName.lastIndexOf('.');
      uniqueName = dot > 0
        ? `${safeName.slice(0, dot)}-${suffix}${safeName.slice(dot)}`
        : `${safeName}-${suffix}`;
      suffix++;
    }

    replacements.set(reference, uniqueName);
    filesByName.set(uniqueName, image);
  }

  for (let i = 0; i < references.length; i++) {
    const reference = references[i];
    if (replacements.has(reference)) continue;
    const image = uploadedImages.find(candidate => !used.has(candidate.id));
    if (!image) continue;

    used.add(image.id);
    const safeName = image.name.replace(/[^a-zA-Z0-9_.-]/g, '_') || `image-${i + 1}`;
    let uniqueName = safeName;
    let suffix = 2;
    while (filesByName.has(uniqueName)) {
      const dot = safeName.lastIndexOf('.');
      uniqueName = dot > 0
        ? `${safeName.slice(0, dot)}-${suffix}${safeName.slice(dot)}`
        : `${safeName}-${suffix}`;
      suffix++;
    }

    replacements.set(reference, uniqueName);
    filesByName.set(uniqueName, image);
  }

  replaceAttachmentReferences(payload, replacements);
  const files = [];
  for (const [name, attachment] of filesByName) {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error(`Could not download image “${attachment.name}” (HTTP ${response.status}).`);
    files.push({
      name,
      data: Buffer.from(await response.arrayBuffer()),
      contentType: attachment.contentType || undefined,
    });
  }

  return { files, availableNames: new Set(files.map(file => file.name)), unusedCount: uploadedImages.length - used.size };
}

const data = new SlashCommandBuilder()
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
  );

for (let i = 1; i <= 10; i++) {
  data.addAttachmentOption(option => option
    .setName(`image${i}`)
    .setDescription(`Optional image file #${i} referenced by attachment:// in the JSON`)
    .setRequired(false)
  );
}

module.exports = {
  data: data.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const jsonOption = interaction.options.getString('json');
    const fileOption = interaction.options.getAttachment('file');

    if (!jsonOption && !fileOption) {
      return interaction.reply(feedbackPayload(
        '📨 Embed content needed',
        'Paste your message JSON or attach a `.json` file. For attachment:// images, add the image files in the image1, image2, and later options.'
      ));
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });

    // 1. Get the raw JSON text, either from the option or the uploaded file
    let rawText = jsonOption;
    if (!rawText && fileOption) {
      try {
        const res = await fetch(fileOption.url);
        if (!res.ok) throw new Error(`Download returned HTTP ${res.status}`);
        rawText = await res.text();
      } catch (err) {
        return interaction.editReply(feedbackPayload('⚠️ File download failed', `I couldn't download that JSON file.\n\n${err.message}`));
      }
    }

    // 2. Parse it
    let payload;
    try {
      payload = JSON.parse(rawText);
    } catch (err) {
      return interaction.editReply(feedbackPayload(
        '❌ Invalid JSON',
        `The message could not be parsed.\n\n${err.message}\n\n💡 Use Discohook's JSON Editor or code icon (</>) to copy the payload.`
      ));
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

    // Drop stale attachment metadata from Discohook; we'll add metadata for the
    // image files uploaded with this command after resolving their references.
    delete payload.attachments;

    // 4. Resolve attachment:// references against the image options and send
    //    multipart files while keeping Components V2 JSON untouched.
    try {
      const imageData = await prepareImageFiles(payload, interaction);
      const sanitized = sanitizePayload(payload, imageData.availableNames);
      payload = sanitized.payload;
      if (imageData.files.length) {
        payload.attachments = imageData.files.map((file, index) => ({ id: String(index), filename: file.name }));
      }

      await interaction.client.rest.post(
        `/channels/${interaction.channelId}/messages`,
        { body: payload, files: imageData.files }
      );
      const notes = [];
      if (sanitized.changes.removedMedia) notes.push(`🖼️ ${sanitized.changes.removedMedia} unavailable attachment image(s) omitted`);
      if (sanitized.changes.fixedButtons) notes.push(`🔗 ${sanitized.changes.fixedButtons} button(s) repaired`);
      if (imageData.unusedCount) notes.push(`📎 ${imageData.unusedCount} uploaded image(s) were not referenced in the JSON`);
      await interaction.editReply(feedbackPayload(
        '✅ Message posted',
        notes.length ? `Your message was posted.\n\n${notes.join('\n')}` : 'Your message was posted successfully.'
      ));
    } catch (err) {
      console.error('Embed payload rejected:', err.rawError || err);
      const details = err.rawError?.errors
        ? JSON.stringify(err.rawError.errors).slice(0, 1200)
        : err.message;
      await interaction.editReply(feedbackPayload(
        '❌ Message could not be posted',
        `Discord rejected the message:\n\n${details}\n\n🖼️ For each attachment://filename in the JSON, add the matching image with an image1–image10 option, or use a public image URL.`
      ));
    }
  },
};
