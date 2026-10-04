const reactionRoleSystem = require('../reactionRoleSystem');

module.exports = {
    name: 'reaction',
    description: 'Post the notification role selection panel',
    async execute(message) {
        return reactionRoleSystem.sendPanel(message);
    },
};
