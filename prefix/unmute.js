const { hasModPermission } = require('../utils/permissions');
const { performUnmute } = require('../utils/modCore');
const { quickContainer, containerPayload } = require('../utils/modContainer');
const { resolveMember } = require('../utils/resolveTarget');

module.exports = {
    name: 'unmute',
    description: 'Remove a timeout. Usage: unmute @user',

    async execute(message, args, client) {
        if (!hasModPermission(message.member)) {
            return message.reply(containerPayload(quickContainer('❌ Missing Permissions', "You don't have permission to unmute members.")));
        }

        const targetMember = await resolveMember(message, args[0]);
        if (!targetMember) {
            return message.reply(containerPayload(quickContainer('❌ User Not Found', 'Usage: `unmute @user`')));
        }

        const result = await performUnmute({
            guild: message.guild,
            moderator: message.member,
            targetMember,
            client
        });

        if (!result.ok) {
            return message.reply(containerPayload(quickContainer('❌ Unmute Failed', result.reason)));
        }

        return message.channel.send(result.payload);
    }
};