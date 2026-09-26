# Audit Assistant

A mobile voice and chat assistant. You say or type a request in plain language, and the assistant carries it out in a connected system in one turn. It looks things up straight away, and before it changes anything it shows you exactly what will change and waits for you to confirm.

The first connected system is the Digital Controlled Record System (DCRS). The assistant uses it only through its HTTP API.

## How a request flows

```
phone app ──► assistant server ──► Groq model (decides which allowed action fits)
 (voice/text)        │
                     ├─► lookups run immediately
                     └─► changes are held ──► app shows the exact change ──► you confirm ──► runs once
```

1. You speak (on-device speech-to-text) or type. The app sends the text to the server.
2. The server gives the model the request plus the connector's allowed actions as tools.
3. **Read** actions run immediately, and the model uses the results.
4. **Write** actions never run straight away. The server stores the exact call and the app shows a confirmation card, which is also read aloud. The summary on the card is built by the server from the call's inputs, not written by the model.
5. You confirm, either by tapping or by saying "confirm" or "cancel". The server then runs exactly the stored call, once, as you, and the model tells you in plain language what happened.

Every action is logged, including proposed changes that were cancelled.

## Repository layout

| Path | What |
|---|---|
| `mobile/` | Expo (React Native) app: sign-in, voice and text assistant, super admin screens |
| `server/` | Node + TypeScript API: sessions, login and action logs, connectors, agent |
| `shared/api.ts` | The HTTP contract, as types shared by the app and the server |

## Run and check it

You need Node 24 or later, and a Groq API key in `server/.env` (`GROQ_API_KEY=...`; see `server/.env.example`). Run every command from the project folder.

| Command | What it does |
|---|---|
| `npm run setup` | Installs the server's and the app's packages. Run it once, and again after pulling changes. |
| `npm test` | Runs the backend tests. |
| `npm run typecheck` | Type-checks the server and the app. |
| `npm run demo` | Starts the server with sample data (instead of DCRS) **and** the app, then opens the app in your browser at http://localhost:8081. Keep the window open, and press Ctrl+C to stop both. |
| `npm run dev` | The same, but with the real server, once the DCRS connector is set up. |
| `npm run server` / `npm run app` | Just the real server, or just the app. |

**Trying it in demo mode:** run `npm run demo` and wait for the browser to open. If it doesn't open, go to http://localhost:8081 yourself. Then:

1. Sign in as `demo` with password `demo`. The eye button shows the password as you type it.
2. Ask "What findings are still open?". The assistant looks them up straight away.
3. Say or type "Close F-101, the pallets were moved". A confirmation card shows exactly what will change, and nothing happens until you tap **Confirm** or say "confirm".
4. Sign out, then sign in as `admin` with password `admin`. The people icon at the top opens the super admin view: each account, the devices it's signed in on, and what it last did.

Voice input in the browser needs Chrome, and demo data resets when you restart. If the app says it can't reach the assistant server, the server isn't running: start it again with `npm run demo`. The message shows the address the app tried.

### Real mode

Fill in `server/.env` (copy it from `server/.env.example`):

- `CREDENTIALS_KEY`: generate one with the command given in the file.
- `SUPER_ADMINS`: DCRS usernames that can open the super admin view.
- `GROQ_API_KEY`: create one at https://console.groq.com/keys.
- `DCRS_BASE_URL`: the DCRS API's base URL.

Then run `npm run dev`. In development the server uses an embedded Postgres (PGlite) stored in `server/.data/`, so no database setup is needed. In production, set `DATABASE_URL` to a Postgres connection string. Migrations run automatically when the server starts.

### On a phone

Your phone and computer need to be on the same Wi-Fi. The app finds the server on its own: it uses port 3000 on the computer that runs Expo. The first time the server starts, Windows may ask whether Node.js can use the network; choose **Allow** for private networks, or the phone can't reach it. You only need `EXPO_PUBLIC_API_URL` (see `mobile/.env.example`) when the server lives somewhere else, such as in production.

- **Expo Go:** run `npm run demo` (or `npm run dev`) and scan the QR code it shows in the terminal. The app runs text-only there, and replies are still read aloud.
- **With voice:** speech recognition needs a development build, because Expo Go doesn't include it. Run `npx expo run:android` inside `mobile/` (needs Android Studio), or build in the cloud with EAS (`npx eas build --profile development`), which also works for iOS without a Mac.

### Tests

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

The agent runs on Groq using `openai/gpt-oss-120b` with `medium` reasoning effort and a low temperature, which Groq recommends for reliable tool calls. If Groq rejects a malformed tool call, the request is retried once. In testing each step took 0.5 to 1.3 seconds, which suits voice. Change the model or effort in `server/.env`. The key's other chat models are `openai/gpt-oss-20b` (faster) and `qwen/qwen3.8-27b` (preview).

## Status

- Done: the server, logging, super admin view, agent with confirmations, and the mobile app. Try them with `npm run demo`.
- Waiting on details: the DCRS connector. Its sign-in and its list of allowed actions will be built from the real DCRS API once the base URL and a test account are available. Until then, `npm run server` can't sign anyone in.
