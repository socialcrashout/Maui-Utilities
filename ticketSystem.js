// Ticket system settings and copy live here so they are easy to customize.
// Add Discord role/channel IDs below before using the system.
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ContainerBuilder,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
    Events,
    AttachmentBuilder,
    FileBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
} = require('discord.js');

const SETTINGS = {
    prefix: process.env.PREFIX || '-',
    // The parent channel category where every ticket channel is created.
    supportCategoryId: '1474142910101586024',
    // Optional channel where closed ticket transcripts are posted.
    transcriptChannelId: '1484312804830740520',
    supportTeamRoleId: '1556041164031787098',
    supportAdminRoleId: '1556041271490121768',
    panelTitle: '<:maui:1556034121271214141> | Maui Support',
    panelDescription: `At **Maui**, we strive to provide our community with an organized and reliable support system where all questions, concerns, and requests can be handled efficiently. Before opening a ticket, please take a moment to review the available support categories and select the one that best matches your needs.

Please use the ticket system appropriately and provide accurate information so our team can assist you as efficiently as possible. Misuse of the ticket system, including unnecessary or inappropriate tickets, may result in disciplinary action.

**<:summerkite:1511401136693710898> Support Categories**

> **General Support** — For general questions, assistance, community concerns, or anything that does not fall under another support category.

> **Leadership Support** — For matters requiring assistance from members of the Leadership Team or concerns that need leadership attention.

> **Human Resources Support** — For staff-related concerns, management matters, reports, leave requests, or other Human Resources inquiries.

> **Development Support** — For development-related questions, game issues, bugs, suggestions, or concerns regarding our Development Team.

> **Public Relations Department Support** — For partnership inquiries, affiliate matters, public relations concerns, or other requests involving the Public Relations Department.

Please select the **most appropriate category** from the dropdown below. Selecting the correct option will help ensure your ticket reaches the appropriate team and receives the attention it requires.`,
    panelButtonPlaceholder: 'Choose a support category',
    ticketTitle: 'Support ticket',
    ticketWelcome: 'Thanks for contacting the team. Please share any extra details here and a team member will help shortly.',
    bannerUrl: 'https://yumi.onl/api/files/6ac166de9c1d0ced2e4001f2/raw',
    transcriptTitle: 'Ticket transcript',
    openingQuestions: [
        { id: 'reason', label: 'Why are you opening a ticket?', placeholder: 'Describe what you need help with', required: true, style: TextInputStyle.Paragraph },
        { id: 'details', label: 'Extra details (optional)', placeholder: 'Anything else we should know?', required: false, style: TextInputStyle.Paragraph },
    ],
    closeQuestion: { id: 'close_reason', label: 'Closing reason', placeholder: 'Briefly explain why this ticket is closing', required: true },
    categories: [
        { key: 'general', label: 'General Support', description: 'Questions, help, or general assistance.', emoji: '💬', pingRoleId: '' },
        { key: 'leadership', label: 'Leadership Support', description: 'Private matters for the leadership team.', emoji: '🛡️', pingRoleId: '' },
        { key: 'hr', label: 'Human Resources Support', description: 'Staff-related concerns, management matters, reports, leave requests, and HR inquiries.', emoji: '👥', pingRoleId: '' },
        { key: 'dev', label: 'Development Support', description: 'Development questions, game issues, bugs, and suggestions.', emoji: '🛠️', pingRoleId: '' },
        { key: 'prd', label: 'Public Relations Department Support', description: 'Partnership inquiries, affiliate matters, and public relations concerns.', emoji: '📋', pingRoleId: '' },
    ],
    // Change labels and emoji freely. Button ids are internal and should stay as-is.
    buttons: { claim: 'Claim', unclaim: 'Unclaim', rename: 'Rename', escalate: 'Escalate', close: 'Close' },
};

const TICKET_PREFIX = 'maui-ticket';
const isId = value => /^\d{17,20}$/.test(String(value || ''));
const safeText = (value, max = 1000) => String(value || '').replace(/[<>]/g, '').slice(0, max) || 'Not provided';
const slug = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'ticket';

function ticketContainer(title, lines, includeBanner = false) {
    const box = new ContainerBuilder();
    if (includeBanner && SETTINGS.bannerUrl) {
        box.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(SETTINGS.bannerUrl)
        ));
        box.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    }
    box.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${lines.join('\n')}`));
    return box;
}

function ticketPayload(container, components = [], extra = {}) {
    for (const component of components) container.addActionRowComponents(component);
    return { flags: MessageFlags.IsComponentsV2, components: [container], ...extra };
}

function stateFromChannel(channel) {
    const match = String(channel.topic || '').match(/^maui-ticket\|([^|]+)\|([^|]+)\|([^|]*)\|([^|]+)$/);
    if (!match) return null;
    return { ownerId: match[1], categoryKey: match[2], claimerId: match[3] || null, openedAt: Number(match[4]) || Date.now() };
}

function topicFor(state) {
    return `${TICKET_PREFIX}|${state.ownerId}|${state.categoryKey}|${state.claimerId || ''}|${state.openedAt}`.slice(0, 1024);
}

function categoryFor(key) { return SETTINGS.categories.find(category => category.key === key); }

function isSupportAdmin(member) {
    return member?.permissions?.has(PermissionFlagsBits.Administrator) ||
        (isId(SETTINGS.supportAdminRoleId) && member?.roles?.cache?.has(SETTINGS.supportAdminRoleId));
}

function canManage(member) {
    return isSupportAdmin(member) ||
        (isId(SETTINGS.supportTeamRoleId) && member?.roles?.cache?.has(SETTINGS.supportTeamRoleId)) ||
        SETTINGS.categories.some(category => isId(category.pingRoleId) && member?.roles?.cache?.has(category.pingRoleId));
}

function canUseSupportButtons(member) {
    return [SETTINGS.supportTeamRoleId, SETTINGS.supportAdminRoleId]
        .some(roleId => isId(roleId) && member?.roles?.cache?.has(roleId));
}

async function applyStaffTypingPolicy(channel, state) {
    const category = categoryFor(state.categoryKey);
    const adminRoleId = SETTINGS.supportAdminRoleId;
    const staffRoleIds = new Set([SETTINGS.supportTeamRoleId, adminRoleId, category?.pingRoleId].filter(isId));
    // Everyone else stays read-only; explicit opener, claimer, and Support Admin grants override this.
    await channel.permissionOverwrites.edit(channel.guild.roles.everyone.id, {
        ViewChannel: false,
        ReadMessageHistory: false,
        SendMessages: false,
    });
    for (const roleId of staffRoleIds) {
        await channel.permissionOverwrites.edit(roleId, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: roleId === adminRoleId ? true : null,
        });
    }
}

async function syncOpenTicketPermissions(client) {
    for (const guild of client.guilds.cache.values()) {
        for (const channel of guild.channels.cache.values()) {
            const state = stateFromChannel(channel);
            if (!state || channel.type !== ChannelType.GuildText) continue;
            await applyStaffTypingPolicy(channel, state);
            await channel.permissionOverwrites.edit(state.ownerId, {
                ViewChannel: true, ReadMessageHistory: true, SendMessages: true,
            });
            if (state.claimerId) {
                await channel.permissionOverwrites.edit(state.claimerId, {
                    ViewChannel: true, ReadMessageHistory: true, SendMessages: true,
                });
            }
        }
    }
}

function ticketButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('maui:ticket:claim').setLabel(SETTINGS.buttons.claim).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('maui:ticket:unclaim').setLabel(SETTINGS.buttons.unclaim).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('maui:ticket:rename').setLabel(SETTINGS.buttons.rename).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('maui:ticket:escalate').setLabel(SETTINGS.buttons.escalate).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('maui:ticket:close').setLabel(SETTINGS.buttons.close).setStyle(ButtonStyle.Danger),
    );
}

function claimStatusContainer(claimed, userId) {
    return ticketContainer(claimed ? '🙋 Ticket Claimed' : '↩️ Ticket Unclaimed', [
        claimed ? `**Claimed by:** <@${userId}>` : `**Unclaimed by:** <@${userId}>`,
        claimed ? 'The ticket opener and assigned claimer can chat here. Other support roles can view the ticket.' : 'The ticket opener can continue chatting. Support roles remain view-only until someone claims it.',
    ]);
}

function escalationContainer(state) {
    const roleId = SETTINGS.supportAdminRoleId;
    const pings = [isId(roleId) ? `<@&${roleId}>` : '', `<@${state.ownerId}>`].filter(Boolean).join(' - ');
    return ticketContainer('<:maui:1556034121271214141> **Ticket Escalated**', [
        `-# ${pings}`,
        'This ticket has been **escalated to the Leadership Team** for further assistance. Please remain patient while a member of Leadership reviews your request.',
        '',
        'Someone will be with you **shortly** to assist you further. In the meantime, please avoid sending unnecessary messages, as this may delay the review of your ticket.',
        '',
        'Thank you for your patience and understanding!',
    ]);
}

function escalationMentions(state) {
    return {
        roles: isId(SETTINGS.supportAdminRoleId) ? [SETTINGS.supportAdminRoleId] : [],
        users: [...new Set([state.ownerId].filter(isId))],
    };
}

async function createPanel(message) {
    if (!isId(SETTINGS.supportCategoryId)) return message.reply('Set `supportCategoryId` near the top of `ticketSystem.js` first.');
    const select = new StringSelectMenuBuilder()
        .setCustomId('maui:ticket:category')
        .setPlaceholder(SETTINGS.panelButtonPlaceholder)
        .addOptions(SETTINGS.categories.map(category => ({
            label: category.label.slice(0, 100), description: category.description.slice(0, 100), value: category.key,
            ...(category.emoji ? { emoji: category.emoji } : {}),
        })));
    const container = ticketContainer(SETTINGS.panelTitle, [SETTINGS.panelDescription], true);
    await message.channel.send(ticketPayload(container, [new ActionRowBuilder().addComponents(select)], {
        allowedMentions: { parse: [] },
    }));
    await message.reply('Support panel posted.');
}

async function openTicket(interaction, category, answers) {
    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: 'Tickets can only be opened in a server.', flags: MessageFlags.Ephemeral });
    if (!isId(SETTINGS.supportCategoryId)) return interaction.reply({ content: 'The support channel category ID is not configured in `ticketSystem.js`.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const parent = await guild.channels.fetch(SETTINGS.supportCategoryId).catch(() => null);
    if (!parent || parent.type !== ChannelType.GuildCategory) return interaction.editReply({ content: 'The configured support category was not found. Check its ID in `ticketSystem.js`.' });

    const existing = guild.channels.cache.find(channel => channel.type === ChannelType.GuildText && stateFromChannel(channel)?.ownerId === interaction.user.id);
    if (existing) return interaction.editReply({ content: `You already have an open ticket: ${existing}` });

    const existingNumbers = guild.channels.cache
        .map(channel => channel.name.match(/^ticket-(\d+)-/))
        .filter(Boolean).map(match => Number(match[1]));
    const number = Math.max(0, ...existingNumbers) + 1;
    const state = { ownerId: interaction.user.id, categoryKey: category.key, claimerId: null, openedAt: Date.now() };
    const supportRoles = new Set([SETTINGS.supportTeamRoleId, SETTINGS.supportAdminRoleId, category.pingRoleId].filter(isId));
    const overwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
        ...[...supportRoles].map(id => ({
            id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            ...(id === SETTINGS.supportAdminRoleId ? { allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] } : {}),
        })),
    ];
    if (guild.members.me) overwrites.push({ id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.AttachFiles] });

    const channel = await guild.channels.create({
        name: `ticket-${String(number).padStart(3, '0')}-${category.key}-${slug(interaction.user.username).slice(0, 35)}`.slice(0, 100),
        type: ChannelType.GuildText,
        parent: parent.id,
        topic: topicFor(state),
        permissionOverwrites: overwrites,
        reason: `Ticket opened by ${interaction.user.tag} (${category.label})`,
    });
    const pingRoleIds = [...new Set([SETTINGS.supportTeamRoleId, category.pingRoleId].filter(isId))];
    const content = [...pingRoleIds.map(roleId => `<@&${roleId}>`), `<@${interaction.user.id}>`].join(' ');
    const lines = [
        content,
        SETTINGS.ticketWelcome,
        '',
        `**Opened by:** <@${interaction.user.id}>`,
        `**Category:** ${category.label}`,
        `**Why:** ${safeText(answers.reason)}`,
        `**Additional details:** ${safeText(answers.details)}`,
        `**Opened:** <t:${Math.floor(state.openedAt / 1000)}:F>`,
        `**Claimed by:** Unclaimed`,
    ];
    await channel.send(ticketPayload(ticketContainer(`${category.emoji} ${SETTINGS.ticketTitle} · ${category.label}`, lines, true), [ticketButtons()], {
        allowedMentions: { users: [interaction.user.id], roles: pingRoleIds },
    }));
    await interaction.editReply({ content: `Your ticket is ready: ${channel}` });
}

function openTicketModal(category) {
    const modal = new ModalBuilder().setCustomId(`maui:ticket:open:${category.key}`).setTitle(`Open ${category.label}`.slice(0, 45));
    for (const question of SETTINGS.openingQuestions.slice(0, 5)) {
        const input = new TextInputBuilder().setCustomId(question.id).setLabel(question.label.slice(0, 45))
            .setPlaceholder((question.placeholder || '').slice(0, 100)).setStyle(question.style || TextInputStyle.Short)
            .setRequired(Boolean(question.required));
        modal.addComponents(new ActionRowBuilder().addComponents(input));
    }
    return modal;
}

async function updateClaim(interaction, channel, state, claim) {
    if (!canUseSupportButtons(interaction.member)) return interaction.reply({ content: 'Only members with the Support Team or Support Admin role can claim or unclaim tickets.', flags: MessageFlags.Ephemeral });
    if (claim && state.claimerId) {
        return interaction.reply({ content: state.claimerId === interaction.user.id ? 'You already claimed this ticket. Use Unclaim when you are done.' : `This ticket is already claimed by <@${state.claimerId}>.`, flags: MessageFlags.Ephemeral });
    }
    if (!claim && !state.claimerId) return interaction.reply({ content: 'This ticket is not currently claimed.', flags: MessageFlags.Ephemeral });
    if (!claim && state.claimerId !== interaction.user.id && !isSupportAdmin(interaction.member)) {
        return interaction.reply({ content: 'Only the person who claimed this ticket or a Support Admin can unclaim it.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferUpdate();
    const previousClaimerId = state.claimerId;
    state.claimerId = claim ? interaction.user.id : null;
    await channel.setTopic(topicFor(state));
    await applyStaffTypingPolicy(channel, state);
    await channel.permissionOverwrites.edit(state.ownerId, { ViewChannel: true, ReadMessageHistory: true, SendMessages: true });
    if (claim) {
        await channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, ReadMessageHistory: true, SendMessages: true });
    } else if (previousClaimerId && previousClaimerId !== state.ownerId) {
        await channel.permissionOverwrites.delete(previousClaimerId).catch(() => null);
    }
    await channel.send(ticketPayload(claimStatusContainer(claim, interaction.user.id), [], {
        allowedMentions: { users: [interaction.user.id] },
    }));
}

async function transcriptHtml(channel, state, category, reason) {
    const messages = [];
    let before;
    while (true) {
        const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        messages.push(...page.values());
        if (page.size < 100) break;
        before = page.last().id;
    }
    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const esc = text => String(text || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const body = messages.map(message => {
        const componentText = [];
        const readComponents = component => {
            if (component.content) componentText.push(component.content);
            for (const child of component.components || []) readComponents(child);
        };
        for (const component of message.components || []) readComponents(component.toJSON());
        const text = [message.content, ...componentText].filter(Boolean).join('\n') || '[No text]';
        return `<article><b>${esc(message.author.tag)}</b> <time>${new Date(message.createdTimestamp).toISOString()}</time><p>${esc(text)}</p>${message.attachments.map(file => `<p><a href="${esc(file.url)}">${esc(file.name || 'attachment')}</a></p>`).join('')}</article>`;
    }).join('\n');
    const opener = await channel.guild.members.fetch(state.ownerId).catch(() => null);
    const claimer = state.claimerId ? await channel.guild.members.fetch(state.claimerId).catch(() => null) : null;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(SETTINGS.transcriptTitle)}</title><style>body{font:15px system-ui;background:#111;color:#eee;max-width:900px;margin:40px auto;padding:0 20px}article{padding:14px 0;border-bottom:1px solid #333}time{color:#999;font-size:12px}p{white-space:pre-wrap}</style></head><body><h1>${esc(SETTINGS.transcriptTitle)} · ${esc(channel.name)}</h1><p>Opened by: ${esc(opener?.user.tag || state.ownerId)}<br>Category: ${esc(category?.label || state.categoryKey)}<br>Claimed by: ${esc(claimer?.user.tag || 'Unclaimed')}<br>Opened: ${new Date(state.openedAt).toISOString()}<br>Closed: ${new Date().toISOString()}<br>Closing reason: ${esc(reason)}</p><hr>${body}</body></html>`;
    return new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `${channel.name}-transcript.html`, description: 'Ticket conversation transcript' });
}

async function closeTicket(interaction, channel, state, reason) {
    if (!canManage(interaction.member) && state.ownerId !== interaction.user.id) return interaction.reply({ content: 'Only the ticket opener or support staff can close this ticket.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const category = categoryFor(state.categoryKey);
    const file = await transcriptHtml(channel, state, category, reason);
    const logChannel = isId(SETTINGS.transcriptChannelId)
        ? await interaction.guild.channels.fetch(SETTINGS.transcriptChannelId).catch(() => null)
        : null;
    const transcriptTarget = logChannel?.isTextBased() ? logChannel : channel;
    {
        const summary = ticketContainer(SETTINGS.transcriptTitle, [
                `**Ticket:** ${channel.name}`, `**Opened by:** <@${state.ownerId}>`,
                `**Category:** ${category?.label || state.categoryKey}`, `**Claimed by:** ${state.claimerId ? `<@${state.claimerId}>` : 'Unclaimed'}`,
                `**Opened:** <t:${Math.floor(state.openedAt / 1000)}:F>`, `**Closed by:** <@${interaction.user.id}>`, `**Closing reason:** ${safeText(reason)}`,
                `Transcript attached: **${channel.name}-transcript.html**`,
            ]);
        summary.addFileComponents(new FileBuilder().setURL(`attachment://${file.name}`));
        await transcriptTarget.send(ticketPayload(summary, [], {
            files: [file],
            allowedMentions: { users: [...new Set([state.ownerId, state.claimerId, interaction.user.id].filter(isId))] },
        }));
    }
    if (transcriptTarget === channel) {
        await interaction.editReply({ content: 'Transcript saved in this ticket. It will be archived in place because no transcript log channel is configured.' });
        await channel.setName(`closed-${channel.name}`.slice(0, 100)).catch(() => null);
        await channel.permissionOverwrites.edit(state.ownerId, { ViewChannel: false, SendMessages: false }).catch(() => null);
        await channel.setTopic(`maui-closed|${state.ownerId}|${state.categoryKey}|${state.claimerId || ''}|${state.openedAt}`.slice(0, 1024)).catch(() => null);
        return;
    }
    await interaction.editReply({ content: 'Transcript saved. This ticket will close in 5 seconds.' });
    setTimeout(() => channel.delete(`Ticket closed by ${interaction.user.tag}: ${reason}`).catch(() => null), 5000);
}

async function showActionModal(interaction, action) {
    const modal = new ModalBuilder().setCustomId(`maui:ticket:${action}:submit`).setTitle(action === 'rename' ? 'Rename ticket' : action === 'escalate' ? 'Escalate ticket' : 'Close ticket');
    const config = action === 'rename'
        ? { id: 'ticket_name', label: 'New ticket name', placeholder: 'e.g. payment-question', required: true }
        : SETTINGS.closeQuestion;
    const input = new TextInputBuilder().setCustomId(config.id).setLabel(config.label.slice(0, 45)).setPlaceholder((config.placeholder || '').slice(0, 100)).setRequired(config.required).setStyle(action === 'close' ? TextInputStyle.Paragraph : TextInputStyle.Short);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
}

async function handleInteraction(interaction) {
    if (interaction.isStringSelectMenu() && interaction.customId === 'maui:ticket:category') {
        const category = categoryFor(interaction.values[0]);
        if (!category) return interaction.reply({ content: 'That ticket category is unavailable.', flags: MessageFlags.Ephemeral });
        return interaction.showModal(openTicketModal(category));
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('maui:ticket:open:')) {
        const category = categoryFor(interaction.customId.split(':').pop());
        if (!category) return interaction.reply({ content: 'That ticket category is unavailable.', flags: MessageFlags.Ephemeral });
        const answers = Object.fromEntries(SETTINGS.openingQuestions.slice(0, 5).map(q => [q.id, interaction.fields.getTextInputValue(q.id)]));
        return openTicket(interaction, category, answers);
    }
    if (interaction.isButton() && interaction.customId.startsWith('maui:ticket:')) {
        const channel = interaction.channel;
        const state = channel && stateFromChannel(channel);
        if (!state) return interaction.reply({ content: 'Ticket controls only work inside an open ticket.', flags: MessageFlags.Ephemeral });
        const action = interaction.customId.split(':').pop();
        if (action === 'claim' || action === 'unclaim') return updateClaim(interaction, channel, state, action === 'claim');
        if (action === 'escalate') {
            if (!canUseSupportButtons(interaction.member)) return interaction.reply({ content: 'Only members with the Support Team or Support Admin role can escalate tickets.', flags: MessageFlags.Ephemeral });
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await channel.send(ticketPayload(escalationContainer(state), [], { allowedMentions: escalationMentions(state) }));
            return interaction.editReply('Ticket escalated. The opener and Support Admins were notified.');
        }
        if (action === 'rename' && !canUseSupportButtons(interaction.member)) {
            return interaction.reply({ content: 'Only members with the Support Team or Support Admin role can rename tickets.', flags: MessageFlags.Ephemeral });
        }
        if (action === 'close' && !canManage(interaction.member) && state.ownerId !== interaction.user.id) {
            return interaction.reply({ content: 'Only the ticket opener or support staff can close this ticket.', flags: MessageFlags.Ephemeral });
        }
        return showActionModal(interaction, action);
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('maui:ticket:')) {
        const action = interaction.customId.split(':')[2];
        const channel = interaction.channel;
        const state = channel && stateFromChannel(channel);
        if (!state) return interaction.reply({ content: 'This ticket is no longer open.', flags: MessageFlags.Ephemeral });
        if (action === 'rename') {
            if (!canUseSupportButtons(interaction.member)) return interaction.reply({ content: 'Only members with the Support Team or Support Admin role can rename tickets.', flags: MessageFlags.Ephemeral });
            const base = slug(interaction.fields.getTextInputValue('ticket_name'));
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await channel.setName(`ticket-${base}`.slice(0, 100));
            return interaction.editReply({ content: `Ticket renamed to **${channel.name}**.` });
        }
        if (action === 'close') return closeTicket(interaction, channel, state, interaction.fields.getTextInputValue(SETTINGS.closeQuestion.id));
    }
    return false;
}

const staffOnly = async message => {
    if (!canManage(message.member)) { await message.reply('Only the support team can use ticket staff commands.'); return false; }
    return true;
};
function getPrefixTicket(message) {
    const state = stateFromChannel(message.channel);
    if (!state) { message.reply('Use this command inside a ticket channel.'); return null; }
    return state;
}

const prefixCommands = [
    { name: 'ticketpanel', execute: async message => { if (await staffOnly(message)) await createPanel(message); } },
    { name: 'inactive', execute: async message => {
        const state = getPrefixTicket(message); if (!state || !await staffOnly(message)) return;
        const container = ticketContainer('<:maui:1556034121271214141> | **Ticket Inactivity Notice**', [
            `-# <@${state.ownerId}>`,
            '',
            '<:summerpopsiclestick:1511371881817702450> This ticket has been marked as **inactive** due to no recent response or activity. If you still require assistance, please respond within **24 hours** to prevent this ticket from being closed. If no response is received within this timeframe, the ticket will be **closed**.',
        ]);
        await message.channel.send(ticketPayload(container, [], {
            allowedMentions: { users: [state.ownerId] },
        }));
    } },
    { name: 'claim', execute: async message => {
        const state = getPrefixTicket(message); if (!state || !await staffOnly(message)) return;
        if (state.claimerId) return message.reply(state.claimerId === message.author.id ? `You already claimed this ticket. Use ${SETTINGS.prefix}unclaim when you are done.` : `Already claimed by <@${state.claimerId}>.`);
        state.claimerId = message.author.id; await message.channel.setTopic(topicFor(state));
        await applyStaffTypingPolicy(message.channel, state);
        await message.channel.permissionOverwrites.edit(state.ownerId, { ViewChannel: true, ReadMessageHistory: true, SendMessages: true });
        await message.channel.permissionOverwrites.edit(message.author.id, { ViewChannel: true, ReadMessageHistory: true, SendMessages: true });
        await message.channel.send(ticketPayload(claimStatusContainer(true, message.author.id), [], {
            allowedMentions: { users: [message.author.id] },
        }));
    } },
    { name: 'unclaim', execute: async message => {
        const state = getPrefixTicket(message); if (!state || !await staffOnly(message)) return;
        if (!state.claimerId) return message.reply('This ticket is not currently claimed.');
        if (state.claimerId !== message.author.id && !isSupportAdmin(message.member)) return message.reply('Only the current claimer or a Support Admin can unclaim this ticket.');
        const previousClaimerId = state.claimerId;
        state.claimerId = null; await message.channel.setTopic(topicFor(state));
        await applyStaffTypingPolicy(message.channel, state);
        await message.channel.permissionOverwrites.edit(state.ownerId, { ViewChannel: true, ReadMessageHistory: true, SendMessages: true });
        if (previousClaimerId && previousClaimerId !== state.ownerId) await message.channel.permissionOverwrites.delete(previousClaimerId).catch(() => null);
        await message.channel.send(ticketPayload(claimStatusContainer(false, message.author.id), [], {
            allowedMentions: { users: [message.author.id] },
        }));
    } },
    { name: 'rename', execute: async (message, args) => {
        const state = getPrefixTicket(message); if (!state || !await staffOnly(message)) return;
        if (!args.length) return message.reply(`Usage: ${SETTINGS.prefix}rename new-ticket-name`);
        await message.channel.setName(`ticket-${slug(args.join('-'))}`.slice(0, 100)); await message.reply(`Renamed to **${message.channel.name}**.`);
    } },
    { name: 'escalate', execute: async (message, args) => {
        const state = getPrefixTicket(message); if (!state || !await staffOnly(message)) return;
        if (!args.length) return message.reply(`Usage: ${SETTINGS.prefix}escalate message for leadership`);
        const container = escalationContainer(state).addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Staff note:** ${safeText(args.join(' '))}`));
        await message.channel.send(ticketPayload(container, [], { allowedMentions: escalationMentions(state) }));
    } },
];

module.exports = {
    prefixCommands,
    handleInteraction,
    syncOpenTicketPermissions,
    settings: SETTINGS,
    eventName: Events.InteractionCreate,
};
