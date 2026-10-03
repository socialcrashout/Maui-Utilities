const { MessageFlags } = require('discord.js');
const config = require('../config');
const loaManager = require('./loaManager');
const { buildContainer } = require('./loaEmbeds');
const { formatDate } = require('./dateFormat');

const CHECK_INTERVAL_MS = 60_000; // check once a minute

/**
 * Call this once with your client after it's ready.
 * Every minute it checks for LOAs whose duration has run out,
 * removes the LOA role, marks them expired, DMs the member, and logs it.
 */
function startLOAScheduler(client) {
  setInterval(async () => {
    const expired = loaManager.getAllExpiredActive();

    for (const record of expired) {
      try {
        const guild = await client.guilds.fetch(record.guildId).catch(() => null);
        if (!guild) continue;

        const member = await guild.members.fetch(record.userId).catch(() => null);
        if (member) {
          const role = await guild.roles.fetch(config.LOA_ROLE_ID).catch(() => null);
          if (role) await member.roles.remove(role).catch(() => {});
        }

        const updated = loaManager.endLOA(record.id, {
          endedBy: null,
          endReason: 'LOA duration expired',
          status: 'expired',
        });
        if (!updated) continue;

        if (member) {
          const dmContainer = buildContainer([
            '## LOA Ended',
            'Your Leave of Absence has ended — welcome back!',
            '---',
            `**Reason:** ${updated.reason}`,
            `**Start Date:** ${formatDate(updated.startTimestamp)}`,
            `**End Date:** ${formatDate(updated.actualEndTimestamp)}`,
          ]);
          await member.send({ components: [dmContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        const logChannel = await guild.channels.fetch(config.LOG_CHANNEL_ID).catch(() => null);
        if (logChannel) {
          const logContainer = buildContainer([
            '## Inactivity Ended (Expired)',
            `<@${record.userId}>'s Leave of Absence has ended automatically.`,
            '---',
            `**Reason:** ${updated.reason}`,
            `**Start Date:** ${formatDate(updated.startTimestamp)}`,
            `**End Date:** ${formatDate(updated.actualEndTimestamp)}`,
            `**Record ID:** \`${updated.id}\``,
          ]);
          await logChannel.send({
            components: [logContainer],
            flags: MessageFlags.IsComponentsV2,
          });
        }
      } catch (err) {
        console.error('[LOA] Error processing expired LOA:', err);
      }
    }
  }, CHECK_INTERVAL_MS);
}

module.exports = { startLOAScheduler };