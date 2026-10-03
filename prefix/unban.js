const { hasModPermission } = require('../utils/permissions');
const { performUnban } = require('../utils/modCore');
const { quickContainer, containerPayload } = require('../utils/modContainer');
const { extractId } = require('../utils/resolveTarget');

module.exports = {
    name: 'unban',
    description: 'Unban a user by ID. Usage: unban <id>',

    async execute(message, args, client) {
        if (!hasModPermission(message.member)) {
            return message.reply(containerPayload(quickContainer('❌ Missing Permissions', "You don't have permission to unban members.")));
        }

        const targetId = extractId(args[0]);
        if (!targetId) {
            return message.reply(containerPayload(quickContainer('❌ Invalid ID', 'Usage: `unban <user_id>`')));
        }

        const result = await performUnban({
            guild: message.guild,
            moderator: message.member,
            targetId,
            client
        });

        if (!result.ok) {
            return message.reply(containerPayload(quickContainer('❌ Unban Failed', result.reason)));
        }

        return message.channel.send(result.payload);
    }
};