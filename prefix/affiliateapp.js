const { ContainerBuilder, MessageFlags, PermissionFlagsBits, TextDisplayBuilder } = require('discord.js');

const PRD_ROLE_ID = '1484374236243038351';

function makeApplicationMessage(userId) {
    const content = [
        '## <:maui:1556034121271214141> | **Affiliate Request**',
        '',
        `Hello <@${userId}>,`,
        '',
        'Thank you for your interest in becoming an **affiliate of Maui**! We’re always looking to build strong, professional partnerships with organizations that share similar goals and values.',
        '',
        'Before submitting your request, please make sure your organization meets **all of Maui’s affiliate requirements**. Our Public Relations Department will carefully review your application based on your organization’s activity, professionalism, member count, presentation, and the information provided.',
        '',
        'Please provide **honest and detailed answers** to each question below. Incomplete or low-effort requests may be denied.',
        '',
        '### <:summerpopsiclestick:1511371881817702450> **Format to Be Filled**',
        '<:s_dot:1556066525776187515> **What is the name of your group?**',
        '<:s_dot:1556066525776187515> **What is the genre of your group?** *(e.g., Cafe, Clothing, Community, etc.)*',
        '<:s_dot:1556066525776187515> **How many members does your Roblox group have?**',
        '<:s_dot:1556066525776187515> **How many members does your Discord server have?** *(excluding bots)*',
        '<:s_dot:1556066525776187515> **How can Maui benefit your group?**',
        '<:s_dot:1556066525776187515> **How can your group benefit Maui?**',
        '<:s_dot:1556066525776187515> **Why does your group want to become an affiliate with Maui?**',
        '<:s_dot:1556066525776187515> **How will your group contribute to the partnership?**',
        '<:s_dot:1556066525776187515> **Who are your two representatives?**',
        '<:s_dot:1556066525776187515> **Is there any additional information that may strengthen your request?**',
        '<:s_dot:1556066525776187515> **Roblox Link:**',
        '<:s_dot:1556066525776187515> **Discord Link:**',
        '',
        '### <:summerpopsiclestick:1511371881817702450> **Please Note**',
        '<:s_dot:1556066525776187515> All affiliate requests are reviewed by the **Public Relations Department**.',
        '<:s_dot:1556066525776187515> Submitting a request does **not guarantee acceptance**, even if your organization meets the requirements.',
        '<:s_dot:1556066525776187515> Please remain **professional and respectful** throughout the review process.',
        '<:s_dot:1556066525776187515> If your request is denied, aggressive, disrespectful, or inappropriate remarks toward Maui or our staff **will not be tolerated** and may result in further action.',
        '<:s_dot:1556066525776187515> Please allow the **Public Relations Department** sufficient time to review your request before following up.',
        '',
        'Thank you for your interest in partnering with **Maui**. We look forward to reviewing your request!',
        '',
        '**Maui Public Relations Department**',
    ].join('\n');

    return new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(content)
    );
}

module.exports = {
    name: 'affiliateapp',
    description: 'Send the affiliate application format and mention a user',
    async execute(message) {
        const canPost = message.member?.permissions.has(PermissionFlagsBits.Administrator) ||
            message.member?.roles.cache.has(PRD_ROLE_ID);
        if (!canPost) return message.reply('Only the Public Relations Department can use this command.');

        const target = message.mentions.users.first();
        if (!target) return message.reply('Usage: `-affiliateapp @user`');

        await message.channel.send({
            components: [makeApplicationMessage(target.id)],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { users: [target.id] },
        });
        await message.delete().catch(error => {
            console.warn('Could not delete the -affiliateapp command message:', error.message);
        });
    },
};
