require('dotenv').config({ override: true });

const net = require('net');
const { Client, GatewayIntentBits, Collection, REST, Routes, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { connectDB } = require('./db');
const ticketSystem = require('./ticketSystem');
const { startRobloxGroupCounter } = require('./robloxGroupCounter');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID, PREFIX } = process.env;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
    ]
});

client.commands = new Collection();
client.slashCommands = new Collection();

// ---------- Single-instance lock (stops duplicate local copies) ----------
const LOCK_PORT = 47831; // any free local port; change if something else uses it

function acquireInstanceLock() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', err => {
            if (err.code === 'EADDRINUSE') {
                reject(new Error(
                    'Another copy of this bot is already running on this computer. ' +
                    'Stop it (debug session, other terminal, pkill -f node) and try again.'
                ));
            } else {
                reject(err);
            }
        });
        server.listen(LOCK_PORT, '127.0.0.1', () => resolve(server));
    });
}

// ---------- Loaders ----------
function requireCommand(filePath) {
    try {
        const resolved = require.resolve(filePath);
        if (require.cache[resolved]) delete require.cache[resolved];
        return require(filePath);
    } catch (err) {
        console.error(`failed to load file @ ${filePath}`, err);
        return null;
    }
}

function loadPrefixCommands() {
    client.commands.clear();
    const commandPath = path.join(__dirname, 'prefix');
    if (!fs.existsSync(commandPath)) return;

    const files = fs.readdirSync(commandPath).filter(f => f.endsWith('.js'));
    for (const file of files) {
        const command = requireCommand(path.join(commandPath, file));
        if (command && command.name && command.execute) {
            client.commands.set(command.name, command);
        }
    }
    for (const command of ticketSystem.prefixCommands) client.commands.set(command.name, command);
    console.log(`loaded ${client.commands.size} prefix commands successfully.`);
}

function loadSlashCommands() {
    client.slashCommands.clear();
    const slashPath = path.join(__dirname, 'commands');
    if (!fs.existsSync(slashPath)) return [];

    const files = fs.readdirSync(slashPath).filter(f => f.endsWith('.js'));
    const slashData = [];
    for (const file of files) {
        const command = requireCommand(path.join(slashPath, file));
        if (command && command.data && command.execute) {
            client.slashCommands.set(command.data.name, command);
            slashData.push(command.data.toJSON());
        }
    }
    console.log(`Loaded ${client.slashCommands.size} slash commands.`);
    return slashData;
}

let eventsLoaded = false;
function loadEvents() {
    if (eventsLoaded) return; // never register event files twice
    eventsLoaded = true;

    const eventsPath = path.join(__dirname, 'events');
    if (!fs.existsSync(eventsPath)) return;

    const files = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));
    for (const file of files) {
        const event = requireCommand(path.join(eventsPath, file));
        if (!event || !event.name || !event.execute) continue;

        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client));
        } else {
            client.on(event.name, (...args) => event.execute(...args, client));
        }
    }
    console.log('Loaded events from /events folder.');
}

async function deploySlashCommands() {
    if (!DISCORD_TOKEN || !CLIENT_ID) {
        return console.error('Cannot deploy commands: Missing DISCORD_TOKEN or CLIENT_ID in .env');
    }

    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    const commands = loadSlashCommands();

    try {
        console.log('Deploying slash commands...');
        const route = GUILD_ID
            ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
            : Routes.applicationCommands(CLIENT_ID);

        await rest.put(route, { body: commands });
        console.log('Slash commands successfully deployed.');
    } catch (err) {
        console.error('Error deploying slash commands:', err);
    }
}

// ---------- Startup ----------
async function start() {
    await acquireInstanceLock();

    if (process.env.MONGO_URI && process.env.SKIP_DB !== 'true') {
        client.db = await connectDB();
    } else {
        if (process.env.SKIP_DB === 'true') console.warn('SKIP_DB=true; skipping DB connection.');
        else console.warn('MONGO_URI not set; skipping DB connection.');
        client.db = null;
    }

    loadPrefixCommands();
    loadEvents();
    await deploySlashCommands();

    if (DISCORD_TOKEN) {
        await client.login(DISCORD_TOKEN);
    } else {
        console.warn('DISCORD_TOKEN not set; skipping Discord login (smoke test mode).');
    }
}

client.once(Events.ClientReady, c => {
    console.log(`Logged in as ${c.user.tag} (PID ${process.pid})`);
    startRobloxGroupCounter(c);
    ticketSystem.syncOpenTicketPermissions(c).catch(err => {
        console.error('Failed to sync open ticket permissions:', err);
    });
});

// ---------- Prefix commands ----------
const handledMessages = new Set();

client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !PREFIX || !message.content.startsWith(PREFIX)) return;

    // Dedupe: never handle the same message twice in this process
    if (handledMessages.has(message.id)) return;
    handledMessages.add(message.id);
    setTimeout(() => handledMessages.delete(message.id), 60_000);

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    const command = client.commands.get(commandName);
    if (!command) return;

    try {
        await command.execute(message, args, client);
    } catch (err) {
        console.error(`Error running prefix command ${commandName}:`, err);
        message.reply('There was an error executing that command.').catch(console.error);
    }
});

// ---------- Slash commands ----------
client.on(Events.InteractionCreate, async interaction => {
    const ticketHandled = await ticketSystem.handleInteraction(interaction).catch(err => {
        console.error('Error handling ticket interaction:', err);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            return interaction.reply({ content: 'There was a problem handling that ticket action.', flags: 64 }).then(() => true).catch(() => true);
        }
        return true;
    });
    if (ticketHandled) return;
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'sync') {
        loadPrefixCommands();
        return interaction.reply({
            content: `Reloaded ${client.commands.size} prefix commands.`,
            ephemeral: true
        });
    }

    if (commandName === 'deploy') {
        await interaction.deferReply({ ephemeral: true });
        await deploySlashCommands();
        return interaction.editReply('Slash commands deployed.');
    }

    const command = client.slashCommands.get(commandName);
    if (!command) return;

    try {
        await command.execute(interaction, client);
    } catch (err) {
        console.error(`Error running slash command ${commandName}:`, err);

        const errorMessage = 'An error occurred while executing this command.';
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content: errorMessage }).catch(console.error);
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true }).catch(console.error);
        }
    }
});

// ---------- Member count channel ----------
const MEMBER_COUNT_CHANNEL_ID = 'u can change this if u want'; // put a real channel ID here

async function updateMemberCount(guild) {
    if (!/^\d{17,20}$/.test(MEMBER_COUNT_CHANNEL_ID)) return; // skip until a real ID is set
    try {
        const channel = await guild.channels.fetch(MEMBER_COUNT_CHANNEL_ID).catch(() => null);
        if (!channel) return;
        await channel.setName(`👥 Members: ${guild.memberCount}`);
    } catch (err) {
        console.error('Failed to update member count channel:', err);
    }
}

client.on(Events.GuildMemberAdd, member => updateMemberCount(member.guild));
client.on(Events.GuildMemberRemove, member => updateMemberCount(member.guild));

// ---------- Safety nets ----------
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

start().catch(err => {
    console.error('❌ Startup failed:', err.message);
    process.exit(1);
});
