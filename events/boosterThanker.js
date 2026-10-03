const { Events } = require('discord.js');
const { sendBoosterThanks } = require('../utils/boosterThanker');

module.exports = {
    name: Events.GuildMemberUpdate,
    once: false,
    async execute(oldMember, newMember) {
        const startedBoosting = !oldMember.premiumSince && Boolean(newMember.premiumSince);
        if (!startedBoosting) return;

        try {
            await sendBoosterThanks(newMember.guild, newMember.user);
        } catch (error) {
            console.error('Failed to send booster thank-you:', error);
        }
    },
};
