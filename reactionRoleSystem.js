const {
    ActionRowBuilder,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
} = require('discord.js');

const BANNER_URL = 'https://yumi.onl/api/files/6ac19af2d0d74f85e45dd88a/raw';
const SELECT_ID = 'maui:notification-roles';

// Edit role names, descriptions, emojis, and IDs here.
const ROLES = [
    { key: 'chat', id: '1472059287273734228', label: 'Chat Revive', emoji: '💬', description: 'Get notified when the community needs a chat revive.' },
    { key: 'promo', id: '1472059319481532436', label: 'Promotion Notifications', emoji: '📈', description: 'Get notified about promotions and ranking opportunities.' },
    { key: 'session', id: '1472059583894655058', label: 'Session Notifications', emoji: '🎮', description: 'Get notified about upcoming sessions, trainings, and in-game activities.' },
    { key: 'engage', id: '1472059532216893565', label: 'Engagement Notifications', emoji: '🤝', description: 'Get notified about community activities and engagement opportunities.' },
    { key: 'dev', id: '1472059394089947146', label: 'Development Notifications', emoji: '🛠️', description: 'Get notified about game updates, development progress, and new features.' },
    { key: 'aware', id: '1484717225276342342', label: 'Awareness Notifications', emoji: '📢', description: 'Get notified about important notices, reminders, and community-wide updates.' },
    { key: 'events', id: '1484920890029244526', label: 'Events Notifications', emoji: '🎉', description: 'Get notified about upcoming events, celebrations, and activities.' },
    { key: 'affiliates', id: '1485974696427126854', label: 'Affiliate Notifications', emoji: '🌐', description: 'Get notified about affiliate updates, partnerships, and related announcements.' },
];

function addText(container, content) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

function addSeparator(container) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
}

function makePanel() {
    const container = new ContainerBuilder()
        .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(BANNER_URL)
        ));

    addSeparator(container);
    addText(container, [
        '# <:maui:1556034121271214141> | **Notification Roles**',
        '',
        '<:summerpopsiclestick:1511371881817702450> **Stay connected with everything happening around Maui!**',
        '',
        '<:white_reply:1502959530663870534> Want to stay updated without receiving notifications you do not care about? Customize your preferences by selecting roles from the **dropdown menu below**.',
    ].join('\n'));

    addSeparator(container);
    addText(container, [
        '### <:summerkite:1511401136693710898> How It Works',
        '<:s_dot:1556066525776187515> Open the **dropdown menu** to view available notification roles.',
        '<:s_dot:1556066525776187515> Select the roles you would like to receive. You can select **multiple roles** at once.',
        '<:s_dot:1556066525776187515> To remove a role, select it again. You can change your preferences **at any time**.',
    ].join('\n'));

    addSeparator(container);
    addText(container, '### <:summerpopsiclestick:1511371881817702450> Available Notifications');
    for (const role of ROLES) {
        addText(container, `${role.emoji} **${role.label}**\n${role.description}`);
        addSeparator(container);
    }

    addText(container, [
        '### <:summerbeachball:1511372875259576500> Please Note',
        '<:s_dot:1556066525776187515> Notification roles are **completely optional**.',
        '<:s_dot:1556066525776187515> You will only receive notifications for the roles you select.',
        '<:s_dot:1556066525776187515> Your notification roles can be updated whenever you would like.',
        '',
        '<:Star6Green:1491343265658835067> **Use the dropdown below to customize your notification preferences!**',
    ].join('\n'));

    const select = new StringSelectMenuBuilder()
        .setCustomId(SELECT_ID)
        .setPlaceholder('Choose notification roles')
        .setMinValues(1)
        .setMaxValues(ROLES.length)
        .addOptions(ROLES.map(role => ({
            label: role.label,
            description: role.description,
            value: role.key,
            emoji: role.emoji,
        })));

    container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
    return container;
}

function ephemeralStatus(heading, description) {
    const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ${heading}\n${description}`)
    );
    return {
        components: [container],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    };
}

async function sendPanel(message) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return message.reply('You need the Manage Roles permission to post the notification role panel.');
    }

    const missingRoles = ROLES.filter(role => !message.guild.roles.cache.has(role.id));
    if (missingRoles.length) {
        return message.reply(`I could not find these configured roles: ${missingRoles.map(role => role.label).join(', ')}.`);
    }

    await message.channel.send({
        components: [makePanel()],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
    });
    return message.reply('Notification role panel posted.');
}

async function handleInteraction(interaction) {
    if (!interaction.isStringSelectMenu() || interaction.customId !== SELECT_ID) return false;
    if (!interaction.inGuild()) {
        return interaction.reply(ephemeralStatus('❌ Server only', 'Choose notification roles inside the Maui server.'));
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });

    const chosen = interaction.values.map(key => ROLES.find(role => role.key === key)).filter(Boolean);
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
    if (!member || !botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.editReply(ephemeralStatus('❌ Could not update roles', 'The bot needs the Manage Roles permission to manage notification roles.'));
    }

    const added = [];
    const removed = [];
    const failed = [];
    for (const configuredRole of chosen) {
        const role = await interaction.guild.roles.fetch(configuredRole.id).catch(() => null);
        if (!role || role.managed || role.position >= botMember.roles.highest.position) {
            failed.push(configuredRole.label);
            continue;
        }

        try {
            if (member.roles.cache.has(role.id)) {
                await member.roles.remove(role, 'Member toggled notification role off');
                removed.push(role.name);
            } else {
                await member.roles.add(role, 'Member selected a notification role');
                added.push(role.name);
            }
        } catch (error) {
            console.error(`Could not toggle notification role ${role.id} for ${member.id}:`, error);
            failed.push(role.name);
        }
    }

    const lines = [];
    if (added.length) lines.push(`✅ Added: ${added.map(name => `**${name}**`).join(', ')}`);
    if (removed.length) lines.push(`↩️ Removed: ${removed.map(name => `**${name}**`).join(', ')}`);
    if (failed.length) lines.push(`⚠️ Could not update: ${failed.map(name => `**${name}**`).join(', ')}. Check the bot’s role permissions and role order.`);
    if (!lines.length) lines.push('No roles were changed.');

    return interaction.editReply(ephemeralStatus('🔔 Notification roles updated', lines.join('\n')));
}

module.exports = { sendPanel, handleInteraction, makePanel, roles: ROLES };
