const { hasModPermission } = require('../utils/permissions');
const { performWarn } = require('../utils/modCore');
const { quickContainer, containerPayload } = require('../utils/modContainer');
const { resolveMember } = require('../utils/resolveTarget');

module.exports = {
    name: 'warn',
    description: 'Warn a member. Usage: warn @user <reason>',

    async execute(message, args, client) {
        if (!hasModPermission(message.member)) {
            return message.reply(containerPayload(quickContainer('❌ Missing Permissions', "You don't have permission to warn members.")));
        }

        const targetMember = await resolveMember(message, args[0]);
        if (!targetMember) {
            return message.reply(containerPayload(quickContainer('❌ User Not Found', 'Usage: `warn @user <reason>`')));
        }

        const reason = args.slice(1).join(' ');
        if (!reason) {
            return message.reply(containerPayload(quickContainer('❌ Reason Required', 'Usage: `warn @user <reason>`')));
        }

        const result = await performWarn({
            guild: message.guild,
            moderator: message.member,
            targetMember,
            reason,
            client
        });

        if (!result.ok) {
            return message.reply(containerPayload(quickContainer('❌ Warn Failed', result.reason)));
        }

        return message.channel.send(result.payload);
    }
};