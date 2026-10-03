const MOD_ROLE_IDS = ['1471629811221794827', '1489662334275424386'];

/** The only roles allowed to use moderation commands. */
function getModRoleIds() {
    return MOD_ROLE_IDS;
}

/** True if the member has either approved moderator role. */
function hasModRole(member) {
    const roleIds = getModRoleIds();
    return Boolean(member?.roles?.cache?.some(role => roleIds.includes(role.id)));
}

/** Gate for every moderation command. Administrators must also have an allowed role. */
function hasModPermission(member) {
    return hasModRole(member);
}

/**
 * Full safety check before moderating a member:
 * - can't target the owner
 * - can't target yourself
 * - can't target someone with an equal/higher role than you (unless you're the owner)
 * - bot's role must be above the target's role
 */
function canModerateTarget(guild, moderatorMember, targetMember) {
    if (!targetMember) return { ok: true };

    if (targetMember.id === guild.ownerId) {
        return { ok: false, reason: "You can't moderate the server owner." };
    }

    if (targetMember.id === moderatorMember.id) {
        return { ok: false, reason: "You can't moderate yourself." };
    }

    if (
        moderatorMember.id !== guild.ownerId &&
        targetMember.roles.highest.position >= moderatorMember.roles.highest.position
    ) {
        return { ok: false, reason: "You can't moderate someone with an equal or higher role than you." };
    }

    const botMember = guild.members.me;
    if (targetMember.roles.highest.position >= botMember.roles.highest.position) {
        return { ok: false, reason: "My role is too low to moderate this member. Move my role above theirs." };
    }

    return { ok: true };
}

module.exports = { hasModPermission, hasModRole, getModRoleIds, canModerateTarget };
