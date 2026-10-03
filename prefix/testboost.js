const { PermissionFlagsBits } = require('discord.js');
const { BOOST_THANKS_CHANNEL_ID, sendBoosterThanks } = require('../utils/boosterThanker');

module.exports = {
    name: 'testboost',
    description: 'Preview the booster appreciation message',
    async execute(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('Only server administrators can run the booster preview.');
        }

        try {
            await sendBoosterThanks(message.guild, message.author);
            return message.reply(`Booster preview sent in <#${BOOST_THANKS_CHANNEL_ID}>.`);
        } catch (error) {
            console.error('Failed to send booster preview:', error);
            return message.reply(`Could not send the preview. Check that I can view and send messages in <#${BOOST_THANKS_CHANNEL_ID}>.`);
        }
    },
};
