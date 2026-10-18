const { hasModPermission } = require('../utils/permissions');
const { performBan } = require('../utils/modCore');
const { quickContainer, containerPayload } = require('../utils/modContainer');
const { resolveMember, resolveUser, extractId } = require('../utils/resolveTarget');

module.exports = {
    name: 'ban',
    description: 'Ban a user by mention or ID, even if they are not in the server. Usage: ban @user|id [reason]',

    async execute(message, args, client) {
        if (!hasModPermission(message.member)) {
            return message.reply(containerPayload(quickContainer('<:lastupdated:1554330566244171836> Missing Permissions', "You don't have permission to ban members.")));
        }

        const id = extractId(args[0]);
        if (!id) {
            return message.reply(containerPayload(quickContainer('<:lastupdated:1554330566244171836> Invalid User', 'Usage: `ban @user|id [reason]`')));
        }

        // Member is null if they aren't in the server, which is fine
        const targetMember = await resolveMember(message, id).catch(() => null);
        const targetUser = targetMember ? targetMember.user : await resolveUser(client, id).catch(() => null);

        if (!targetUser) {
            return message.reply(containerPayload(quickContainer('<:lastupdated:1554330566244171836> User Not Found', "Couldn't find a Discord user with that ID.")));
        }

        const reason = args.slice(1).join(' ') || 'No reason provided';

        const result = await performBan({
            guild: message.guild,
            moderator: message.member,
            targetMember,
            targetUser,
            reason,
            client
        });

        if (!result.ok) {
            return message.reply(containerPayload(quickContainer('<:lastupdated:1554330566244171836> Ban Failed', result.reason)));
        }

        return message.channel.send(result.payload);
    }
};