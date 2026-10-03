const mongoose = require('mongoose');

const warningSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    moderatorId: { type: String, required: true },
    moderatorTag: { type: String, default: 'Unknown' },
    reason: { type: String, default: 'No reason provided' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Warning || mongoose.model('Warning', warningSchema);