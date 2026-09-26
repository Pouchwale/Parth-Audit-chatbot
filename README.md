# Audit Assistant

A mobile voice and chat assistant. You say or type a request in plain language, and the assistant carries it out in a connected system in one turn. It looks things up straight away, and before it changes anything it shows you exactly what will change and waits for you to confirm.

The first connected system is the Digital Controlled Record System (DCRS). The assistant uses it only through its HTTP API.

## How a request flows

```
phone app ──► assistant server ──► Claude (decides which allowed action fits)
 (voice/text)        │
                     ├─► lookups run immediately
                     └─► changes are held ──► app shows the exact change ──► you confirm ──► runs once
```

1. You speak (on-device speech-to-text) or type. The app sends the text to the server.
2. The server gives Claude the request plus the connector's allowed actions as tools.
3. **Read** actions run immediately, and Claude uses the results.
4. **Write** actions never run straight away. The server stores the exact call and the app shows a confirmation card, which is also read aloud. The summary on the card is built by the server from the call's inputs, not written by the model.
5. You confirm, either by tapping or by saying "confirm" or "cancel". The server then runs exactly the stored call, once, as you, and Claude tells you in plain language what happened.

Every action is logged, including proposed changes that were cancelled.

## Repository layout

| Path | What |
|---|---|
| `mobile/` | Expo (React Native) app: sign-in, voice and text assistant, super admin screens |
| `server/` | Node + TypeScript API: sessions, login and action logs, connectors, agent |
| `shared/api.ts` | The HTTP contract, as types shared by the app and the server |

## Running it locally

You need Node 24 or later.

### Server

```bash
cd server
npm install
cp .env.example .env
```

Fill in `server/.env`:

- `CREDENTIALS_KEY`: generate one with the command given in the file.
- `SUPER_ADMINS`: DCRS usernames that can open the super admin view.
- `ANTHROPIC_API_KEY`: or sign in once with `ant auth login`.
- `DCRS_BASE_URL`: the DCRS API's base URL.

Then start the server:

```bash
npm run dev
```

In development the server uses an embedded Postgres (PGlite) stored in `server/.data/`, so no database setup is needed. In production, set `DATABASE_URL` to a Postgres connection string. Migrations run automatically when the server starts.

### App

```bash
cd mobile
npm install
cp .env.example .env.local
```

Set `EXPO_PUBLIC_API_URL` in `mobile/.env.local` to the server address as the phone sees it. On the same Wi-Fi, that's your computer's LAN IP, for example `http://192.168.1.20:3000`.

- **Browser (quickest check):** run `npm run web` inside `mobile/`. Voice input works in Chrome.
- **Phone with voice:** speech recognition needs a development build, because Expo Go doesn't include it. Run `npx expo run:android` (needs Android Studio), or build in the cloud with EAS (`npx eas build --profile development`), which works without a Mac for iOS too.
- **Expo Go:** the app runs text-only. Replies are still read aloud.

### Tests

```bash
cd server
npm test
```

The tests run the real server against an in-memory database, a fake connected system and a scripted model. They cover sign-in logging, sessions, the confirmation rules (nothing runs until confirmed, and a confirmed change runs exactly once), and the super admin view.

## Connectors

Each connected system is a connector: a **small, explicit list of allowed actions**. The model can only call those actions, and the server checks every call against the list and the action's input schema before anything runs. No other access to the system exists.

An action declares:

- `name` and `description`: tells the model what the action does and when to use it.
- `kind`: `read` runs immediately. `write` always needs the person's confirmation.
- `input`: a zod schema, validated on the server.
- `describe(input)`: the plain sentence shown on the confirmation card and in the audit log.
- `run(ctx, input)`: calls the system with the signed-in person's own credentials.

**Adding a system** means adding `server/src/connectors/<id>/index.ts` and listing it in `server/src/connectors/index.ts`. The agent, the confirmation flow, logging and the admin view pick it up automatically.

People sign in with their DCRS account. The server checks the credentials with DCRS and keeps the resulting DCRS sign-in encrypted with that device's session, so every action runs with that person's own DCRS permissions.

## Login and action logs, super admin view

- **Every sign-in attempt** is recorded, successful or not, with the IP address, user agent and device (name, model, OS and version, app version).
- **Each signed-in device** is a session. The server tracks its last IP and when it was last seen. A device that signs in again replaces its old session.
- **Every action** is recorded: lookups, proposed changes, confirmations, cancellations and failures, along with what the person said.
- **Super admins** (set by `SUPER_ADMINS`) see every account in the app: where it's signed in right now, what it last did, its recent actions and sign-ins. They can also sign a device out.

Behind a reverse proxy, set `TRUST_PROXY` so the logs record the real client IP.

## Model

The agent runs on Claude (`claude-opus-5` by default) with `medium` effort, which keeps voice replies quick. Server-side refusal fallback (`ANTHROPIC_FALLBACKS=default`) is on: if the model declines a request for policy reasons, the API retries it on Anthropic's recommended fallback model. Change these in `server/.env`.

## Status

- Done: the server, logging, super admin view, agent with confirmations, and the mobile app. These are tested against a fake connected system.
- Waiting on details: the DCRS connector. Its sign-in and its list of allowed actions will be built from the real DCRS API once the base URL and a test account are available. Until then, signing in returns "Couldn't reach Digital Controlled Record System".
