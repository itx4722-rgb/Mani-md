# Mini Mani — Private WhatsApp Test Bot

A starter project containing:
- A dark, premium-style pairing dashboard
- Password-protected panel
- Phone-number pairing-code request
- Status monitor
- Basic `!menu`, `!ping`, `!alive`, `!about`, and `!owner` commands
- Local session persistence in `auth_info/`

## Important version note

This project pins `baileys@7.0.0-rc14`, the latest release candidate found when this starter was prepared. It is **not a final stable release** and v7 includes breaking changes. If the API changes or pairing fails, check the official release notes:
https://github.com/WhiskeySockets/Baileys/releases

Official project: https://github.com/WhiskeySockets/Baileys

## Requirements

- Node.js 20 or newer
- A private server/hosting panel that supports a persistent Node.js process
- Your own WhatsApp account to link

## Run locally

1. Extract the ZIP.
2. Copy `.env.example` to `.env`.
3. Set `PANEL_PASSWORD` to a long private password (at least 12 characters).
4. Set `SESSION_SECRET` to a random string of at least 32 characters.
5. Install dependencies and start:

   ```bash
   npm install
   npm start
   ```

6. Open `http://localhost:3000`.
7. Log in with the `PANEL_PASSWORD` you configured.
8. Enter your WhatsApp phone number with country code, digits only.
9. In WhatsApp, open **Linked devices → Link a device → Link with phone number**, then enter the code shown by the panel.

## Wispbyte / hosting panel

- Upload and extract the project.
- Use Node.js 20+.
- Run `npm install` as the install command.
- Run `npm start` as the startup command.
- Add the environment variables from `.env.example` in the hosting panel. Do not upload `.env` to a public GitHub repository.
- Use the host-provided port if it sets `PORT`.
- Keep the web panel private. Do not share the panel password, pairing code, `.env`, or `auth_info/`.

## Security and reliability

- This is a **single-owner test starter**, not a multi-user public pairing service.
- Use HTTPS when hosting publicly; set `NODE_ENV=production` behind HTTPS so the session cookie is secure.
- Express's default in-memory session store is intended only for testing/small single-process deployments. Use a proper session store before production use.
- Pairing codes are sensitive: enter them only in your own WhatsApp app.
- Baileys is an unofficial community library and is not affiliated with WhatsApp/Meta. Excessive automation or unsolicited messaging can lead to account restrictions.
- The first connection and reconnect behavior should be tested on your hosting environment. No code can guarantee WhatsApp will never change its protocol or disconnect sessions.

## Commands

| Command | What it does |
|---|---|
| `!menu` | List commands |
| `!ping` | Reply with Pong |
| `!alive` | Show online state and process uptime |
| `!about` | Show bot information |
| `!owner` | Show Mani's contact link |

Commands also accept `.` as the prefix, e.g. `.ping`.

## Troubleshooting

- **No pairing code:** check server logs and ensure Node.js 20+; then confirm the package installed successfully.
- **Pairing code rejected:** wait briefly, request a fresh code, and use the latest WhatsApp app. Do not request repeatedly; this starter enforces a 30-second cooldown.
- **Bot reconnects repeatedly:** inspect the hosting logs and official Baileys release notes.
- **Website won't open:** make sure the hosting panel exposes the port assigned in `PORT`.
