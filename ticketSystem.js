// Ticket system settings and copy live here so they are easy to customize.
// Add Discord role/channel IDs below before using the system.
const { getDB } = require('./db'); // adjust the path if db.js lives elsewhere
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
    Routes,
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
        { key: 'general', label: 'General Support', description: 'Questions, help, or general assistance.', emoji: '💬', pingRoleId: '1484374350089027585' },
        { key: 'leadership', label: 'Leadership Support', description: 'Private matters for the leadership team.', emoji: '🛡️', pingRoleId: '1471629811221794827' },
        { key: 'hr', label: 'Human Resources Support', description: 'Staff-related concerns, management matters, reports, leave requests, and HR inquiries.', emoji: '👥', pingRoleId: '1484374059079958758' },
        { key: 'dev', label: 'Development Support', description: 'Development questions, game issues, bugs, and suggestions.', emoji: '🛠️', pingRoleId: '' },
        { key: 'prd', label: 'Public Relations Department Support', description: 'Partnership inquiries, affiliate matters, and public relations concerns.', emoji: '📋', pingRoleId: '1484374236243038351' },
    ],
    // Change labels and emoji freely. Button ids are internal and should stay as-is.
    buttons: { claim: 'Claim', unclaim: 'Unclaim', rename: 'Rename', escalate: 'Escalate', close: 'Close' },
};

const TICKET_PREFIX = 'maui-ticket';
const isId = value => /^\d{17,20}$/.test(String(value || ''));
const safeText = (value, max = 1000) => String(value || '').replace(/[<>]/g, '').slice(0, max) || 'Not provided';
const slug = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'ticket';

// ---------------------------------------------------------------------------
// Ticket state store (memory cache + MongoDB 'tickets' collection).
// State used to live in the channel topic, but every topic edit is a channel
// PATCH that shares Discord's rate-limit bucket with renames. That is why
// -claim froze after -rename. Claiming is now instant and never edits the channel.
// ---------------------------------------------------------------------------
const tickets = new Map(); // channelId -> state (cache; MongoDB is the source of truth)
const col = () => getDB().collection('tickets');

let loadPromise = null;
// Loads open tickets from MongoDB once. Safe to call repeatedly; retries if the DB wasn't ready.
function loadTickets() {
    if (!loadPromise) {
        loadPromise = col().find({}).toArray()
            .then(docs => { for (const { _id, ...state } of docs) tickets.set(_id, state); })
            .catch(error => { console.error('Could not load tickets from MongoDB:', error.message); loadPromise = null; });
    }
    return loadPromise;
}

// Fire-and-forget so claim/unclaim never wait on the database.
function saveTicket(channelId, state) {
    col().replaceOne({ _id: channelId }, { ...state }, { upsert: true })
        .catch(error => console.error(`Could not save ticket ${channelId}:`, error.message));
}
function deleteTicket(channelId) {
    tickets.delete(channelId);
    col().deleteOne({ _id: channelId })
        .catch(error => console.error(`Could not delete ticket ${channelId}:`, error.message));
}

function stateFromChannel(channel) {
    if (!channel) return null;
    const cached = tickets.get(channel.id);
    if (cached) return cached;
    // Fallback for tickets created before this update (state stored in topic).
    const match = String(channel.topic || '').match(/^maui-ticket\|([^|]+)\|([^|]+)\|([^|]*)\|([^|]+)$/);
    if (!match) return null;
    const state = { ownerId: match[1], categoryKey: match[2], claimerId: match[3] || null, openedAt: Number(match[4]) || Date.now() };
    tickets.set(channel.id, state);
    saveTicket(channel.id, state);
    return state;
}

function topicFor(state) {
    return `${TICKET_PREFIX}|${state.ownerId}|${state.categoryKey}|${state.claimerId || ''}|${state.openedAt}`.slice(0, 1024);
}

function categoryFor(key) { return SETTINGS.categories.find(category => category.key === key); }

// ---------------------------------------------------------------------------
// UI builders
// ---------------------------------------------------------------------------
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

function ticketButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('maui:ticket:claim').setLabel(SETTINGS.buttons.claim).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('maui:ticket:unclaim').setLabel(SETTINGS.buttons.unclaim).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('maui:ticket:rename').setLabel(SETTINGS.buttons.rename).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('maui:ticket:escalate').setLabel(SETTINGS.buttons.escalate).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('maui:ticket:close').setLabel(SETTINGS.buttons.close).setStyle(ButtonStyle.Danger),
    );
}

// The main ticket message. Rebuilt from state so "Claimed by" stays accurate.
function openTicketContainer(state) {
    const category = categoryFor(state.categoryKey);
    const pingRoleIds = [...new Set([category?.pingRoleId || SETTINGS.supportTeamRoleId].filter(isId))];
    const lines = [
        [...pingRoleIds.map(roleId => `<@&${roleId}>`), `<@${state.ownerId}>`].join(' '),
        SETTINGS.ticketWelcome,
        '',
        `**Opened by:** <@${state.ownerId}>`,
        `**Category:** ${category?.label || state.categoryKey}`,
        `**Why:** ${safeText(state.reason)}`,
        `**Additional details:** ${safeText(state.details)}`,
        `**Opened:** <t:${Math.floor(state.openedAt / 1000)}:F>`,
        `**Claimed by:** ${state.claimerId ? `<@${state.claimerId}>` : 'Unclaimed'}`,
    ];
    return ticketContainer(`${category?.emoji || '🎫'} ${SETTINGS.ticketTitle} · ${category?.label || state.categoryKey}`, lines, true);
}

async function refreshTicketMessage(channel, state) {
    if (!state.messageId) return;
    try {
        const msg = await channel.messages.fetch(state.messageId);
        await msg.edit({
            ...ticketPayload(openTicketContainer(state), [ticketButtons()]),
            allowedMentions: { parse: [] },
        });
    } catch (error) {
        console.error(`Could not refresh ticket message in ${channel.id}:`, error.message);
    }
}

function claimStatusContainer(claimed, userId) {
    return ticketContainer(claimed ? '🙋 Ticket Claimed' : '↩️ Ticket Unclaimed', [
        claimed ? `**Claimed by:** <@${userId}>` : `**Unclaimed by:** <@${userId}>`,
        claimed ? 'The opener and claimer can chat here. Support Admins can also chat; other support roles are view-only.' : 'The opener, Support Team, and Support Admins can chat until someone claims this ticket.',
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

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------
function ticketStaffRoleId(state) {
    const category = state && categoryFor(state.categoryKey);
    return isId(category?.pingRoleId) ? category.pingRoleId : SETTINGS.supportTeamRoleId;
}

function isSupportAdmin(member) {
    return member?.permissions?.has(PermissionFlagsBits.Administrator) ||
        (isId(SETTINGS.supportAdminRoleId) && member?.roles?.cache?.has(SETTINGS.supportAdminRoleId));
}

function canManage(member, state) {
    if (isSupportAdmin(member)) return true;
    const roleIds = state
        ? [ticketStaffRoleId(state)]
        : [SETTINGS.supportTeamRoleId, ...SETTINGS.categories.map(category => category.pingRoleId)];
    return roleIds.some(roleId => isId(roleId) && member?.roles?.cache?.has(roleId));
}

function canUseSupportButtons(member, state) {
    return canManage(member, state);
}

async function applyStaffTypingPolicy(channel, state) {
    const adminRoleId = SETTINGS.supportAdminRoleId;
    const ticketRoleId = ticketStaffRoleId(state);
    const staffRoleIds = new Set([
        SETTINGS.supportTeamRoleId,
        adminRoleId,
        ...SETTINGS.categories.map(category => category.pingRoleId),
    ].filter(isId));
    // Keep each ticket limited to its department role and Support Admins.
    const updates = [channel.permissionOverwrites.edit(channel.guild.roles.everyone.id, {
        ViewChannel: false,
        ReadMessageHistory: false,
        SendMessages: false,
    })];
    for (const roleId of staffRoleIds) {
        const canView = roleId === adminRoleId || roleId === ticketRoleId;
        const canChat = roleId === adminRoleId || (!state.claimerId && roleId === ticketRoleId);
        updates.push(channel.permissionOverwrites.edit(roleId, {
            ViewChannel: canView,
            ReadMessageHistory: canView,
            SendMessages: canChat,
        }));
    }
    await Promise.all(updates);
}

// Claim/unclaim: state is saved in memory instantly; only permission overwrites
// are touched on Discord (a separate rate-limit bucket from renames).
async function saveClaimState(channel, state, previousClaimerId = null) {
    saveTicket(channel.id, state);
    const updates = [
        channel.permissionOverwrites.edit(ticketStaffRoleId(state), {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: !state.claimerId,
        }),
    ];
    if (state.claimerId) {
        updates.push(channel.permissionOverwrites.edit(state.claimerId, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: true,
        }));
    } else if (previousClaimerId && previousClaimerId !== state.ownerId) {
        updates.push(channel.permissionOverwrites.delete(previousClaimerId).catch(() => null));
    }
    await Promise.all(updates);
}

async function syncOpenTicketPermissions(client) {
    await loadTickets();
    for (const guild of client.guilds.cache.values()) {
        for (const channel of guild.channels.cache.values()) {
            if (channel.type !== ChannelType.GuildText) continue;
            const state = stateFromChannel(channel);
            if (!state) continue;
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

// Shared by the button/modal and the prefix command.
async function applyClaim(channel, state, userId, claim) {
    const previousClaimerId = state.claimerId;
    state.claimerId = claim ? userId : null;
    await Promise.all([
        saveClaimState(channel, state, previousClaimerId),
        channel.send(ticketPayload(claimStatusContainer(claim, userId), [], { allowedMentions: { users: [userId] } })),
        refreshTicketMessage(channel, state),
    ]);
}

// ---------------------------------------------------------------------------
// Fast rename. Discord allows 2 renames / 10 min / channel. We track that
// ourselves and answer immediately instead of letting the request hang, and we
// abort after 5s if Discord still queues it.
// ---------------------------------------------------------------------------
const RENAME_WINDOW = 10 * 60 * 1000;
const renameLog = new Map(); // channelId -> [timestamps]

function renameWaitSeconds(channelId) {
    const now = Date.now();
    const recent = (renameLog.get(channelId) || []).filter(t => now - t < RENAME_WINDOW);
    renameLog.set(channelId, recent);
    return recent.length >= 2 ? Math.ceil((RENAME_WINDOW - (now - recent[0])) / 1000) : 0;
}

async function renameTicket(channel, requestedName, byTag) {
    const nextName = `ticket-${slug(requestedName)}`.slice(0, 100);
    if (channel.name === nextName) return { ok: false, text: `This ticket is already named **${nextName}**.` };

    const wait = renameWaitSeconds(channel.id);
    if (wait) {
        const mins = Math.floor(wait / 60), secs = wait % 60;
        return { ok: false, text: `Discord only allows **2 renames per 10 minutes** per channel. Try again in **${mins}m ${secs}s**.` };
    }
    try {
        await channel.client.rest.patch(Routes.channel(channel.id), {
            body: { name: nextName },
            reason: `Ticket renamed by ${byTag}`,
            signal: AbortSignal.timeout(5000),
        });
        renameLog.get(channel.id).push(Date.now());
        return { ok: true, text: `Renamed to **${nextName}**.` };
    } catch (error) {
        console.error(`Could not rename ticket ${channel.id}:`, error);
        if (error.name === 'AbortError' || error.name === 'TimeoutError') return { ok: false, text: 'Discord is rate limiting this channel’s renames right now. Please try again in a few minutes.' };
        if (error.code === 50013) return { ok: false, text: 'The bot needs **Manage Channels** permission in this ticket.' };
        return { ok: false, text: `Discord rejected the rename: ${error.message}` };
    }
}

// ---------------------------------------------------------------------------
// Panel / open / claim / close
// ---------------------------------------------------------------------------
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
    const state = {
        ownerId: interaction.user.id, categoryKey: category.key, claimerId: null, openedAt: Date.now(),
        reason: answers.reason, details: answers.details, messageId: null,
    };
    const ticketRoleId = isId(category.pingRoleId) ? category.pingRoleId : SETTINGS.supportTeamRoleId;
    const staffRoles = new Set([
        SETTINGS.supportTeamRoleId,
        SETTINGS.supportAdminRoleId,
        ...SETTINGS.categories.map(item => item.pingRoleId),
    ].filter(isId));
    const overwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
        ...[...staffRoles].map(id => {
            const canView = id === SETTINGS.supportAdminRoleId || id === ticketRoleId;
            const canChat = id === SETTINGS.supportAdminRoleId || id === ticketRoleId;
            return {
                id,
                ...(canView
                    ? { allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, ...(canChat ? [PermissionFlagsBits.SendMessages] : [])] }
                    : { deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] }),
            };
        }),
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
    tickets.set(channel.id, state);
    saveTicket(channel.id, state);
    const pingRoleIds = [...new Set([category.pingRoleId || SETTINGS.supportTeamRoleId].filter(isId))];
    const sent = await channel.send(ticketPayload(openTicketContainer(state), [ticketButtons()], {
        allowedMentions: { users: [interaction.user.id], roles: pingRoleIds },
    }));
    state.messageId = sent.id;
    saveTicket(channel.id, state);
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
    if (!canUseSupportButtons(interaction.member, state)) return interaction.reply({ content: 'Only this ticket’s department team or Support Admin can claim or unclaim it.', flags: MessageFlags.Ephemeral });
    if (claim && state.claimerId) {
        return interaction.reply({ content: state.claimerId === interaction.user.id ? 'You already claimed this ticket. Use Unclaim when you are done.' : `This ticket is already claimed by <@${state.claimerId}>.`, flags: MessageFlags.Ephemeral });
    }
    if (!claim && !state.claimerId) return interaction.reply({ content: 'This ticket is not currently claimed.', flags: MessageFlags.Ephemeral });
    if (!claim && state.claimerId !== interaction.user.id && !isSupportAdmin(interaction.member)) {
        return interaction.reply({ content: 'Only the person who claimed this ticket or a Support Admin can unclaim it.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferUpdate();
    await applyClaim(channel, state, interaction.user.id, claim);
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
    const [opener, claimer] = await Promise.all([
        channel.guild.members.fetch(state.ownerId).catch(() => null),
        state.claimerId ? channel.guild.members.fetch(state.claimerId).catch(() => null) : null,
    ]);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(SETTINGS.transcriptTitle)}</title><style>body{font:15px system-ui;background:#111;color:#eee;max-width:900px;margin:40px auto;padding:0 20px}article{padding:14px 0;border-bottom:1px solid #333}time{color:#999;font-size:12px}p{white-space:pre-wrap}</style></head><body><h1>${esc(SETTINGS.transcriptTitle)} · ${esc(channel.name)}</h1><p>Opened by: ${esc(opener?.user.tag || state.ownerId)}<br>Category: ${esc(category?.label || state.categoryKey)}<br>Claimed by: ${esc(claimer?.user.tag || 'Unclaimed')}<br>Opened: ${new Date(state.openedAt).toISOString()}<br>Closed: ${new Date().toISOString()}<br>Closing reason: ${esc(reason)}</p><hr>${body}</body></html>`;
    return new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `${channel.name}-transcript.html`, description: 'Ticket conversation transcript' });
}

// Shared close logic for the button and -close. Returns true if the channel will be deleted.
async function finishClose(guild, channel, state, closedById, closedByTag, reason) {
    const category = categoryFor(state.categoryKey);
    const file = await transcriptHtml(channel, state, category, reason);
    const logChannel = isId(SETTINGS.transcriptChannelId)
        ? await guild.channels.fetch(SETTINGS.transcriptChannelId).catch(() => null)
        : null;
    const transcriptTarget = logChannel?.isTextBased() ? logChannel : channel;
    const summary = ticketContainer(SETTINGS.transcriptTitle, [
        `**Ticket:** ${channel.name}`, `**Opened by:** <@${state.ownerId}>`,
        `**Category:** ${category?.label || state.categoryKey}`, `**Claimed by:** ${state.claimerId ? `<@${state.claimerId}>` : 'Unclaimed'}`,
        `**Opened:** <t:${Math.floor(state.openedAt / 1000)}:F>`, `**Closed by:** <@${closedById}>`, `**Closing reason:** ${safeText(reason)}`,
        `Transcript attached: **${channel.name}-transcript.html**`,
    ]);
    summary.addFileComponents(new FileBuilder().setURL(`attachment://${file.name}`));
    await transcriptTarget.send(ticketPayload(summary, [], {
        files: [file],
        allowedMentions: { users: [...new Set([state.ownerId, state.claimerId, closedById].filter(isId))] },
    }));

    deleteTicket(channel.id);

    if (transcriptTarget === channel) {
        await Promise.all([
            channel.setName(`closed-${channel.name}`.slice(0, 100)).catch(() => null),
            channel.permissionOverwrites.edit(state.ownerId, { ViewChannel: false, SendMessages: false }).catch(() => null),
            channel.setTopic(`maui-closed|${state.ownerId}|${state.categoryKey}|${state.claimerId || ''}|${state.openedAt}`.slice(0, 1024)).catch(() => null),
        ]);
        return false;
    }
    setTimeout(() => channel.delete(`Ticket closed by ${closedByTag}: ${reason}`).catch(() => null), 5000);
    return true;
}

async function closeTicket(interaction, channel, state, reason) {
    if (!canManage(interaction.member, state) && state.ownerId !== interaction.user.id) return interaction.reply({ content: 'Only the ticket opener, its department team, or Support Admin can close this ticket.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const deleting = await finishClose(interaction.guild, channel, state, interaction.user.id, interaction.user.tag, reason);
    await interaction.editReply({ content: deleting
        ? 'Transcript saved. This ticket will close in 5 seconds.'
        : 'Transcript saved in this ticket. It was archived in place because no transcript log channel is configured.' });
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
    await loadTickets();
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
            if (!canUseSupportButtons(interaction.member, state)) return interaction.reply({ content: 'Only this ticket’s department team or Support Admin can escalate it.', flags: MessageFlags.Ephemeral });
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await channel.send(ticketPayload(escalationContainer(state), [], { allowedMentions: escalationMentions(state) }));
            return interaction.editReply('Ticket escalated. The opener and Support Admins were notified.');
        }
        if (action === 'rename' && !canUseSupportButtons(interaction.member, state)) {
            return interaction.reply({ content: 'Only this ticket’s department team or Support Admin can rename it.', flags: MessageFlags.Ephemeral });
        }
        if (action === 'close' && !canManage(interaction.member, state) && state.ownerId !== interaction.user.id) {
            return interaction.reply({ content: 'Only the ticket opener, its department team, or Support Admin can close this ticket.', flags: MessageFlags.Ephemeral });
        }
        return showActionModal(interaction, action);
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('maui:ticket:')) {
        const action = interaction.customId.split(':')[2];
        const channel = interaction.channel;
        const state = channel && stateFromChannel(channel);
        if (!state) return interaction.reply({ content: 'This ticket is no longer open.', flags: MessageFlags.Ephemeral });
        if (action === 'rename') {
            if (!canUseSupportButtons(interaction.member, state)) return interaction.reply({ content: 'Only this ticket’s department team or Support Admin can rename it.', flags: MessageFlags.Ephemeral });
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const result = await renameTicket(channel, interaction.fields.getTextInputValue('ticket_name'), interaction.user.tag);
            return interaction.editReply({ content: result.text });
        }
        if (action === 'close') return closeTicket(interaction, channel, state, interaction.fields.getTextInputValue(SETTINGS.closeQuestion.id));
    }
    return false;
}

// ---------------------------------------------------------------------------
// Prefix commands
// ---------------------------------------------------------------------------
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
        const target = message.mentions.users.first();
        if (!target) return message.reply(`Usage: ${SETTINGS.prefix}inactive @user`);
        const container = ticketContainer('<:maui:1556034121271214141> | **Ticket Inactivity Notice**', [
            `-# <@${target.id}>`,
            '',
            '<:summerpopsiclestick:1511371881817702450> This ticket has been marked as **inactive** due to no recent response or activity. If you still require assistance, please respond within **24 hours** to prevent this ticket from being closed. If no response is received within this timeframe, the ticket will be **closed**.',
        ]);
        await message.channel.send(ticketPayload(container, [], {
            allowedMentions: { users: [target.id] },
        }));
    } },
    { name: 'claim', execute: async message => {
        const state = getPrefixTicket(message); if (!state || !await staffOnly(message)) return;
        if (state.claimerId) return message.reply(state.claimerId === message.author.id ? `You already claimed this ticket. Use ${SETTINGS.prefix}unclaim when you are done.` : `Already claimed by <@${state.claimerId}>.`);
        await applyClaim(message.channel, state, message.author.id, true);
    } },
    { name: 'unclaim', execute: async message => {
        const state = getPrefixTicket(message); if (!state || !await staffOnly(message)) return;
        if (!state.claimerId) return message.reply('This ticket is not currently claimed.');
        if (state.claimerId !== message.author.id && !isSupportAdmin(message.member)) return message.reply('Only the current claimer or a Support Admin can unclaim this ticket.');
        await applyClaim(message.channel, state, message.author.id, false);
    } },
    { name: 'close', execute: async (message, args = []) => {
        const state = getPrefixTicket(message); if (!state) return;
        if (!canUseSupportButtons(message.member, state)) return message.reply('Only this ticket’s department team or Support Admin can use this command.');
        const reason = safeText(args.join(' ') || 'Closed by support staff using -close');
        const deleting = await finishClose(message.guild, message.channel, state, message.author.id, message.author.tag, reason);
        if (deleting) return message.reply('Ticket closed. The transcript was saved, and this channel will be deleted in 5 seconds.');
        return message.reply('Ticket closed and transcript saved in this channel.');
    } },
    { name: 'rename', execute: async (message, args = []) => {
        const state = getPrefixTicket(message); if (!state || !await staffOnly(message)) return;
        const requestedName = args.join(' ').trim();
        if (!requestedName) return message.channel.send(`Usage: ${SETTINGS.prefix}rename new-ticket-name`);
        const result = await renameTicket(message.channel, requestedName, message.author.tag);
        return message.channel.send(result.text);
    } },
    { name: 'escalate', execute: async (message, args) => {
        const state = getPrefixTicket(message); if (!state || !await staffOnly(message)) return;
        if (!args.length) return message.reply(`Usage: ${SETTINGS.prefix}escalate message for leadership`);
        const container = escalationContainer(state).addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Staff note:** ${safeText(args.join(' '))}`));
        await message.channel.send(ticketPayload(container, [], { allowedMentions: escalationMentions(state) }));
    } },
];

module.exports = {
    prefixCommands: prefixCommands.map(command => ({
        ...command,
        execute: async (...args) => { await loadTickets(); return command.execute(...args); },
    })),
    handleInteraction,
    syncOpenTicketPermissions,
    settings: SETTINGS,
    eventName: Events.InteractionCreate,
};