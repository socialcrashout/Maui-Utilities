
const { hasModPermission } = require('../utils/permissions');
const { performMute } = require('../utils/modCore');
const { parseDuration } = require('../utils/duration');
const { quickContainer, containerPayload } = require('../utils/modContainer');
const { resolveMember } = require('../utils/resolveTarget');

module.exports = {
    name: 'mute',
    description: 'Timeout a member. Usage: mute @user <duration> [reason]',

    async execute(message, args, client) {
        if (!hasModPermission(message.member)) {
            return message.reply(containerPayload(quickContainer('❌ Missing Permissions', "You don't have permission to mute members.")));
        }

        const targetMember = await resolveMember(message, args[0]);
        if (!targetMember) {
            return message.reply(containerPayload(quickContainer('❌ User Not Found', 'Usage: `mute @user <duration> [reason]`')));
        }

        const ms = parseDuration(args[1]);
        if (!ms) {
            return message.reply(containerPayload(quickContainer('❌ Invalid Duration', 'Use a format like `10m`, `2h`, `1d`, or `1w` (max 28 days). Usage: `mute @user <duration> [reason]`')));
        }

        const reason = args.slice(2).join(' ') || 'No reason provided';

        const result = await performMute({
            guild: message.guild,
            moderator: message.member,
            targetMember,
            ms,
            reason,
            client
        });

        if (!result.ok) {
            return message.reply(containerPayload(quickContainer('❌ Mute Failed', result.reason)));
        }

        return message.channel.send(result.payload);
    }
};