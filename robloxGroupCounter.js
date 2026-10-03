// Roblox group member counter. This edits one status message in the configured channel.
const GROUP_ID = '377591137';
const CHANNEL_ID = '1550940155681050725';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const MARKER = `Roblox group ${GROUP_ID} member counter`;

let refreshTimer;

function makeCounterMessage(memberCount) {
    const nextGoal = (Math.floor(memberCount / 100) + 1) * 100;
    const remaining = nextGoal - memberCount;
    return [
        `🎉 We are now at **${memberCount.toLocaleString('en-US')} members!**`,
        `🎯 Next goal: **${nextGoal.toLocaleString('en-US')} members** — **${remaining.toLocaleString('en-US')} to go!**`,
        `-# ${MARKER} · goal advances by 100 members`,
    ].join('\n\n');
}

async function getMemberCount() {
    const endpoints = [
        `https://groups.roblox.com/v1/groups/${GROUP_ID}`,
        `https://groups.roblox.com/v2/groups?groupIds=${GROUP_ID}`,
    ];
    let lastError = 'Roblox did not include a member count in its response';

    for (const url of endpoints) {
        try {
            const response = await fetch(url, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(15_000),
            });
            const result = await response.json().catch(() => null);
            if (!response.ok) {
                lastError = `Roblox groups API returned HTTP ${response.status}`;
                continue;
            }

            const groups = Array.isArray(result?.data) ? result.data : [];
            const group = groups.find(item => String(item.id ?? item.group?.id) === GROUP_ID) || groups[0];
            const rawCount = result?.memberCount ?? group?.memberCount ?? group?.group?.memberCount;
            const memberCount = Number(rawCount);
            if (Number.isSafeInteger(memberCount) && memberCount >= 0) return memberCount;

            const responseFields = result && typeof result === 'object' ? Object.keys(result).join(', ') : 'non-JSON response';
            lastError = `Roblox response from ${new URL(url).pathname} had no usable memberCount (fields: ${responseFields})`;
        } catch (error) {
            lastError = error.message;
        }
    }

    throw new Error(`Unable to read member count for Roblox group ${GROUP_ID}: ${lastError}`);
}

async function updateRobloxGroupCounter(client) {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased() || !channel.messages) {
        throw new Error(`Member counter channel ${CHANNEL_ID} was not found or is not a text channel`);
    }

    const memberCount = await getMemberCount();
    const content = makeCounterMessage(memberCount);
    const recent = await channel.messages.fetch({ limit: 50 });
    const currentPost = recent.find(message => message.author.id === client.user.id && message.content.includes(MARKER));

    if (currentPost) {
        if (currentPost.content !== content) await currentPost.edit({ content, allowedMentions: { parse: [] } });
        return;
    }

    await channel.send({ content, allowedMentions: { parse: [] } });
}

function startRobloxGroupCounter(client) {
    if (refreshTimer) clearInterval(refreshTimer);
    const refresh = () => updateRobloxGroupCounter(client).catch(error => {
        console.error('Failed to update Roblox group member counter:', error.message);
    });

    refresh();
    refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
    refreshTimer.unref?.();
}

module.exports = { startRobloxGroupCounter, updateRobloxGroupCounter };
