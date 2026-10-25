// HRD management activity system — discord.js v14.19+, MongoDB, Components V2 (no accent colors).
// Drop this next to index.js. It registers its own slash commands and listeners; see init(client).
//
// Mongo collections used: activity_weeks, activity_settings, activity_report_log, activity_warnings

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

const COORD = 'Coordinator';
const RANKS = { // order = priority
    'Staff Assistant': { roleId: envId(env.STAFF_ASSISTANT_ROLE_ID), messages: 50, shifts: 3 },
    'Supervisor': { roleId: envId(env.SUPERVISOR_ROLE_ID), messages: 45, shifts: 3 },
    'Assistant Manager': { roleId: envId(env.ASSISTANT_MANAGER_ROLE_ID), messages: 40, shifts: 2 },
    'Manager': { roleId: envId(env.MANAGER_ROLE_ID), messages: 35, shifts: 1 },
    [COORD]: { roleId: envId(env.COORDINATOR_ROLE_ID), messages: 30, shifts: 1 },
};
const HRD_ROLE_ID = envId(env.HRD_ROLE_ID);
const REPORT_HOUR_UTC = Number.parseInt(env.REPORT_HOUR_UTC ?? '20', 10);
const DEFAULTS = {
    intern_role_id: envId(env.MANAGEMENT_INTERN_ROLE_ID),
    cohost_role_id: envId(env.COHOST_ROLE_ID) || '1484374059079958758',
    report_channel_id: envId(env.REPORT_CHANNEL_ID),
};

// Custom emojis — change them here and they update everywhere.
const E = {
    green: '<:green:1560866052018274425>',
    red: '<:red:1560866217005162516>',
    yellow: '<:yellow:1560866323607724109>',
    status: '<:status:1560866502612226078>',
    calendar: '<:Calendar:1560866770636775434>',
    intern: '🟠', // no custom emoji yet
};
const ST = {
    ACTIVE: `${E.green} ACTIVE`, INACTIVE: `${E.red} INACTIVE`, EXCUSED: `${E.yellow} EXCUSED`,
    INTERN: `${E.intern} ON INTERNSHIP`, NONE: 'Not tracked',
};
const FIELDS = ['messages', 'shifts', 'cohosts', 'excused'];
const mention = (id) => `<@${id}>`;
const reportMentions = (userIds) => ({ parse: [], users: [...new Set(userIds)] });
const reportUser = (member) => mention(member.id);

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
    await col('activity_settings').updateOne({ _id: key }, { $set: { value: String(value) } }, { upsert: true });
    settings.set(key, String(value));
}

// Monday (UTC) of the week containing `date`.
function weekKey(date = new Date()) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
}

const toRow = (d) => ({ messages: d?.messages ?? 0, shifts: d?.shifts ?? 0, cohosts: d?.cohosts ?? 0, excused: d?.excused ?? 0 });
const getRow = async (userId, week = weekKey()) => toRow(await col('activity_weeks').findOne({ userId, week }));
const getWeekMap = async (week = weekKey()) =>
    new Map((await col('activity_weeks').find({ week }).toArray()).map((d) => [d.userId, toRow(d)]));

async function upsertWeek(userId, update, week = weekKey()) {
    const run = () => col('activity_weeks').updateOne({ userId, week }, update, { upsert: true });
    try { await run(); } catch (e) { if (e.code !== 11000) throw e; await run(); } // first-write race
}
const zeroExcept = (keys) => Object.fromEntries(FIELDS.filter((f) => !keys.includes(f)).map((f) => [f, 0]));

// saveCounts(id, { messages: 0, excused: 1 }) overwrites just those fields.
async function saveCounts(userId, patch) {
    const $set = Object.fromEntries(FIELDS.filter((f) => patch[f] !== undefined).map((f) => [f, patch[f]]));
    const $setOnInsert = zeroExcept(Object.keys($set));
    await upsertWeek(userId, { ...(Object.keys($set).length && { $set }), ...(Object.keys($setOnInsert).length && { $setOnInsert }) });
}
const addCount = (userId, field, amount) =>
    upsertWeek(userId, { $inc: { [field]: amount }, $setOnInsert: zeroExcept([field]) });
const resetActivity = (userId) => saveCounts(userId, { messages: 0, shifts: 0, cohosts: 0, excused: 0 });

// =====================================================================
// MEMBER LOGIC
// =====================================================================
const hasRole = (m, id) => Boolean(id) && m.roles.cache.has(id);
const isIntern = (m) => hasRole(m, getSetting('intern_role_id'));

function getRank(m) { // Management Intern outranks every management rank
    if (isIntern(m)) return { rank: null, req: null };
    for (const [rank, req] of Object.entries(RANKS)) if (hasRole(m, req.roleId)) return { rank, req };
    return { rank: null, req: null };
}

const frac = (v, t) => (t > 0 ? v / t : 1);
const ratioFor = (rank, req, r) => rank === COORD
    ? Math.max(frac(r.messages, req.messages), r.cohosts)
    : Math.max(frac(r.messages, req.messages), frac(r.shifts, req.shifts));

function evaluate(m, row) {
    if (isIntern(m)) return { rank: null, req: null, status: ST.INTERN };
    const { rank, req } = getRank(m);
    if (!req) return { rank: null, req: null, status: ST.NONE };
    if (row.excused) return { rank, req, status: ST.EXCUSED };
    const ok = rank === COORD
        ? row.messages >= req.messages || row.cohosts >= 1
        : row.messages >= req.messages || row.shifts >= req.shifts;
    return { rank, req, status: ok ? ST.ACTIVE : ST.INACTIVE };
}

const activityText = (rank, req, r) => rank === COORD
    ? `${r.messages}/${req.messages} msgs • ${r.cohosts}/1 co-host`
    : `${r.messages}/${req.messages} msgs • ${r.shifts}/${req.shifts} shifts`;

// One DB query for the whole guild.
async function collect(guild) {
    if (guild.members.cache.size < guild.memberCount) await guild.members.fetch();
    const rows = await getWeekMap();
    const tracked = [];
    const interns = [];
    for (const member of guild.members.cache.values()) {
        if (isIntern(member)) { interns.push(member); continue; }
        const row = rows.get(member.id) ?? toRow(null);
        const ev = evaluate(member, row);
        if (ev.req) tracked.push({ member, row, ...ev, ratio: ratioFor(ev.rank, ev.req, row) });
    }
    return { tracked, interns };
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

function respond(i, container, { ephemeral = false, allowedMentions = NO_PINGS } = {}) {
    if (i.deferred || i.replied) {
        return i.editReply({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions });
    }
    return i.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
        allowedMentions,
    });
}
const say = (i, msg, ephemeral = false) => respond(i, simple(msg), { ephemeral });
const defer = (i) => i.deferReply();

async function activityPanel(member, { always = false, extra = [], rows = [] } = {}) {
    const week = weekKey();
    if (isIntern(member)) {
        return panel({
            title: 'HRD | Management Activity',
            sections: [[`**Member:** ${mention(member.id)}`, `**Status:** ${ST.INTERN}`, `**Week:** ${week}`],
                'Exempt from all weekly requirements.', ...extra],
            rows,
        });
    }
    const row = await getRow(member.id);
    const { rank, req, status } = evaluate(member, row);
    if (!req) {
        return always ? panel({ title: 'HRD | User Management', intro: `Managing ${mention(member.id)}`, sections: extra, rows }) : null;
    }
    const shiftLine = rank === COORD ? `${row.cohosts}/1 qualifying co-host` : `${row.shifts}/${req.shifts} shifts`;
    return panel({
        title: 'HRD | Management Activity',
        sections: [
            [`**Member:** ${mention(member.id)}`, `**Rank:** ${rank}`, `**Status:** ${status}`],
            [`**Messages:** ${row.messages}/${req.messages}`, `**Shift Activity:** ${shiftLine}`, `**Week:** ${week}`],
            ...extra,
        ],
        rows,
    });
}

async function reportPanel(guild) {
    const { tracked } = await collect(guild);
    const by = (s) => tracked.filter((x) => x.status === s);
    const [active, inactive, excused] = [by(ST.ACTIVE), by(ST.INACTIVE), by(ST.EXCUSED)];
    const medals = ['🥇', '🥈', '🥉'];
    const topMembers = [...active].sort((a, b) => b.ratio - a.ratio).slice(0, 3);
    const inactiveMembers = inactive.slice(0, 15);
    const top = topMembers
        .map((x, i) => `${medals[i]} ${reportUser(x.member)} — **${(x.ratio * 100).toFixed(0)}%**`);
    const lines = inactiveMembers
        .map((x) => `${reportUser(x.member)} — ${x.rank} — ${activityText(x.rank, x.req, x.row)}`);
    if (inactive.length > 15) lines.push(`…and ${inactive.length - 15} more`);

    return {
        container: panel({
            title: '📋 HRD | Weekly Management Activity',
            intro: `**Week:** ${weekKey()}`,
            sections: [
                [`**${E.status} Weekly Status**`, `${E.green} **Active:** ${active.length}`, `${E.red} **Inactive:** ${inactive.length}`, `${E.yellow} **Excused:** ${excused.length}`],
                ['**🏆 Top Management**', ...(top.length ? top : ['No qualifying activity yet.'])],
                [`**${E.red} Inactive Members**`, ...(lines.length ? lines : ['Everyone has met a requirement! 🎉'])],
            ],
            footer: 'Management must complete ONE requirement each week. Interns are exempt.',
        }),
        allowedMentions: reportMentions([...topMembers, ...inactiveMembers].map((x) => x.member.id)),
    };
}

async function showHistory(i, member) {
    if (isIntern(member)) return say(i, `${mention(member.id)} is ${ST.INTERN}.`);
    const rows = await col('activity_weeks').find({ userId: member.id }).sort({ week: -1 }).limit(8).toArray();
    if (!rows.length) return say(i, 'No activity history found.', true);
    return respond(i, panel({
        title: `${E.status} Activity History | ${escapeMarkdown(member.displayName)}`,
        sections: [rows.map((d) => {
            const r = toRow(d);
            return `**${d.week}** — ${r.messages} msgs • ${r.shifts} shifts • ${r.cohosts} co-hosts${r.excused ? ` • ${E.yellow} Excused` : ''}`;
        })],
    }));
}

// =====================================================================
// COMMANDS
// =====================================================================
const commands = [];

const isHrd = (i) => Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator))
    || (Boolean(HRD_ROLE_ID) && Boolean(i.member?.roles?.cache?.has(HRD_ROLE_ID)));

function cmd(builder, handler, { hrd = false } = {}) {
    builder.setContexts(InteractionContextType.Guild);
    commands.push({
        data: builder,
        async execute(i, client) {
            if (!db) return say(i, '❌ The activity database is not connected right now.', true);
            if (hrd && !isHrd(i)) return say(i, '❌ You need the HRD role to use this command.', true);
            try {
                await handler(i, client);
            } catch (err) {
                console.error(`[activity] /${builder.name} failed:`, err);
                say(i, '❌ Something went wrong running that command.', true).catch(() => {});
            }
        },
    });
}

const B = (name, description) => new SlashCommandBuilder().setName(name).setDescription(description);
const memberOpt = (o) => o.setName('member').setDescription('The member.').setRequired(true);
const amountOpt = (o) => o.setName('amount').setDescription('How many.').setMinValue(1).setMaxValue(20);
const countOpt = (name) => (o) => o.setName(name).setDescription(`New ${name} count.`).setRequired(true).setMinValue(0);

async function target(i) {
    const m = i.options.getMember('member');
    if (!m) await say(i, '❌ I could not find that member in this server.', true);
    return m;
}
const internBlock = (i) => say(i, `${E.intern} That member is on internship and does not need activity logged.`, true);

// ---- viewing ----
cmd(B('activity', "View a management member's weekly activity.").addUserOption(memberOpt), async (i) => {
    const m = await target(i); if (!m) return;
    const p = await activityPanel(m);
    return p ? respond(i, p) : say(i, 'That member does not have a tracked management rank.', true);
});

cmd(B('myactivity', 'View your own weekly activity.'), async (i) => {
    const p = await activityPanel(i.member);
    return p ? respond(i, p, { ephemeral: true }) : say(i, 'You do not have a tracked management rank.', true);
});

cmd(B('status', "View a member's current management status.").addUserOption(memberOpt), async (i) => {
    const m = await target(i); if (!m) return;
    const { rank, status } = evaluate(m, await getRow(m.id));
    if (status === ST.NONE) return say(i, 'That member is not tracked.', true);
    return say(i, `${mention(m.id)}: **${status}**${rank ? ` — ${rank}` : ''}`);
});

cmd(B('requirements', 'Show the current management activity requirements.'), (i) => respond(i, panel({
    title: 'Management Activity Requirements',
    sections: [
        Object.entries(RANKS).map(([rank, d]) =>
            `**${rank}:** ${d.messages} messages OR ${d.shifts} ${rank === COORD ? 'qualifying co-host' : 'shift(s)'}`),
        `${E.intern} **Management Intern:** Exempt from all activity requirements.`,
    ],
})));

cmd(B('history', "View a member's recent weekly activity history.").addUserOption(memberOpt),
    async (i) => { const m = await target(i); if (m) await showHistory(i, m); });
cmd(B('weekhistory', 'Show saved weekly activity totals for a member.').addUserOption(memberOpt),
    async (i) => { const m = await target(i); if (m) await showHistory(i, m); });

cmd(B('leaderboard', 'Show the most active tracked management members.'), async (i) => {
    await defer(i);
    const { tracked } = await collect(i.guild);
    const lines = tracked.sort((a, b) => b.ratio - a.ratio).slice(0, 10)
        .map((x, n) => `**${n + 1}.** ${mention(x.member.id)} — ${x.rank} — \`${(x.ratio * 100).toFixed(0)}%\``);
    return respond(i, panel({ title: '🏆 HRD | Activity Leaderboard', sections: [lines.length ? lines : 'No tracked members found.'] }));
});

cmd(B('interns', 'List management members currently on internship.'), async (i) => {
    await defer(i);
    const { interns } = await collect(i.guild);
    return respond(i, panel({
        title: `${E.intern} Management Interns`,
        sections: [interns.length ? interns.map((m) => mention(m.id)) : 'No management interns found.'],
    }));
});

// ---- HRD reports ----
for (const [name, description] of [
    ['report', 'Generate a full weekly HRD management activity report.'],
    ['closeweek', 'Generate the current weekly report without ending the week.'],
]) {
    cmd(B(name, description), async (i) => {
        await defer(i);
        const report = await reportPanel(i.guild);
        return respond(i, report.container, { allowedMentions: report.allowedMentions });
    }, { hrd: true });
}

cmd(B('checkall', 'Check all tracked management members.'), async (i) => {
    await defer(i);
    const { tracked, interns } = await collect(i.guild);
    const n = (s) => tracked.filter((x) => x.status === s).length;
    return respond(i, panel({
        title: `${E.status} Management Check`,
        sections: [[`${E.green} Active: **${n(ST.ACTIVE)}**`, `${E.red} Inactive: **${n(ST.INACTIVE)}**`,
            `${E.yellow} Excused: **${n(ST.EXCUSED)}**`, `${E.intern} Interns: **${interns.length}**`]],
    }));
}, { hrd: true });

cmd(B('inactive', 'List all currently inactive management members.'), async (i) => {
    await defer(i);
    const { tracked } = await collect(i.guild);
    const lines = tracked.filter((x) => x.status === ST.INACTIVE).slice(0, 30)
        .map((x) => `${mention(x.member.id)} — ${x.rank} — ${x.row.messages} msgs • ${x.row.shifts} shifts`);
    return respond(i, panel({ title: `${E.red} Inactive Management`, sections: [lines.length ? lines : 'No inactive members.'] }));
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
    const docs = await col('activity_weeks').find({ week: prev }).sort({ messages: -1 }).limit(25).toArray();
    const lines = [];
    for (const d of docs) {
        const m = await i.guild.members.fetch(d.userId).catch(() => null);
        if (!m || isIntern(m)) continue;
        const r = toRow(d);
        lines.push(`${mention(m.id)} — ${r.messages} msgs • ${r.shifts} shifts • ${r.cohosts} co-hosts${r.excused ? ` • ${E.yellow}` : ''}`);
    }
    return respond(i, panel({
        title: `${E.calendar} Previous Week`,
        intro: `**Week:** ${prev}`,
        sections: [lines.length ? lines : 'No saved activity for the previous week.'],
    }));
}, { hrd: true });

// ---- logging activity ----
cmd(B('logshift', 'Log a shift attended by a management member.').addUserOption(memberOpt).addIntegerOption(amountOpt),
    async (i) => {
        const m = await target(i); if (!m) return;
        if (isIntern(m)) return internBlock(i);
        const n = i.options.getInteger('amount') ?? 1;
        await addCount(m.id, 'shifts', n);
        return say(i, `✅ Added **${n}** shift(s) to ${mention(m.id)}.`);
    }, { hrd: true });

cmd(B('logcohost', 'Log a qualifying Coordinator co-host.').addUserOption(memberOpt).addIntegerOption(amountOpt),
    async (i) => {
        const m = await target(i); if (!m) return;
        if (isIntern(m)) return internBlock(i);
        const n = i.options.getInteger('amount') ?? 1;
        await addCount(m.id, 'cohosts', n);
        return say(i, `✅ Added **${n}** qualifying co-host shift(s) to ${mention(m.id)}.`);
    }, { hrd: true });

cmd(B('excuse', 'Excuse a management member for the current week.').addUserOption(memberOpt)
    .addStringOption((o) => o.setName('reason').setDescription('Why they are excused.').setRequired(true)),
async (i) => {
    const m = await target(i); if (!m) return;
    await saveCounts(m.id, { excused: 1 });
    return say(i, `${E.yellow} ${mention(m.id)} is now marked **EXCUSED** for this week.\nReason: ${i.options.getString('reason')}`);
}, { hrd: true });

cmd(B('unexcuse', 'Remove a weekly excuse.').addUserOption(memberOpt), async (i) => {
    const m = await target(i); if (!m) return;
    await saveCounts(m.id, { excused: 0 });
    return say(i, `✅ Removed the weekly excuse from ${mention(m.id)}.`);
}, { hrd: true });

cmd(B('reset', "Reset a member's current-week activity to zero.").addUserOption(memberOpt), async (i) => {
    const m = await target(i); if (!m) return;
    await resetActivity(m.id);
    return say(i, `🔄 Reset ${mention(m.id)}'s current-week activity to **0**.`);
}, { hrd: true });

cmd(B('setactivity', "Set a member's current-week activity counts.").addUserOption(memberOpt)
    .addIntegerOption(countOpt('messages')).addIntegerOption(countOpt('shifts')).addIntegerOption(countOpt('cohosts')),
async (i) => {
    const m = await target(i); if (!m) return;
    const [messages, shifts, cohosts] = ['messages', 'shifts', 'cohosts'].map((k) => i.options.getInteger(k));
    await saveCounts(m.id, { messages, shifts, cohosts });
    return say(i, `✅ Set ${mention(m.id)}: **${messages}** messages, **${shifts}** shifts, **${cohosts}** co-hosts.`);
}, { hrd: true });

cmd(B('removeactivity', "Remove activity from a member's current-week counts.").addUserOption(memberOpt)
    .addStringOption((o) => o.setName('type').setDescription('What to remove.').setRequired(true)
        .addChoices({ name: 'Messages', value: 'messages' }, { name: 'Shifts', value: 'shifts' }, { name: 'Co-hosts', value: 'cohosts' }))
    .addIntegerOption((o) => o.setName('amount').setDescription('How many.').setRequired(true).setMinValue(1)),
async (i) => {
    const m = await target(i); if (!m) return;
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

cmd(B('setinternrole', 'Set the Management Intern role.')
    .addRoleOption((o) => o.setName('role').setDescription('Intern role.').setRequired(true)),
async (i) => {
    const role = i.options.getRole('role', true);
    await setSetting('intern_role_id', role.id);
    return say(i, `${E.intern} Management Intern role set to <@&${role.id}>. Existing interns are now exempt.`);
}, { hrd: true });

cmd(B('setcohostrole', 'Set the qualifying Coordinator co-host role.')
    .addRoleOption((o) => o.setName('role').setDescription('Co-host role.').setRequired(true)),
async (i) => {
    const role = i.options.getRole('role', true);
    await setSetting('cohost_role_id', role.id);
    return say(i, `✅ Qualifying co-host role set to <@&${role.id}>.`);
}, { hrd: true });

cmd(B("setrequirement", "Change a management rank's weekly requirements.")
    .addStringOption((o) => o.setName('rank').setDescription('Rank to change.').setRequired(true)
        .addChoices(...Object.keys(RANKS).map((r) => ({ name: r, value: r }))))
    .addIntegerOption(countOpt('messages')).addIntegerOption(countOpt('shifts')),
async (i) => {
    const rank = i.options.getString('rank', true);
    const messages = i.options.getInteger('messages', true);
    const shifts = i.options.getInteger('shifts', true);
    Object.assign(RANKS[rank], { messages, shifts });
    await setSetting(`req_${rank}_messages`, messages);
    await setSetting(`req_${rank}_shifts`, shifts);
    return say(i, `✅ **${rank}** requirement set to **${messages} messages OR ${shifts} shifts**.`);
}, { hrd: true });

// ---- /manage panel with buttons ----
const manageRow = (disabled = false) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('activity_reset').setLabel('Reset Activity').setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('activity_intern').setLabel('Toggle Internship').setEmoji('🟠')
        .setStyle(ButtonStyle.Primary).setDisabled(disabled),
);

async function toggleIntern(i, targetId) {
    const roleId = getSetting('intern_role_id');
    if (!roleId) return say(i, '❌ Management Intern role is not configured.', true);
    const member = await i.guild.members.fetch(targetId).catch(() => null);
    const role = i.guild.roles.cache.get(roleId);
    if (!member || !role) return say(i, "❌ I couldn't find the member or internship role.", true);
    try {
        if (isIntern(member)) {
            await member.roles.remove(role, `Internship ended by ${i.user.tag}`);
            await resetActivity(member.id);
            return say(i, `✅ Removed <@&${role.id}> from ${mention(member.id)}. Activity reset to 0.`, true);
        }
        await member.roles.add(role, `Internship started by ${i.user.tag}`);
        await resetActivity(member.id);
        return say(i, `${E.intern} ${mention(member.id)} is now ON INTERNSHIP and exempt from requirements.`, true);
    } catch (err) {
        if (err.code === 50013) return say(i, '❌ I cannot manage that role. Make sure my bot role is above the target role.', true);
        throw err;
    }
}

cmd(B('manage', 'Open an HRD management panel for a Discord member.').addUserOption(memberOpt), async (i) => {
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
            if (!isHrd(b)) return await say(b, '❌ You need the HRD role to use this.', true);
            if (b.customId === 'activity_reset') {
                await resetActivity(m.id);
                return await say(b, '✅ Weekly activity has been reset to 0.', true);
            }
            return await toggleIntern(b, m.id);
        } catch (err) {
            console.error('[activity] manage button failed:', err);
            say(b, '❌ Something went wrong.', true).catch(() => {});
        }
    });
    collector.on('end', async () => respond(i, await build(true)).catch(() => {}));
}, { hrd: true });

// ---- Discord role / nickname tools ----
const roleTool = (name, description, verb) => cmd(
    B(name, description).addUserOption(memberOpt)
        .addRoleOption((o) => o.setName('role').setDescription('The role.').setRequired(true)),
    async (i) => {
        const m = await target(i); if (!m) return;
        const role = i.options.getRole('role', true);
        if (role.position >= i.guild.members.me.roles.highest.position) {
            return say(i, `❌ I cannot ${verb} a role equal to or above my highest role.`, true);
        }
        try {
            if (verb === 'give') await m.roles.add(role.id, `Role assigned by ${i.user.tag}`);
            else await m.roles.remove(role.id, `Role removed by ${i.user.tag}`);
            return say(i, verb === 'give'
                ? `✅ Gave <@&${role.id}> to ${mention(m.id)}.`
                : `✅ Removed <@&${role.id}> from ${mention(m.id)}.`);
        } catch (err) {
            if (err.code === 50013) return say(i, '❌ Discord denied the role change. Check my role hierarchy and permissions.', true);
            throw err;
        }
    }, { hrd: true });
roleTool('setrole', 'Give a Discord role to a member.', 'give');
roleTool('removerole', 'Remove a Discord role from a member.', 'remove');

cmd(B('nickname', "Change a member's Discord nickname.").addUserOption(memberOpt)
    .addStringOption((o) => o.setName('name').setDescription('New nickname.').setRequired(true).setMaxLength(32)),
async (i) => {
    const m = await target(i); if (!m) return;
    const name = i.options.getString('name', true);
    try {
        await m.setNickname(name, `Nickname changed by ${i.user.tag}`);
        return say(i, `✅ Changed ${mention(m.id)}'s nickname to **${escapeMarkdown(name)}**.`);
    } catch (err) {
        if (err.code === 50013) return say(i, '❌ I cannot change that nickname because of role hierarchy/permissions.', true);
        throw err;
    }
}, { hrd: true });

cmd(B('resetnickname', "Reset a member's Discord nickname.").addUserOption(memberOpt), async (i) => {
    const m = await target(i); if (!m) return;
    try {
        await m.setNickname(null, `Nickname reset by ${i.user.tag}`);
        return say(i, `✅ Reset ${mention(m.id)}'s nickname.`);
    } catch (err) {
        if (err.code === 50013) return say(i, '❌ I cannot reset that nickname.', true);
        throw err;
    }
}, { hrd: true });

// ---- warnings ----
cmd(B('warn', 'Record an HRD warning for a Discord member.').addUserOption(memberOpt)
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the warning.').setRequired(true)),
async (i) => {
    const m = await target(i); if (!m) return;
    const reason = i.options.getString('reason', true);
    await col('activity_warnings').insertOne({ userId: m.id, reason, moderatorId: i.user.id, createdAt: new Date().toISOString() });
    const count = await col('activity_warnings').countDocuments({ userId: m.id });
    return say(i, `⚠️ Warning **#${count}** recorded for ${mention(m.id)}.\nReason: ${reason}`);
}, { hrd: true });

cmd(B('warnings', "View a member's recorded HRD warnings.").addUserOption(memberOpt), async (i) => {
    const m = await target(i); if (!m) return;
    const docs = await col('activity_warnings').find({ userId: m.id }).sort({ createdAt: -1 }).limit(10).toArray();
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
    if (!member || isIntern(member) || !getRank(member).rank) return;
    await addCount(member.id, 'messages', 1).catch((e) => console.error('[activity] message count failed:', e.message));
}

// Starting or ending an internship always resets that member's week.
async function onMemberUpdate(before, after) {
    const roleId = getSetting('intern_role_id');
    if (!db || !roleId || !before.roles) return;
    if (before.roles.cache.has(roleId) !== after.roles.cache.has(roleId)) await resetActivity(after.id);
}

async function weeklyTick(client) {
    const channelId = getSetting('report_channel_id');
    const now = new Date();
    // Sunday, REPORT_HOUR_UTC, first 5 minutes; the DB marker prevents duplicate posts.
    if (!db || !channelId || now.getUTCDay() !== 0 || now.getUTCHours() !== REPORT_HOUR_UTC || now.getUTCMinutes() > 4) return;
    try {
        await col('activity_report_log').insertOne({ _id: now.toISOString().slice(0, 10), at: now });
    } catch (e) {
        if (e.code === 11000) return;
        throw e;
    }
    for (const guild of client.guilds.cache.values()) {
        const channel = guild.channels.cache.get(channelId);
        if (!channel?.isTextBased()) continue;
        try {
            const report = await reportPanel(guild);
            await channel.send({
                components: [report.container], flags: MessageFlags.IsComponentsV2, allowedMentions: report.allowedMentions,
            });
        } catch (err) {
            console.error(`[activity] Could not send weekly report in ${channelId}:`, err.message);
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
            console.error('[activity] Could not open a MongoDB connection:', err.message);
        }
    }
    if (!db) return console.warn('[activity] No MongoDB connection — activity commands are disabled.');

    await col('activity_weeks').createIndex({ userId: 1, week: 1 }, { unique: true });
    await col('activity_weeks').createIndex({ week: 1 });
    await col('activity_warnings').createIndex({ userId: 1, createdAt: -1 });

    for (const d of await col('activity_settings').find({}).toArray()) settings.set(d._id, d.value);
    for (const [name, req] of Object.entries(RANKS)) { // persisted /setrequirement overrides
        if (settings.has(`req_${name}_messages`)) req.messages = Number.parseInt(settings.get(`req_${name}_messages`), 10);
        if (settings.has(`req_${name}_shifts`)) req.shifts = Number.parseInt(settings.get(`req_${name}_shifts`), 10);
    }

    client.on(Events.MessageCreate, (m) => onMessage(m).catch(console.error));
    client.on(Events.GuildMemberUpdate, (a, b) => onMemberUpdate(a, b).catch(console.error));
    setInterval(() => weeklyTick(client).catch((e) => console.error('[activity] weekly report error:', e)), 60_000);
    console.log(`[activity] Ready — ${commands.length} commands.`);
}

module.exports = { commands, init };