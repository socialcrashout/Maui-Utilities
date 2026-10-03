const {
    entersState,
    joinVoiceChannel,
    VoiceConnectionStatus,
} = require('@discordjs/voice');

const VOICE_CHANNEL_ID = '1517224370463047820';
let connection = null;
let shutdownHandlersRegistered = false;

function leaveVoiceChannel() {
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
    }
    connection = null;
}

function registerShutdownHandlers(client) {
    if (shutdownHandlersRegistered) return;
    shutdownHandlersRegistered = true;

    const shutdown = signal => {
        console.log(`Received ${signal}; leaving the voice channel.`);
        leaveVoiceChannel();
        client.destroy();
        process.exit(0);
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
}

async function joinIdleVoiceChannel(client) {
    const channel = await client.channels.fetch(VOICE_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isVoiceBased()) {
        throw new Error(`Voice channel ${VOICE_CHANNEL_ID} was not found or is not a voice channel.`);
    }
    if (!channel.joinable) {
        throw new Error(`The bot cannot join ${channel.name}; check its View Channel and Connect permissions.`);
    }

    leaveVoiceChannel();
    connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: true,
    });
    connection.on('error', error => console.error('Voice connection error:', error));
    connection.on(VoiceConnectionStatus.Ready, () => {
        console.log(`Joined voice channel: ${channel.name}`);
    });

    registerShutdownHandlers(client);

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch (error) {
        leaveVoiceChannel();
        throw new Error(`Could not connect to voice channel ${VOICE_CHANNEL_ID}: ${error.message}`);
    }
}

module.exports = { joinIdleVoiceChannel, leaveVoiceChannel };
