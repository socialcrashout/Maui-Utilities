const mongoose = require('mongoose');

const modLogSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    userTag: { type: String, default: 'Unknown' },
    moderatorId: { type: String, required: true },
    moderatorTag: { type: String, default: 'Unknown' },
    action: {
        type: String,
        required: true,
        enum: ['kick', 'ban', 'unban', 'mute', 'unmute', 'warn', 'clearwarn', 'clearwarns']
    },
    reason: { type: String, default: 'No reason provided' },
    duration: { type: String, default: null }, // human readable, only used for mute
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.ModLog || mongoose.model('ModLog', modLogSchema);