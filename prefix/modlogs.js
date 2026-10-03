const { hasModPermission } = require('../utils/permissions');
const { buildModLogsContainer } = require('../utils/modCore');
const { quickContainer, containerPayload } = require('../utils/modContainer');
const { resolveUser } = require('../utils/resolveTarget');

module.exports = {
    name: 'modlogs',
    description: "View a member's warnings and mod history. Usage: modlogs @user",

    async execute(message, args, client) {
        if (!hasModPermission(message.member)) {
            return message.reply(containerPayload(quickContainer('❌ Missing Permissions', "You don't have permission to view mod logs.")));
        }

        const targetUser = await resolveUser(client, args[0]);
        if (!targetUser) {
            return message.reply(containerPayload(quickContainer('❌ User Not Found', 'Usage: `modlogs @user`')));
        }

        const container = await buildModLogsContainer({ guild: message.guild, targetUser });

        return message.channel.send(containerPayload(container));
    }
};