// Pulls a user ID out of a raw mention ("<@123>", "<@!123>") or plain ID string.
function extractId(raw) {
    if (!raw) return null;
    const mentionMatch = /^<@!?(\d+)>$/.exec(raw.trim());
    if (mentionMatch) return mentionMatch[1];
    if (/^\d{16,20}$/.test(raw.trim())) return raw.trim();
    return null;
}

// Resolves a GuildMember from a message's first arg. Returns null if not found/not in guild.
async function resolveMember(message, raw) {
    const id = extractId(raw);
    if (!id) return null;
    return message.guild.members.fetch(id).catch(() => null);
}

// Resolves a User (doesn't need to be in the guild) — used for ban/unban/clearwarn-by-id.
async function resolveUser(client, raw) {
    const id = extractId(raw);
    if (!id) return null;
    return client.users.fetch(id).catch(() => null);
}

module.exports = { extractId, resolveMember, resolveUser };