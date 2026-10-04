const { Events } = require('discord.js');
const reactionRoleSystem = require('../reactionRoleSystem');

module.exports = {
    name: Events.InteractionCreate,
    once: false,
    async execute(interaction) {
        return reactionRoleSystem.handleInteraction(interaction);
    },
};
