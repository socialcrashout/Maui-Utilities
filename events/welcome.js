const {
    ContainerBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
} = require('discord.js');

// ==== CONFIG ====
const WELCOME_CHANNEL_ID = '1471165462099394725';

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
                        `## 🌺 Welcome to Maui`,
                        `Welcome, **${member}**! We're excited to have you here at **Maui**. ` +
                        `Whether you're here to explore our utilities, get support, ` +
                        `or become part of our team, Maui is here to make your experience simpler and more efficient. ` +
                        `We're glad to have you with us!`,
                    ].join('\n')
                )
            )

            // Getting started section
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    [
                        `## 🌴 **Your journey starts here**`,
                        `• Take a moment to explore our **<#1471165462099394721>** channels and learn more about Maui.`,
                        `• Customize your experience by checking out **<id:customize>** and selecting the roles you'd like.`,
                        `• Stay in the loop with our latest announcements, updates, and information through **<#1471166873675632641>**.`,
                        `• Most importantly, have fun, get involved, and enjoy everything Maui has to offer!`,
                    ].join('\n')
                )
            )

            // Banner image (below the text)
            .addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL(
                        'https://yumi.onl/api/files/6a8220f7e05519a35d292650/raw'
                    )
                )
            );

        await channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
        });
    },
};