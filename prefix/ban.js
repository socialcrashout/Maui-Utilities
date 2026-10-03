const { hasModPermission } = require('../utils/permissions');
const { performBan } = require('../utils/modCore');
const { quickContainer, containerPayload } = require('../utils/modContainer');
const { resolveMember, resolveUser, extractId } = require('../utils/resolveTarget');

module.exports = {
    name: 'ban',
    description: 'Ban a member. Usage: ban @user|id [reason]',

    async execute(message, args, client) {
        if (!hasModPermission(message.member)) {
            return message.reply(containerPayload(quickContainer('❌ Missing Permissions', "You don't have permission to ban members.")));
        }

        const id = extractId(args[0]);
        if (!id) {
            return message.reply(containerPayload(quickContainer('❌ Invalid User', 'Usage: `ban @user|id [reason]`')));
        }

        const targetMember = await resolveMember(message, args[0]);
        const targetUser = targetMember ? targetMember.user : await resolveUser(client, args[0]);

        if (!targetUser) {
            return message.reply(containerPayload(quickContainer('❌ User Not Found', "Couldn't find that user.")));
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
            return message.reply(containerPayload(quickContainer('❌ Ban Failed', result.reason)));
        }

        return message.channel.send(result.payload);
    }
};