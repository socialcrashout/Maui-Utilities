const { hasModPermission } = require('../utils/permissions');
const { performKick } = require('../utils/modCore');
const { quickContainer, containerPayload } = require('../utils/modContainer');
const { resolveMember } = require('../utils/resolveTarget');

module.exports = {
    name: 'kick',
    description: 'Kick a member. Usage: kick @user [reason]',

    async execute(message, args, client) {
        if (!hasModPermission(message.member)) {
            return message.reply(containerPayload(quickContainer('❌ Missing Permissions', "You don't have permission to kick members.")));
        }

        const targetMember = await resolveMember(message, args[0]);
        if (!targetMember) {
            return message.reply(containerPayload(quickContainer('❌ User Not Found', 'Usage: `kick @user [reason]`')));
        }

        const reason = args.slice(1).join(' ') || 'No reason provided';

        const result = await performKick({
            guild: message.guild,
            moderator: message.member,
            targetMember,
            reason,
            client
        });

        if (!result.ok) {
            return message.reply(containerPayload(quickContainer('❌ Kick Failed', result.reason)));
        }

        return message.channel.send(result.payload);
    }
};