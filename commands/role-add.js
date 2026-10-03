const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} = require('discord.js');
const { buildModContainer, containerPayload } = require('../utils/modcontainer');

function privatePayload(heading, description, rows = []) {
    const container = buildModContainer({ heading, description });
    return containerPayload(container, {
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [container, ...rows],
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('role-add')
        .setDescription('Give one role to everyone who has another selected role')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addRoleOption(option => option
            .setName('target_role')
            .setDescription('The role to give to matching members')
            .setRequired(true))
        .addRoleOption(option => option
            .setName('source_role')
            .setDescription('Give the target role to everyone who already has this role')
            .setRequired(true)),

    async execute(interaction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.reply(privatePayload('❌ Missing permission', 'You need the Manage Roles permission to use this command.'));
        }

        const guild = interaction.guild;
        if (!guild) {
            return interaction.reply(privatePayload('❌ Server only', 'Use this command inside a server.'));
        }
        const targetRole = interaction.options.getRole('target_role');
        const sourceRole = interaction.options.getRole('source_role');

        if (targetRole.id === guild.id || targetRole.managed) {
            return interaction.reply(privatePayload('❌ Role cannot be assigned', 'Choose a regular role that the bot is allowed to assign.'));
        }

        const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.reply(privatePayload('❌ Missing bot permission', 'Give the bot the Manage Roles permission, then try again.'));
        }
        if (targetRole.position >= botMember.roles.highest.position) {
            return interaction.reply(privatePayload('❌ Role is above my role', 'Move the bot’s highest role above the role you want to add, then try again.'));
        }

        const actor = await guild.members.fetch(interaction.user.id).catch(() => null);
        if (!actor) {
            return interaction.reply(privatePayload('❌ Could not verify your role', 'Please try the command again.'));
        }
        if (actor.id !== guild.ownerId && targetRole.position >= actor.roles.highest.position) {
            return interaction.reply(privatePayload('❌ Role is above your role', 'You can only assign roles below your highest role.'));
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });

        let members;
        try {
            members = await guild.members.fetch();
        } catch (error) {
            console.error('Could not fetch members for bulk role assignment:', error);
            return interaction.editReply(privatePayload(
                '❌ Could not load server members',
                'Make sure the bot has the Server Members intent enabled, then try again.'
            ));
        }

        const matchingMembers = members.filter(member =>
            !member.user.bot && member.roles.cache.has(sourceRole.id) && !member.roles.cache.has(targetRole.id)
        );

        if (!matchingMembers.size) {
            return interaction.editReply(privatePayload(
                'ℹ️ No members to update',
                `No members with **${sourceRole.name}** are missing **${targetRole.name}**.`
            ));
        }

        const customId = `maui:role-add:${interaction.id}`;
        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${customId}:confirm`)
                .setLabel(`Add role to ${matchingMembers.size}`)
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`${customId}:cancel`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        const description = `This will add **${targetRole.name}** to **${matchingMembers.size}** members who have **${sourceRole.name}**.\n\nConfirm within 60 seconds to continue.`;
        await interaction.editReply(privatePayload('🧾 Confirm bulk role assignment', description, [buttons]));

        const response = await interaction.fetchReply();
        let confirmation;
        try {
            confirmation = await response.awaitMessageComponent({
                time: 60_000,
                filter: button => button.user.id === interaction.user.id && button.customId.startsWith(customId),
            });
        } catch {
            return interaction.editReply(privatePayload('⌛ Confirmation expired', 'Run `/role-add` again when you are ready.'));
        }

        if (confirmation.customId.endsWith(':cancel')) {
            await confirmation.deferUpdate();
            return interaction.editReply(privatePayload('↩️ Role assignment cancelled', 'No members were changed.'));
        }

        await confirmation.deferUpdate();
        await interaction.editReply(privatePayload(
            '⏳ Adding role',
            `Adding **${targetRole.name}** to **${matchingMembers.size}** members…`
        ));

        let added = 0;
        let failed = 0;
        const targets = [...matchingMembers.values()];
        for (let index = 0; index < targets.length; index += 5) {
            const batch = targets.slice(index, index + 5);
            const results = await Promise.all(batch.map(member =>
                member.roles.add(targetRole, `Bulk role assignment by ${interaction.user.tag}`)
                    .then(() => true)
                    .catch(error => {
                        console.error(`Failed to add role ${targetRole.id} to member ${member.id}:`, error);
                        return false;
                    })
            ));
            added += results.filter(Boolean).length;
            failed += results.length - results.filter(Boolean).length;
        }

        const resultText = failed
            ? `✅ Added **${targetRole.name}** to **${added}** members.\n⚠️ Could not update **${failed}** members; check the bot’s role permissions and hierarchy.`
            : `✅ Added **${targetRole.name}** to all **${added}** matching members.`;
        return interaction.editReply(privatePayload('🌺 Bulk role assignment complete', resultText));
    },
};
