const mongoose = require('mongoose');
const Warning = require('../utils/Warning')
const ModLog = require('../utils/ModLog');
const { canModerateTarget } = require('./permissions');
const { buildModContainer, containerPayload, sendModLogMessage } = require('./modContainer');
const { formatDuration } = require('./duration');

function fail(reason) {
    return { ok: false, reason };
}

function successPayload(container) {
    return { ok: true, payload: containerPayload(container) };
}

async function recordModLog({ guild, moderator, targetId, targetTag, action, reason, duration = null }) {
    await ModLog.create({
        guildId: guild.id,
        userId: targetId,
        userTag: targetTag,
        moderatorId: moderator.id,
        moderatorTag: moderator.user.tag,
        action,
        reason,
        duration
    });
}

// ---------- KICK ----------
async function performKick({ guild, moderator, targetMember, reason, client }) {
    const check = canModerateTarget(guild, moderator, targetMember);
    if (!check.ok) return fail(check.reason);

    if (!targetMember.kickable) return fail("I don't have permission to kick this member.");

    const targetTag = targetMember.user.tag;
    const targetId = targetMember.id;

    try {
        await targetMember.kick(reason);
    } catch (err) {
        console.error('Kick failed:', err);
        return fail('Discord rejected the kick. Check my permissions and role position.');
    }

    await recordModLog({ guild, moderator, targetId, targetTag, action: 'kick', reason });

    const container = buildModContainer({
        heading: '👢 Member Kicked',
        fields: [
            { label: 'User', value: `${targetTag} (\`${targetId}\`)` },
            { label: 'Moderator', value: `${moderator.user.tag}` },
            { label: 'Reason', value: reason }
        ]
    });

    await sendModLogMessage(guild, {
        heading: '👢 Member Kicked',
        fields: [
            { label: 'User', value: `<@${targetId}> (\`${targetId}\`)` },
            { label: 'Moderator', value: `<@${moderator.id}>` },
            { label: 'Reason', value: reason }
        ]
    });

    return successPayload(container);
}

// ---------- BAN ----------
async function performBan({ guild, moderator, targetMember, targetUser, reason, client }) {
    // targetMember may be null if the user isn't in the guild — banning by ID is still valid.
    const check = canModerateTarget(guild, moderator, targetMember);
    if (!check.ok) return fail(check.reason);

    if (targetMember && !targetMember.bannable) return fail("I don't have permission to ban this member.");

    const targetId = targetMember ? targetMember.id : targetUser.id;
    const targetTag = targetMember ? targetMember.user.tag : targetUser.tag;

    try {
        await guild.members.ban(targetId, { reason });
    } catch (err) {
        console.error('Ban failed:', err);
        return fail('Discord rejected the ban. Check my permissions and role position.');
    }

    await recordModLog({ guild, moderator, targetId, targetTag, action: 'ban', reason });

    const container = buildModContainer({
        heading: '🔨 Member Banned',
        fields: [
            { label: 'User', value: `${targetTag} (\`${targetId}\`)` },
            { label: 'Moderator', value: `${moderator.user.tag}` },
            { label: 'Reason', value: reason }
        ]
    });

    await sendModLogMessage(guild, {
        heading: '🔨 Member Banned',
        fields: [
            { label: 'User', value: `${targetTag} (\`${targetId}\`)` },
            { label: 'Moderator', value: `<@${moderator.id}>` },
            { label: 'Reason', value: reason }
        ]
    });

    return successPayload(container);
}

// ---------- UNBAN ----------
async function performUnban({ guild, moderator, targetId, client }) {
    let targetTag = targetId;

    try {
        const banInfo = await guild.bans.fetch(targetId).catch(() => null);
        if (!banInfo) return fail('That user is not currently banned.');
        targetTag = banInfo.user.tag;

        await guild.bans.remove(targetId, `Unbanned by ${moderator.user.tag}`);
    } catch (err) {
        console.error('Unban failed:', err);
        return fail('Discord rejected the unban. Check my permissions.');
    }

    await recordModLog({
        guild, moderator, targetId, targetTag, action: 'unban',
        reason: `Unbanned by ${moderator.user.tag}`
    });

    const container = buildModContainer({
        heading: '✅ Member Unbanned',
        fields: [
            { label: 'User', value: `${targetTag} (\`${targetId}\`)` },
            { label: 'Moderator', value: `${moderator.user.tag}` }
        ]
    });

    await sendModLogMessage(guild, {
        heading: '✅ Member Unbanned',
        fields: [
            { label: 'User', value: `${targetTag} (\`${targetId}\`)` },
            { label: 'Moderator', value: `<@${moderator.id}>` }
        ]
    });

    return successPayload(container);
}

// ---------- MUTE (timeout) ----------
async function performMute({ guild, moderator, targetMember, ms, reason, client }) {
    const check = canModerateTarget(guild, moderator, targetMember);
    if (!check.ok) return fail(check.reason);

    if (!targetMember.moderatable) return fail("I don't have permission to mute this member.");

    const targetTag = targetMember.user.tag;
    const targetId = targetMember.id;
    const durationStr = formatDuration(ms);

    try {
        await targetMember.timeout(ms, reason);
    } catch (err) {
        console.error('Mute failed:', err);
        return fail('Discord rejected the timeout. Check my permissions and role position.');
    }

    await recordModLog({ guild, moderator, targetId, targetTag, action: 'mute', reason, duration: durationStr });

    const container = buildModContainer({
        heading: '🔇 Member Muted',
        fields: [
            { label: 'User', value: `${targetTag} (\`${targetId}\`)` },
            { label: 'Moderator', value: `${moderator.user.tag}` },
            { label: 'Duration', value: durationStr },
            { label: 'Reason', value: reason }
        ]
    });

    await sendModLogMessage(guild, {
        heading: '🔇 Member Muted',
        fields: [
            { label: 'User', value: `<@${targetId}> (\`${targetId}\`)` },
            { label: 'Moderator', value: `<@${moderator.id}>` },
            { label: 'Duration', value: durationStr },
            { label: 'Reason', value: reason }
        ]
    });

    return successPayload(container);
}

// ---------- UNMUTE ----------
async function performUnmute({ guild, moderator, targetMember, client }) {
    const check = canModerateTarget(guild, moderator, targetMember);
    if (!check.ok) return fail(check.reason);

    if (!targetMember.isCommunicationDisabled?.()) {
        return fail('That member is not currently muted.');
    }

    const targetTag = targetMember.user.tag;
    const targetId = targetMember.id;

    try {
        await targetMember.timeout(null, `Unmuted by ${moderator.user.tag}`);
    } catch (err) {
        console.error('Unmute failed:', err);
        return fail('Discord rejected the unmute. Check my permissions.');
    }

    await recordModLog({
        guild, moderator, targetId, targetTag, action: 'unmute',
        reason: `Unmuted by ${moderator.user.tag}`
    });

    const container = buildModContainer({
        heading: '🔊 Member Unmuted',
        fields: [
            { label: 'User', value: `${targetTag} (\`${targetId}\`)` },
            { label: 'Moderator', value: `${moderator.user.tag}` }
        ]
    });

    await sendModLogMessage(guild, {
        heading: '🔊 Member Unmuted',
        fields: [
            { label: 'User', value: `<@${targetId}> (\`${targetId}\`)` },
            { label: 'Moderator', value: `<@${moderator.id}>` }
        ]
    });

    return successPayload(container);
}

// ---------- WARN ----------
async function performWarn({ guild, moderator, targetMember, reason, client }) {
    const check = canModerateTarget(guild, moderator, targetMember);
    if (!check.ok) return fail(check.reason);

    const targetTag = targetMember.user.tag;
    const targetId = targetMember.id;

    const warning = await Warning.create({
        guildId: guild.id,
        userId: targetId,
        moderatorId: moderator.id,
        moderatorTag: moderator.user.tag,
        reason
    });

    await recordModLog({ guild, moderator, targetId, targetTag, action: 'warn', reason });

    const totalWarnings = await Warning.countDocuments({ guildId: guild.id, userId: targetId });

    const container = buildModContainer({
        heading: '⚠️ Member Warned',
        fields: [
            { label: 'User', value: `${targetTag} (\`${targetId}\`)` },
            { label: 'Moderator', value: `${moderator.user.tag}` },
            { label: 'Reason', value: reason },
            { label: 'Total Warnings', value: `${totalWarnings}` }
        ],
        footer: `Warning ID: ${warning._id}`
    });

    await sendModLogMessage(guild, {
        heading: '⚠️ Member Warned',
        fields: [
            { label: 'User', value: `<@${targetId}> (\`${targetId}\`)` },
            { label: 'Moderator', value: `<@${moderator.id}>` },
            { label: 'Reason', value: reason },
            { label: 'Total Warnings', value: `${totalWarnings}` }
        ],
        footer: `Warning ID: ${warning._id}`
    });

    return successPayload(container);
}

// ---------- CLEAR SINGLE WARNING (by Mongo ID or 1-based list index) ----------
async function performClearWarn({ guild, moderator, targetUser, ref, client }) {
    const warnings = await Warning.find({ guildId: guild.id, userId: targetUser.id }).sort({ createdAt: -1 });

    if (!warnings.length) return fail('This user has no warnings to clear.');

    let target = null;

    if (mongoose.isValidObjectId(ref)) {
        target = warnings.find(w => w._id.toString() === ref);
    } else if (/^\d+$/.test(ref)) {
        const index = parseInt(ref, 10) - 1;
        target = warnings[index];
    }

    if (!target) return fail('Could not find a warning matching that ID or list number. Use /modlogs to see valid entries.');

    await Warning.deleteOne({ _id: target._id });

    await recordModLog({
        guild, moderator, targetId: targetUser.id, targetTag: targetUser.tag,
        action: 'clearwarn', reason: `Cleared warning ${target._id}`
    });

    const container = buildModContainer({
        heading: '🧹 Warning Cleared',
        fields: [
            { label: 'User', value: `${targetUser.tag} (\`${targetUser.id}\`)` },
            { label: 'Moderator', value: `${moderator.user.tag}` },
            { label: 'Cleared Warning', value: `"${target.reason}" (issued by ${target.moderatorTag})` }
        ]
    });

    await sendModLogMessage(guild, {
        heading: '🧹 Warning Cleared',
        fields: [
            { label: 'User', value: `<@${targetUser.id}>` },
            { label: 'Moderator', value: `<@${moderator.id}>` },
            { label: 'Cleared Warning', value: `"${target.reason}"` }
        ]
    });

    return successPayload(container);
}

// ---------- CLEAR ALL WARNINGS ----------
async function performClearWarns({ guild, moderator, targetUser, client }) {
    const { deletedCount } = await Warning.deleteMany({ guildId: guild.id, userId: targetUser.id });

    if (!deletedCount) return fail('This user has no warnings to clear.');

    await recordModLog({
        guild, moderator, targetId: targetUser.id, targetTag: targetUser.tag,
        action: 'clearwarns', reason: `Cleared all ${deletedCount} warnings`
    });

    const container = buildModContainer({
        heading: '🧹 All Warnings Cleared',
        fields: [
            { label: 'User', value: `${targetUser.tag} (\`${targetUser.id}\`)` },
            { label: 'Moderator', value: `${moderator.user.tag}` },
            { label: 'Warnings Removed', value: `${deletedCount}` }
        ]
    });

    await sendModLogMessage(guild, {
        heading: '🧹 All Warnings Cleared',
        fields: [
            { label: 'User', value: `<@${targetUser.id}>` },
            { label: 'Moderator', value: `<@${moderator.id}>` },
            { label: 'Warnings Removed', value: `${deletedCount}` }
        ]
    });

    return successPayload(container);
}

// ---------- VIEW MODLOGS (warnings + all mod actions for a user) ----------
async function buildModLogsContainer({ guild, targetUser }) {
    const [warnings, logs] = await Promise.all([
        Warning.find({ guildId: guild.id, userId: targetUser.id }).sort({ createdAt: -1 }).limit(10),
        ModLog.find({ guildId: guild.id, userId: targetUser.id }).sort({ createdAt: -1 }).limit(10)
    ]);

    const warningLines = warnings.length
        ? warnings.map((w, i) => `**${i + 1}.** ${w.reason} — *by ${w.moderatorTag}* <t:${Math.floor(w.createdAt.getTime() / 1000)}:R>\n\`ID: ${w._id}\``).join('\n\n')
        : 'No active warnings.';

    const actionLines = logs.length
        ? logs.map(l => {
            const durationPart = l.duration ? ` (${l.duration})` : '';
            return `**${l.action.toUpperCase()}**${durationPart} — ${l.reason} — *by ${l.moderatorTag}* <t:${Math.floor(l.createdAt.getTime() / 1000)}:R>`;
        }).join('\n')
        : 'No mod actions recorded.';

    return buildModContainer({
        heading: `📋 Mod Log — ${targetUser.tag}`,
        fields: [
            { label: `Active Warnings (${warnings.length})`, value: warningLines },
            { label: `Recent Actions (last ${logs.length})`, value: actionLines }
        ],
        footer: `User ID: ${targetUser.id}`
    });
}

module.exports = {
    performKick,
    performBan,
    performUnban,
    performMute,
    performUnmute,
    performWarn,
    performClearWarn,
    performClearWarns,
    buildModLogsContainer
};