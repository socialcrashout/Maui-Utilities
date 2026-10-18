// Corporate Activity system — discord.js v14.19+, MongoDB, Components V2 (no accent colors).
// Drop this next to index.js. It registers its own slash commands and listeners; see init(client).
//
// Mongo collections used: corp_activity_weeks, corp_activity_settings, corp_activity_report_log, corp_activity_warnings

const {
    SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, ChannelType, ComponentType,
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, Events, escapeMarkdown,
} = require('discord.js');

// =====================================================================
// CONFIG
// =====================================================================
const env = process.env;
const envId = (v) => { const s = (v ?? '').toString().trim(); return s && s !== '0' ? s : ''; };

const RANKS = {
    Junior: envId(env.CORP_JUNIOR_ROLE_ID),
    Senior: envId(env.CORP_SENIOR_ROLE_ID),
    Head: envId(env.CORP_HEAD_ROLE_ID),
};
const DEPARTMENTS = {
    HRD: {
        name: 'Human Resource Department',
        roleId: envId(env.CORP_HUMAN_RESOURCES_ROLE_ID),
        requirements: {
            Junior: { messages: 50, shifts: 0, mode: 'or' },
            Senior: { messages: 45, shifts: 0, mode: 'or' },
            Head: { messages: 35, shifts: 1, mode: 'and' },
        },
    },
    OPD: {
        name: 'Operations Department',
        roleId: envId(env.CORP_OPERATIONS_ROLE_ID),
        requirements: {
            Junior: { messages: 50, shifts: 1, mode: 'or' },
            Senior: { messages: 45, shifts: 1, mode: 'or' },
            Head: { messages: 35, shifts: 1, mode: 'or' },
        },
    },
    PRD: {
        name: 'Public Relations Department',
        roleId: envId(env.CORP_PUBLIC_RELATIONS_ROLE_ID),
        requirements: {
            Junior: { messages: 50, shifts: 0, mode: 'or' },
            Senior: { messages: 45, shifts: 0, mode: 'or' },
            Head: { messages: 35, shifts: 0, mode: 'or' },
        },
    },
};
const CORP_HRD_ROLE_ID = envId(env.CORP_HRD_ROLE_ID);
const CORP_LEADERSHIP_ROLE_ID = envId(env.CORP_LEADERSHIP_ROLE_ID);
const CORP_SHIFT_LOGGER_ROLE_ID = envId(env.CORP_SHIFT_LOGGER_ROLE_ID);
const REPORT_TIME_ZONE = env.CORP_REPORT_TIME_ZONE || 'America/New_York';
const REPORT_HOUR = Number.parseInt(env.CORP_REPORT_HOUR || '12', 10);
const DEFAULTS = {
    report_channel_id: envId(env.CORP_REPORT_CHANNEL_ID),
};

// Custom emojis — change them here and they update everywhere.
const E = {
    green: '<:green:1560866052018274425>',
    red: '<:red:1560866217005162516>',
    yellow: '<:yellow:1560866323607724109>',
    status: '<:status:1560866502612226078>',
    calendar: '<:Calendar:1560866770636775434>',
};
const ST = {
    ACTIVE: `${E.green} ACTIVE`, INACTIVE: `${E.red} INACTIVE`, EXCUSED: `${E.yellow} EXCUSED`,
    NONE: 'Not tracked',
};
const FIELDS = ['messages', 'shifts', 'excused'];
const mention = (id) => `<@${id}>`;

// =====================================================================
// STORE (MongoDB)
// =====================================================================
let db = null;
const settings = new Map(); // mirrored in memory so role/channel lookups are synchronous
const col = (name) => {
    if (!db) throw new Error('Activity store not initialised (MongoDB unavailable).');
    return db.collection(name);
};

function resolveDb(h) { // accepts Db, Mongoose connection/module, or MongoClient
    if (!h) return null;
    if (typeof h.collection === 'function') return h;
    if (h.connection && typeof h.connection.collection === 'function') return h.connection;
    if (typeof h.db === 'function') return h.db();
    if (h.db && typeof h.db.collection === 'function') return h.db;
    return null;
}

const getSetting = (key) => (settings.has(key) ? settings.get(key) : DEFAULTS[key] ?? '');
async function setSetting(key, value) {
    await col('corp_activity_settings').updateOne({ _id: key }, { $set: { value: String(value) } }, { upsert: true });
    settings.set(key, String(value));
}

// Monday (UTC) of the week containing `date`.
function weekKey(date = new Date()) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
}

const toRow = (d) => ({ messages: d?.messages ?? 0, shifts: d?.shifts ?? 0, excused: d?.excused ?? 0 });
const getRow = async (userId, week = weekKey()) => toRow(await col('corp_activity_weeks').findOne({ userId, week }));
const getWeekMap = async (week = weekKey()) =>
    new Map((await col('corp_activity_weeks').find({ week }).toArray()).map((d) => [d.userId, toRow(d)]));

async function upsertWeek(userId, update, week = weekKey()) {
    const run = () => col('corp_activity_weeks').updateOne({ userId, week }, update, { upsert: true });
    try { await run(); } catch (e) { if (e.code !== 11000) throw e; await run(); } // first-write race
}
const zeroExcept = (keys) => Object.fromEntries(FIELDS.filter((f) => !keys.includes(f)).map((f) => [f, 0]));

// saveCounts(id, { messages: 0, excused: 1 }) overwrites just those fields.
async function saveCounts(userId, patch) {
    const $set = Object.fromEntries(FIELDS.filter((f) => patch[f] !== undefined).map((f) => [f, patch[f]]));
    const $setOnInsert = zeroExcept(Object.keys($set));
    await upsertWeek(userId, { ...(Object.keys($set).length && { $set }), ...(Object.keys($setOnInsert).length && { $setOnInsert }) });
}
const addCount = (userId, field, amount, week = weekKey()) =>
    upsertWeek(userId, { $inc: { [field]: amount }, $setOnInsert: zeroExcept([field]) }, week);
const resetActivity = (userId) => saveCounts(userId, { messages: 0, shifts: 0, excused: 0 });

// =====================================================================
// MEMBER LOGIC
// =====================================================================
const hasRole = (m, id) => Boolean(id) && m.roles.cache.has(id);

function getTracking(m) {
    const departments = Object.values(DEPARTMENTS).filter((d) => hasRole(m, d.roleId));
    const ranks = Object.entries(RANKS).filter(([, roleId]) => hasRole(m, roleId));
    if (departments.length !== 1 || ranks.length !== 1) return null;
    const [rank] = ranks[0];
    const department = departments[0];
    return { department: department.name, rank, req: department.requirements[rank] };
}

const frac = (v, t) => (t > 0 ? v / t : 1);
const ratioFor = (req, r) => {
    const progress = [frac(r.messages, req.messages)];
    if (req.shifts) progress.push(frac(r.shifts, req.shifts));
    return req.mode === 'and' ? Math.min(...progress) : Math.max(...progress);
};

function evaluate(m, row) {
    const tracking = getTracking(m);
    if (!tracking) return { department: null, rank: null, req: null, status: ST.NONE };
    const { department, rank, req } = tracking;
    if (row.excused) return { department, rank, req, status: ST.EXCUSED };
    const messagesMet = row.messages >= req.messages;
    const shiftsMet = req.shifts > 0 && row.shifts >= req.shifts;
    const active = req.mode === 'and' ? messagesMet && shiftsMet : messagesMet || shiftsMet;
    return { department, rank, req, status: active ? ST.ACTIVE : ST.INACTIVE };
}

const activityText = (req, r) =>
    `${r.messages}/${req.messages} msgs${req.shifts ? ` • ${r.shifts}/${req.shifts} shifts` : ''}`;

// One DB query for the whole guild.
async function collect(guild) {
    if (guild.members.cache.size < guild.memberCount) await guild.members.fetch();
    const rows = await getWeekMap();
    const tracked = [];
    for (const member of guild.members.cache.values()) {
        const row = rows.get(member.id) ?? toRow(null);
        const ev = evaluate(member, row);
        if (ev.req) tracked.push({ member, row, ...ev, ratio: ratioFor(ev.req, row) });
    }
    return { tracked };
}

// =====================================================================
// UI — Components V2 containers, never an accent color
// =====================================================================
const NO_PINGS = { parse: [] };
const td = (s) => new TextDisplayBuilder().setContent(s);
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

// panel({ title, intro, sections: [string | string[]], footer, rows })
function panel({ title, intro, sections = [], footer, rows = [] }) {
    const c = new ContainerBuilder(); // no setAccentColor on purpose
    let left = 3800 - (footer ? footer.length + 4 : 0); // V2 messages cap text at 4000 chars
    const fit = (s) => {
        if (left <= 1) return null;
        if (s.length <= left) { left -= s.length; return s; }
        const cut = s.slice(0, left - 2);
        const nl = cut.lastIndexOf('\n');
        left = 0;
        return `${nl > 0 ? cut.slice(0, nl) : cut}\n…`;
    };
    c.addTextDisplayComponents(td(fit(intro ? `## ${title}\n${intro}` : `## ${title}`)));
    for (const s of sections) {
        const body = Array.isArray(s) ? s.join('\n') : s;
        const t = body && fit(body);
        if (!t) continue;
        c.addSeparatorComponents(divider()).addTextDisplayComponents(td(t));
    }
    if (footer) c.addSeparatorComponents(divider()).addTextDisplayComponents(td(`-# ${footer}`));
    rows.forEach((r) => c.addActionRowComponents(r));
    return c;
}
const simple = (msg) => new ContainerBuilder().addTextDisplayComponents(td(msg));

function respond(i, container, { ephemeral = false } = {}) {
    if (i.deferred || i.replied) {
        return i.editReply({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: NO_PINGS });
    }
    return i.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
        allowedMentions: NO_PINGS,
    });
}
const say = (i, msg, ephemeral = false) => respond(i, simple(msg), { ephemeral });
const defer = (i) => i.deferReply();

async function activityPanel(member, { always = false, extra = [], rows = [] } = {}) {
    const week = weekKey();
    const row = await getRow(member.id);
    const { department, rank, req, status } = evaluate(member, row);
    if (!req) {
        return always ? panel({         title: 'Corporate | Member Panel', intro: `Managing ${mention(member.id)}`, sections: extra, rows }) : null;
    }
    const activityLines = [`**Messages:** ${row.messages}/${req.messages}`];
    if (req.shifts) activityLines.push(`**Shifts:** ${row.shifts}/${req.shifts}`);
    return panel({
        title: 'Corporate | Corporate Activity',
        sections: [
            [`**Member:** ${mention(member.id)}`, `**Department:** ${department}`, `**Rank:** ${rank}`, `**Status:** ${status}`],
            [`**Requirements:** ${req.messages} messages${req.shifts ? ` ${req.mode.toUpperCase()} ${req.shifts} shift(s)` : ''}`,
                ...activityLines, `**Week:** ${week}`],
            ...extra,
        ],
        rows,
    });
}

function reportPanel(tracked, page = 0) {
    const departments = Object.values(DEPARTMENTS);
    const department = departments[page];
    const members = tracked.filter((x) => x.department === department.name);
    const by = (s) => members.filter((x) => x.status === s);
    const [active, inactive, excused] = [by(ST.ACTIVE), by(ST.INACTIVE), by(ST.EXCUSED)];
    const medals = ['🥇', '🥈', '🥉'];
    const top = [...active].sort((a, b) => b.ratio - a.ratio).slice(0, 3)
        .map((x, i) => `${medals[i]} ${mention(x.member.id)} — **${(x.ratio * 100).toFixed(0)}%**`);
    const activityLines = [...members].sort((a, b) => a.rank.localeCompare(b.rank)).slice(0, 25)
        .map((x) => `${mention(x.member.id)} — ${x.rank} • ${x.status} — ${activityText(x.req, x.row)}`);
    if (members.length > activityLines.length) activityLines.push(`…and ${members.length - activityLines.length} more`);
    const inactiveLines = inactive.slice(0, 20)
        .map((x) => `${mention(x.member.id)} — ${x.rank} — ${activityText(x.req, x.row)}`);
    if (inactive.length > inactiveLines.length) inactiveLines.push(`…and ${inactive.length - inactiveLines.length} more`);
    const excusedLines = excused.slice(0, 20)
        .map((x) => `${mention(x.member.id)} — ${x.rank}`);
    if (excused.length > excusedLines.length) excusedLines.push(`…and ${excused.length - excusedLines.length} more`);
    const pageRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('corp_report_previous').setLabel('Previous')
            .setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId('corp_report_page').setLabel(`${page + 1} / ${departments.length}`)
            .setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('corp_report_next').setLabel('Next')
            .setStyle(ButtonStyle.Primary).setDisabled(page === departments.length - 1),
    );

    return panel({
        title: `📋 Corporate | ${department.name} Activity`,
        intro: `**Week:** ${weekKey()} • **Department ${page + 1} of ${departments.length}**`,
        sections: [
            [`**${E.status} Weekly Status**`, `${E.green} **Active:** ${active.length}`, `${E.red} **Inactive:** ${inactive.length}`, `${E.yellow} **Excused:** ${excused.length}`],
            ['**🏆 Top Activity**', ...(top.length ? top : ['No qualifying activity yet.'])],
            ['**Member Activity**', `**Department:** ${department.name}`, ...(activityLines.length ? activityLines : ['No tracked members in this department.'])],
            [`**${E.red} Inactive Members**`, ...(inactiveLines.length ? inactiveLines : ['No inactive members.'])],
            [`**${E.yellow} Excused Members**`, ...(excusedLines.length ? excusedLines : ['No excused members.'])],
        ],
        footer: 'Requirements vary by rank. Use the buttons to switch departments.',
        rows: [pageRow],
    });
}

function attachReportPagination(message, tracked) {
    const departments = Object.values(DEPARTMENTS);
    let currentPage = 0;
    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 15 * 60_000,
        filter: (button) => button.customId === 'corp_report_previous' || button.customId === 'corp_report_next',
    });
    collector.on('collect', async (button) => {
        try {
            currentPage = Math.max(0, Math.min(departments.length - 1,
                currentPage + (button.customId === 'corp_report_next' ? 1 : -1)));
            await button.update({
                components: [reportPanel(tracked, currentPage)],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: NO_PINGS,
            });
        } catch (err) {
            console.error('[corp-activity] Could not change report department page:', err);
            if (!button.replied && !button.deferred) {
                await button.reply({ content: '❌ Could not change the report page.', ephemeral: true }).catch(console.error);
            }
        }
    });
    collector.on('end', () => {
        message.edit({
            components: [reportPanel(tracked, currentPage)],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: NO_PINGS,
        }).catch((err) => console.error('[corp-activity] Could not disable expired report buttons:', err));
    });
}

async function showHistory(i, member) {
    if (!getTracking(member)) return say(i, `${mention(member.id)} is not tracked.`);
    const rows = await col('corp_activity_weeks').find({ userId: member.id }).sort({ week: -1 }).limit(8).toArray();
    const shifts = await col('corp_activity_shifts').find({
        $or: [{ hostId: member.id }, { cohostId: member.id }],
    }).sort({ createdAt: -1 }).limit(8).toArray();
    if (!rows.length && !shifts.length) return say(i, 'No activity history found.', true);
    return respond(i, panel({
        title: `${E.status} Activity History | ${escapeMarkdown(member.displayName)}`,
        sections: [
            ...(rows.length ? [rows.map((d) => {
                const r = toRow(d);
                return `**${d.week}** — ${r.messages} msgs • ${r.shifts} shifts${r.excused ? ` • ${E.yellow} Excused` : ''}`;
            })] : []),
            ...(shifts.length ? [['**Recent Hosted Shifts**', ...shifts.map((shift) => {
                const at = Math.floor(new Date(shift.createdAt).getTime() / 1000);
                return `• <t:${at}:d> — Host: ${mention(shift.hostId)}${shift.cohostId ? ` • Co-host: ${mention(shift.cohostId)}` : ''}`;
            })]] : []),
        ],
    }));
}

// =====================================================================
// COMMANDS
// =====================================================================
const commands = [];

const canManageCorporateActivity = (i) => Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator))
    || [CORP_HRD_ROLE_ID, CORP_LEADERSHIP_ROLE_ID].some((roleId) =>
        Boolean(roleId) && Boolean(i.member?.roles?.cache?.has(roleId)));
const canLogCorporateShift = (i) => canManageCorporateActivity(i)
    || (Boolean(CORP_SHIFT_LOGGER_ROLE_ID) && Boolean(i.member?.roles?.cache?.has(CORP_SHIFT_LOGGER_ROLE_ID)));

function cmd(builder, handler, { hrd = false, shiftLogger = false } = {}) {
    builder.setContexts(InteractionContextType.Guild);
    commands.push({
        data: builder,
        async execute(i, client) {
            if (!db) return say(i, '❌ The activity database is not connected right now.', true);
            if (hrd && !canManageCorporateActivity(i)) return say(i, '❌ You need the Corporate HRD or Leadership role to use this command.', true);
            if (shiftLogger && !canLogCorporateShift(i)) return say(i, '❌ You need the configured shift-logger, HRD, or Leadership role to use this command.', true);
            try {
                await handler(i, client);
            } catch (err) {
                console.error(`[corp-activity] /${builder.name} failed:`, err);
                say(i, '❌ Something went wrong running that command.', true).catch(() => {});
            }
        },
    });
}

const B = (name, description) => new SlashCommandBuilder().setName(`corp${name}`).setDescription(description);
const memberOpt = (o) => o.setName('member').setDescription('The member.').setRequired(true);
const countOpt = (name) => (o) => o.setName(name).setDescription(`New ${name} count.`).setRequired(true).setMinValue(0);

async function target(i) {
    const m = i.options.getMember('member');
    if (!m) await say(i, '❌ I could not find that member in this server.', true);
    return m;
}
function trackingBlock(i, member) {
    if (!getTracking(member)) {
        return say(i, '❌ That member needs exactly one Corporate department role and one Junior, Senior, or Head role to be tracked.', true);
    }
    return null;
}

// ---- viewing ----
cmd(B('activity', "View your own weekly corporate activity."), async (i) => {
    const p = await activityPanel(i.member);
    return p
        ? respond(i, p, { ephemeral: true })
        : say(i, 'You do not have a tracked corporate rank.', true);
});

cmd(B('status', "View a member's current corporate status.").addUserOption(memberOpt), async (i) => {
    const m = await target(i); if (!m) return;
    const { department, rank, status } = evaluate(m, await getRow(m.id));
    if (status === ST.NONE) return say(i, 'That member is not tracked.', true);
    return say(i, `${mention(m.id)}: **${status}**${department && rank ? ` — ${department} • ${rank}` : ''}`);
});

cmd(B('requirements', 'Show the current corporate activity requirements.'), (i) => respond(i, panel({
    title: 'Corporate Activity Requirements',
    sections: [
        ...Object.values(DEPARTMENTS).map((department) => [
            `**${department.name}**`,
            ...Object.entries(department.requirements).map(([rank, req]) =>
                `• **${rank}:** ${req.messages} messages${req.shifts ? ` ${req.mode.toUpperCase()} ${req.shifts} shift(s)` : ''}`),
        ]),
        '**Tracking:** A member needs exactly one department role and one Junior, Senior, or Head role.',
    ],
})));

cmd(B('history', "View a member's recent weekly activity history.").addUserOption(memberOpt),
    async (i) => { const m = await target(i); if (m) await showHistory(i, m); });
cmd(B('weekhistory', 'Show saved weekly activity totals for a member.').addUserOption(memberOpt),
    async (i) => { const m = await target(i); if (m) await showHistory(i, m); });

cmd(B('leaderboard', 'Show the most active tracked corporate members.'), async (i) => {
    await defer(i);
    const { tracked } = await collect(i.guild);
    const lines = tracked.sort((a, b) => b.ratio - a.ratio).slice(0, 10)
        .map((x, n) => `**${n + 1}.** ${mention(x.member.id)} — ${x.department} • ${x.rank} — \`${(x.ratio * 100).toFixed(0)}%\``);
    return respond(i, panel({ title: '🏆 Corporate | Activity Leaderboard', sections: [lines.length ? lines : 'No tracked members found.'] }));
});

// ---- Corporate reports ----
for (const [name, description] of [
    ['report', 'Generate a full weekly Corporate Activity report.'],
    ['closeweek', 'Generate the current weekly report without ending the week.'],
]) {
    cmd(B(name, description), async (i) => {
        await defer(i);
        const { tracked } = await collect(i.guild);
        await respond(i, reportPanel(tracked));
        attachReportPagination(await i.fetchReply(), tracked);
    }, { hrd: true });
}

cmd(B('checkall', 'Check all tracked corporate members.'), async (i) => {
    await defer(i);
    const { tracked } = await collect(i.guild);
    const n = (s) => tracked.filter((x) => x.status === s).length;
    return respond(i, panel({
        title: `${E.status} Corporate Activity Check`,
        sections: [[`${E.green} Active: **${n(ST.ACTIVE)}**`, `${E.red} Inactive: **${n(ST.INACTIVE)}**`,
            `${E.yellow} Excused: **${n(ST.EXCUSED)}**`]],
    }));
}, { hrd: true });

cmd(B('inactive', 'List all currently inactive corporate members.'), async (i) => {
    await defer(i);
    const { tracked } = await collect(i.guild);
    const sections = Object.values(DEPARTMENTS).map((department) => {
        const inactive = tracked.filter((x) => x.department === department.name && x.status === ST.INACTIVE);
        const lines = inactive.slice(0, 10)
            .map((x) => `${mention(x.member.id)} — ${x.rank} — ${activityText(x.req, x.row)}`);
        if (inactive.length > lines.length) lines.push(`…and ${inactive.length - lines.length} more`);
        return [`**${department.name}**`, ...(lines.length ? lines : ['No inactive members.'])];
    });
    return respond(i, panel({ title: `${E.red} Inactive Corporate Members`, sections }));
}, { hrd: true });

cmd(B('excused', 'List members excused this week.'), async (i) => {
    await defer(i);
    const { tracked } = await collect(i.guild);
    const list = tracked.filter((x) => x.row.excused).map((x) => mention(x.member.id));
    return respond(i, panel({ title: `${E.yellow} Excused this week`, sections: [list.length ? list : 'None'] }));
}, { hrd: true });

cmd(B('previousweek', "View the previous week's activity report."), async (i) => {
    await defer(i);
    const prev = weekKey(new Date(Date.now() - 7 * 86_400_000));
    const docs = await col('corp_activity_weeks').find({ week: prev }).sort({ messages: -1 }).limit(25).toArray();
    const lines = [];
    for (const d of docs) {
        const m = await i.guild.members.fetch(d.userId).catch(() => null);
        const tracking = m && getTracking(m);
        if (!tracking) continue;
        const r = toRow(d);
        lines.push(`${mention(m.id)} — ${tracking.department} • ${tracking.rank} — ${r.messages} msgs • ${r.shifts} shifts${r.excused ? ` • ${E.yellow}` : ''}`);
    }
    return respond(i, panel({
        title: `${E.calendar} Previous Week`,
        intro: `**Week:** ${prev}`,
        sections: [lines.length ? lines : 'No saved activity for the previous week.'],
    }));
}, { hrd: true });

// ---- logging activity ----
cmd(B('logshift', 'Log a Corporate Activity host and optional co-host.')
    .addUserOption((o) => o.setName('host').setDescription('The member who hosted.').setRequired(true))
    .addUserOption((o) => o.setName('cohost').setDescription('The member who co-hosted.')),
async (i) => {
    const host = i.options.getMember('host');
    const cohost = i.options.getMember('cohost');
    if (!host) return say(i, '❌ I could not find the host in this server.', true);
    if (cohost && cohost.id === host.id) return say(i, '❌ The host and co-host must be different members.', true);

    const hostBlocked = trackingBlock(i, host); if (hostBlocked) return hostBlocked;
    if (cohost) {
        const cohostBlocked = trackingBlock(i, cohost); if (cohostBlocked) return cohostBlocked;
    }

    const createdAt = new Date();
    await col('corp_activity_shifts').insertOne({
        hostId: host.id,
        cohostId: cohost?.id ?? null,
        loggedBy: i.user.id,
        createdAt,
        week: weekKey(createdAt),
    });
    await addCount(host.id, 'shifts', 1, weekKey(createdAt));
    if (cohost) await addCount(cohost.id, 'shifts', 1, weekKey(createdAt));

    return say(i, `✅ Logged a shift for host ${mention(host.id)}${cohost ? ` and co-host ${mention(cohost.id)}` : ''}.`);
}, { shiftLogger: true });

cmd(B('excuse', 'Excuse a corporate member for the current week.').addUserOption(memberOpt)
    .addStringOption((o) => o.setName('reason').setDescription('Why they are excused.').setRequired(true)),
async (i) => {
    const m = await target(i); if (!m) return;
    const blocked = trackingBlock(i, m); if (blocked) return blocked;
    await saveCounts(m.id, { excused: 1 });
    return say(i, `${E.yellow} ${mention(m.id)} is now marked **EXCUSED** for this week.\nReason: ${i.options.getString('reason')}`);
}, { hrd: true });

cmd(B('unexcuse', 'Remove a weekly excuse.').addUserOption(memberOpt), async (i) => {
    const m = await target(i); if (!m) return;
    const blocked = trackingBlock(i, m); if (blocked) return blocked;
    await saveCounts(m.id, { excused: 0 });
    return say(i, `✅ Removed the weekly excuse from ${mention(m.id)}.`);
}, { hrd: true });

cmd(B('reset', "Reset a member's current-week activity to zero.").addUserOption(memberOpt), async (i) => {
    const m = await target(i); if (!m) return;
    const blocked = trackingBlock(i, m); if (blocked) return blocked;
    await resetActivity(m.id);
    return say(i, `🔄 Reset ${mention(m.id)}'s current-week activity to **0**.`);
}, { hrd: true });

cmd(B('setactivity', "Set a member's current-week activity counts.").addUserOption(memberOpt)
    .addIntegerOption(countOpt('messages')).addIntegerOption(countOpt('shifts')),
async (i) => {
    const m = await target(i); if (!m) return;
    const blocked = trackingBlock(i, m); if (blocked) return blocked;
    const [messages, shifts] = ['messages', 'shifts'].map((k) => i.options.getInteger(k));
    await saveCounts(m.id, { messages, shifts });
    return say(i, `✅ Set ${mention(m.id)}: **${messages}** messages and **${shifts}** shifts.`);
}, { hrd: true });

cmd(B('removeactivity', "Remove activity from a member's current-week counts.").addUserOption(memberOpt)
    .addStringOption((o) => o.setName('type').setDescription('What to remove.').setRequired(true)
        .addChoices({ name: 'Messages', value: 'messages' }, { name: 'Shifts', value: 'shifts' }))
    .addIntegerOption((o) => o.setName('amount').setDescription('How many.').setRequired(true).setMinValue(1)),
async (i) => {
    const m = await target(i); if (!m) return;
    const blocked = trackingBlock(i, m); if (blocked) return blocked;
    const type = i.options.getString('type');
    const amount = i.options.getInteger('amount');
    const row = await getRow(m.id);
    await saveCounts(m.id, { [type]: Math.max(0, row[type] - amount) });
    return say(i, `✅ Removed **${amount}** ${type} from ${mention(m.id)}.`);
}, { hrd: true });

// ---- configuration ----
cmd(B('setreportchannel', 'Set the channel for automatic weekly reports.')
    .addChannelOption((o) => o.setName('channel').setDescription('Report channel.').setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
async (i) => {
    const ch = i.options.getChannel('channel', true);
    await setSetting('report_channel_id', ch.id);
    return say(i, `✅ Weekly reports will be posted in <#${ch.id}>.`);
}, { hrd: true });

// ---- /manage panel with buttons ----
const manageRow = (disabled = false) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('activity_reset').setLabel('Reset Activity').setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary).setDisabled(disabled),
);

cmd(B('manage', 'Open a Corporate Activity panel for a Discord member.').addUserOption(memberOpt), async (i) => {
    const m = await target(i); if (!m) return;

    const roles = [];
    let len = 0;
    for (const r of [...m.roles.cache.filter((r) => r.id !== i.guild.id).values()].sort((a, b) => b.position - a.position)) {
        const s = `<@&${r.id}>`;
        if (len + s.length > 900) break;
        roles.push(s); len += s.length + 2;
    }
    const build = (disabled) => activityPanel(m, {
        always: true,
        extra: [`**Discord User:** ${mention(m.id)}\n**ID:** \`${m.id}\``, `**Roles:** ${roles.join(', ') || 'None'}`],
        rows: [manageRow(disabled)],
    });

    await respond(i, await build(false), { ephemeral: true });
    const collector = (await i.fetchReply()).createMessageComponentCollector({
        componentType: ComponentType.Button, time: 120_000, filter: (b) => b.user.id === i.user.id,
    });
    collector.on('collect', async (b) => {
        try {
            if (!canManageCorporateActivity(b)) return await say(b, '❌ You need the Corporate HRD or Leadership role to use this.', true);
            if (b.customId === 'activity_reset') {
                const blocked = trackingBlock(b, m);
                if (blocked) return await blocked;
                await resetActivity(m.id);
                return await say(b, '✅ Weekly activity has been reset to 0.', true);
            }
        } catch (err) {
            console.error('[corp-activity] manage button failed:', err);
            say(b, '❌ Something went wrong.', true).catch(() => {});
        }
    });
    collector.on('end', async () => respond(i, await build(true)).catch(() => {}));
}, { hrd: true });

// ---- warnings ----
cmd(B('warn', 'Record a Corporate Activity warning for a Discord member.').addUserOption(memberOpt)
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the warning.').setRequired(true)),
async (i) => {
    const m = await target(i); if (!m) return;
    const reason = i.options.getString('reason', true);
    await col('corp_activity_warnings').insertOne({ userId: m.id, reason, moderatorId: i.user.id, createdAt: new Date().toISOString() });
    const count = await col('corp_activity_warnings').countDocuments({ userId: m.id });
    return say(i, `⚠️ Warning **#${count}** recorded for ${mention(m.id)}.\nReason: ${reason}`);
}, { hrd: true });

cmd(B('warnings', "View a member's recorded Corporate Activity warnings.").addUserOption(memberOpt), async (i) => {
    const m = await target(i); if (!m) return;
    const docs = await col('corp_activity_warnings').find({ userId: m.id }).sort({ createdAt: -1 }).limit(10).toArray();
    if (!docs.length) return say(i, `✅ ${mention(m.id)} has no recorded warnings.`);
    return respond(i, panel({
        title: `⚠️ Warnings | ${escapeMarkdown(m.displayName)}`,
        sections: [docs.map((d) => `• **${d.createdAt.slice(0, 10)}** — ${d.reason} — by ${mention(d.moderatorId)}`)],
    }));
}, { hrd: true });

// =====================================================================
// LISTENERS + WEEKLY REPORT
// =====================================================================
async function onMessage(message) {
    if (!db || message.author.bot || !message.guild) return;
    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member || !getTracking(member)) return;
    await addCount(member.id, 'messages', 1).catch((e) => console.error('[corp-activity] message count failed:', e.message));
}

async function weeklyTick(client) {
    const channelId = getSetting('report_channel_id');
    const now = new Date();
    const localTime = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: REPORT_TIME_ZONE,
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(now).map(({ type, value }) => [type, value]));
    // The DB marker prevents duplicate posts during the first five minutes after local noon.
    if (!db || !channelId || localTime.weekday !== 'Sun'
        || Number(localTime.hour) !== REPORT_HOUR || Number(localTime.minute) > 4) return;
    try {
        const localDate = `${localTime.year}-${localTime.month}-${localTime.day}`;
        await col('corp_activity_report_log').insertOne({ _id: localDate, at: now });
    } catch (e) {
        if (e.code === 11000) return;
        throw e;
    }
    for (const guild of client.guilds.cache.values()) {
        const channel = guild.channels.cache.get(channelId);
        if (!channel?.isTextBased()) continue;
        try {
            const { tracked } = await collect(guild);
            const report = await channel.send({
                components: [reportPanel(tracked)], flags: MessageFlags.IsComponentsV2, allowedMentions: NO_PINGS,
            });
            attachReportPagination(report, tracked);
        } catch (err) {
            console.error(`[corp-activity] Could not send weekly report in ${channelId}:`, err.message);
        }
    }
}

let started = false;
async function init(client) {
    if (started) return;
    started = true;

    db = resolveDb(client.db);
    if (!db && env.MONGO_URI) { // fallback if ./db returned something unusable
        try {
            const { MongoClient } = require('mongodb');
            const mongo = new MongoClient(env.MONGO_URI);
            await mongo.connect();
            db = mongo.db(env.MONGO_DB_NAME || undefined);
        } catch (err) {
            console.error('[corp-activity] Could not open a MongoDB connection:', err.message);
        }
    }
    if (!db) return console.warn('[corp-activity] No MongoDB connection — activity commands are disabled.');

    await col('corp_activity_weeks').createIndex({ userId: 1, week: 1 }, { unique: true });
    await col('corp_activity_weeks').createIndex({ week: 1 });
    await col('corp_activity_shifts').createIndex({ hostId: 1, createdAt: -1 });
    await col('corp_activity_shifts').createIndex({ cohostId: 1, createdAt: -1 });
    await col('corp_activity_warnings').createIndex({ userId: 1, createdAt: -1 });

    for (const d of await col('corp_activity_settings').find({}).toArray()) settings.set(d._id, d.value);
    client.on(Events.MessageCreate, (m) => onMessage(m).catch(console.error));
    setInterval(() => weeklyTick(client).catch((e) => console.error('[corp-activity] weekly report error:', e)), 60_000);
    console.log(`[corp-activity] Ready — ${commands.length} commands.`);
}

module.exports = { commands, init };