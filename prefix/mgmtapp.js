const { ContainerBuilder, MessageFlags, PermissionFlagsBits, TextDisplayBuilder } = require('discord.js');

const HR_ROLE_ID = '1484374059079958758';

function makeApplicationMessage(userId) {
    const content = [
        '## <:maui:1556034121271214141> | **Management Application**',
        `-# <@${userId}>`,
        '',
        '<:summerpopsiclestick:1511371881817702450> Thank you for showing interest in **applying for Management at Maui**! We appreciate your interest in becoming a part of our Management Team. Please fill out the format below with **honest and detailed answers** so our Human Resources Department can properly review your application.',
        '',
        '<:DropDown:1556077822534099016> **FORMAT TO FILL**',
        '```',
        '**Username**:',
        '**Why are you interested in joining Management?**:',
        '**What can you bring to Management?**:',
        '**Experience**:',
        '**Notes**:',
        '```',
        '',
        'Please make sure all information provided is **accurate and complete** before submitting your application. Good luck!',
    ].join('\n');

    return new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(content)
    );
}

module.exports = {
    name: 'mgmtapp',
    description: 'Send the management application format and mention a user',
    async execute(message) {
        const canPost = message.member?.permissions.has(PermissionFlagsBits.Administrator) ||
            message.member?.roles.cache.has(HR_ROLE_ID);
        if (!canPost) return message.reply('Only Human Resources can use this command.');

        const target = message.mentions.users.first();
        if (!target) return message.reply('Usage: `-mgmtapp @user`');

        await message.channel.send({
            components: [makeApplicationMessage(target.id)],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { users: [target.id] },
        });
        await message.delete().catch(error => {
            console.warn('Could not delete the -mgmtapp command message:', error.message);
        });
    },
};
