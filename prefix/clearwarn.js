const { hasModPermission } = require('../utils/permissions');
const { performClearWarn } = require('../utils/modCore');
const { quickContainer, containerPayload } = require('../utils/modContainer');
const { resolveUser } = require('../utils/resolveTarget');

module.exports = {
    name: 'clearwarn',
    description: 'Clear one warning. Usage: clearwarn @user <warning_id_or_number>',

    async execute(message, args, client) {
        if (!hasModPermission(message.member)) {
            return message.reply(containerPayload(quickContainer('❌ Missing Permissions', "You don't have permission to clear warnings.")));
        }

        const targetUser = await resolveUser(client, args[0]);
        const ref = args[1];

        if (!targetUser || !ref) {
            return message.reply(containerPayload(quickContainer('❌ Invalid Usage', 'Usage: `clearwarn @user <warning_id_or_number>` — get the number from `modlogs @user`')));
        }

        const result = await performClearWarn({
            guild: message.guild,
            moderator: message.member,
            targetUser,
            ref,
            client
        });

        if (!result.ok) {
            return message.reply(containerPayload(quickContainer('❌ Clear Failed', result.reason)));
        }

        return message.channel.send(result.payload);
    }
};