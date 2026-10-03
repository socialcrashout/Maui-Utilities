const {
    ContainerBuilder,
    MessageFlags,
    TextDisplayBuilder,
} = require('discord.js');

const BOOST_THANKS_CHANNEL_ID = '1553468739272441926';

async function sendBoosterThanks(guild, user) {
    const channel = await guild.channels.fetch(BOOST_THANKS_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased()) {
        throw new Error(`Booster thank-you channel ${BOOST_THANKS_CHANNEL_ID} was not found or is not text-based.`);
    }

    const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `** <:maui:1556034121271214141> Thank You for Boosting!**\n\n` +
            `A huge thank you to <@${user.id}> for boosting **Maui**! Your support means so much to us and helps us continue growing, improving, and building a better community for everyone.  We truly appreciate you supporting **Maui**! 💛`
        )
    );

    return channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: [user.id] },
    });
}

module.exports = { BOOST_THANKS_CHANNEL_ID, sendBoosterThanks };
