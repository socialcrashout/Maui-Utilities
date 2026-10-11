const {
    ContainerBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
} = require('discord.js');

// ==== CONFIG ====
const WELCOME_CHANNEL_ID = '1558527153719738508';

module.exports = {
    name: 'guildMemberAdd',
    once: false,
    async execute(member) {
        const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
        if (!channel) return;

        const container = new ContainerBuilder()
            // no .setAccentColor() call = no accent color bar

            // Title + intro text
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    [
                        `## <:cutecoolstars:1417853805482999930>  **Welcome to Scoops!**`,
                        `Welcome, **${member}**! We're so glad to have you join **Scoops**! 💗 ` +
                        `Whether you're here to be part of our community, explore our game, ` +
                        `meet new people, or find opportunities to join our team, we're excited to have you here. ` +
                        `We hope you'll feel right at home and enjoy everything Scoops has to offer!`,
                    ].join('\n')
                )
            )

            // Getting started section
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    [
                        `### <:vanillacupckake:1404329184750469180>**Getting Started at Scoops**`,
                        `• Explore our ** <#1400847772244115506>** channels to learn more about our community and what we offer.`,
                        `• Head over to ** <#1406354181002104872>** to select your preferred roles and personalize your experience.`,
                        `• Check out ** <#1558525058815754400>** regularly to stay informed about the latest news and updates.`,
                        `• Looking to join our team? Keep an eye out for upcoming applications and available positions!`,
                        `• Most importantly, connect with others, get involved, and have fun being part of the **Scoops** community! 💗`,
                    ].join('\n')
                )
            )

            // Banner image (below the text)
            .addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL(
                        'https://yumi.onl/api/files/6ac164c95ec612542f6d95fd/raw'
                    )
                )
            );

        await channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
        });
    },
};