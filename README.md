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

Set the server's working directory to `/home/container` and use this Startup Command:

```bash
bash -lc 'set -euo pipefail
APP=/home/container/app
STAGE=/home/container/.music-stage
ARCHIVE=/home/container/.music-source.tar.gz
mkdir -p /home/container
curl -fsSL https://github.com/WhiteBelStudio/DS_Herade_MUSIC/archive/refs/heads/main.tar.gz -o "$ARCHIVE"
rm -rf "$STAGE"
mkdir -p "$STAGE"
tar -xzf "$ARCHIVE" --strip-components=1 -C "$STAGE"
rm -f "$ARCHIVE"
if [ -f "$APP/.env" ]; then cp "$APP/.env" "$STAGE/.env"; elif [ -f /home/container/.env ]; then cp /home/container/.env "$STAGE/.env"; fi
cd "$STAGE"
npm install --omit=dev
rm -rf "$APP"
mv "$STAGE" "$APP"
cd "$APP"
npm start'
```

This fetches the latest `main` branch before each start, stages the archive before replacing the app directory, and carries over the existing `.env`. Keep any persistent data outside `/home/container/app`, because the app directory is replaced on startup.

## Notes

- Configure the bot token and IDs in `.env` on Pterodactyl, not in GitHub.
- The bot currently has server/channel IDs configured in source. Confirm these match your Discord server before deployment.
- Music provider availability depends on upstream provider changes and the installed ZiPlayer plugins.
