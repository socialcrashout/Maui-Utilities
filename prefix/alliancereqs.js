const { ContainerBuilder, MessageFlags, PermissionFlagsBits, TextDisplayBuilder } = require('discord.js');

const PRD_ROLE_ID = '1484374236243038351';

function makeRequirementsMessage(userId) {
    const content = [
        '## <:maui:1556034121271214141> | **Affiliate Requirements**',
        `-# <@${userId}>`,
        '',
        'Interested in partnering with **Maui**? Before submitting an affiliate request, please make sure your organization meets **all of the requirements** listed below.',
        '',
        '<:summerpopsiclestick:1511371881817702450> **Requirements**',
        '',
        '<:s_dot:1556066525776187515> Your **Roblox group must have at least 400 members**.',
        '<:s_dot:1556066525776187515> Your **Discord server must have at least 350 members**, excluding bots.',
        '<:s_dot:1556066525776187515> Your Discord server must be **organized and easy to navigate**.',
        '<:s_dot:1556066525776187515> Your server must maintain a **professional appearance** and overall presentation.',
        '<:s_dot:1556066525776187515> Your organization must be willing to **follow and comply with Maui’s Terms of Service and Public Relations Department guidelines**.',
        '<:s_dot:1556066525776187515> Your organization must have **at least two representatives** available to communicate with our Public Relations Department.',
        '<:s_dot:1556066525776187515> Your organization must meet **all requirements listed above** before submitting an affiliate request.',
        '',
        '<:Star6Green:1491343265658835067> **Please ensure your organization meets every requirement before applying. Failure to meet the requirements may result in your affiliate request being denied.**',
    ].join('\n');

    return new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(content)
    );
}

module.exports = {
    name: 'alliancereqs',
    description: 'Send the affiliate requirements and mention a user',
    async execute(message) {
        const canPost = message.member?.permissions.has(PermissionFlagsBits.Administrator) ||
            message.member?.roles.cache.has(PRD_ROLE_ID);
        if (!canPost) return message.reply('Only the Public Relations Department can use this command.');

        const target = message.mentions.users.first();
        if (!target) return message.reply('Usage: `-alliancereqs @user`');

        await message.channel.send({
            components: [makeRequirementsMessage(target.id)],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { users: [target.id] },
        });
        await message.delete().catch(error => {
            console.warn('Could not delete the -alliancereqs command message:', error.message);
        });
    },
};
