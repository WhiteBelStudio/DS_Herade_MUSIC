# DS_Herade_MUSIC

Discord music bot for the Herade server.

## Requirements

- Node.js 22 (recommended)
- npm
- A Discord bot with the required permissions and intents
- Pterodactyl Node.js egg/container

## Configuration

Create a private `.env` file in the application directory using `.env.example`:

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID`

Never commit `.env` or publish your bot token.

## Local run

```bash
npm install
npm start
```

Syntax check:

```bash
npm test
```

## Pterodactyl: update from GitHub on every startup

Set the server working directory to `/home/container` and use this Startup Command:

```bash
bash -lc 'set -euo pipefail; cd /home/container; curl -fsSL https://github.com/WhiteBelStudio/DS_Herade_MUSIC/archive/refs/heads/main.tar.gz -o .music-source.tar.gz; tar -xzf .music-source.tar.gz --strip-components=1; rm -f .music-source.tar.gz; npm install --omit=dev; npm start
```

This downloads the latest `main` source directly into `/home/container` on every startup. Existing files not included in the GitHub archive (including `.env` and `node_modules`) are not removed. Keep secrets in the Pterodactyl `.env` file and never commit them.

## Notes

- Configure the bot token and IDs in `.env` on Pterodactyl, not in GitHub.
- The bot currently has server/channel IDs configured in source. Confirm these match your Discord server before deployment.
- Music provider availability depends on upstream provider changes and the installed ZiPlayer plugins.
