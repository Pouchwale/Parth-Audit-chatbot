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

1. You speak or type. A voice recording is turned into text on the server (Groq Whisper), and the request goes to the assistant.
2. The server gives the model the request plus the connector's allowed actions as tools.
3. **Read** actions run immediately, and the model uses the results.
4. **Write** actions never run straight away. The server stores the exact call and the app shows a confirmation card, which is also read aloud. The summary on the card is built by the server from the call's inputs, not written by the model.
5. You confirm, either by tapping or by saying "confirm" or "cancel". The server then runs exactly the stored call, once, as you, and the model tells you in plain language what happened.

Every action is logged, including proposed changes that were cancelled.

Replies stream in as they are written, with each lookup and each confirmation card shown in place, the way a chat assistant shows its work. You can stop a reply part-way, and retry one that failed or was stopped.

## Conversations

Each person sees their own conversations in the app's history, named with a short title the assistant writes from the first request. They can rename and delete them.

Conversations hold copies of data read from connected systems, so they are deleted 30 days after their last message (`CONVERSATION_RETENTION_DAYS` in `server/.env`). Deleting a conversation, by hand or after that time, never removes anything from the action log.

### Sharing a conversation

When someone has a problem, they press **Share** on a conversation and it downloads to their device as a Markdown file (on a phone, the share sheet opens so they can save or send it). The server writes the file, so what is recorded is exactly what was handed out. It starts with who exported it, the date and time with the weekday and year in their time zone (and in UTC), an export ID and the conversation ID, then has every message in order with its time: what the person wrote, the assistant's replies, each lookup, and each proposed change with its status and the decision. The footer repeats the export ID and says that every export is recorded.

**Every download is recorded**: who, from which device and IP address, when, the file's SHA-256 fingerprint, and the full file itself. These records are the audit trail for data leaving the system, so they are kept for good: deleting a conversation, deleting all of them, or the 30-day clean-up never removes them. A copy of a file that turns up somewhere can be traced by the export ID printed in it, or by its fingerprint. The same goes for files from connected systems (see below).

## Attachments and files

**Attaching.** People can attach photos, files and whole folders to a message: up to 20 files, each up to 20 MB (`FILE_MAX_MB`). The app uploads each one as soon as it is picked (`POST /assistant/files`, the raw bytes with the file's type), and sends the message with their ids. The server takes photos (JPEG, PNG, WebP, GIF, HEIC), PDF, Word (.docx), Excel (.xlsx, and .xls, which it keeps but can't read), CSV, text, Markdown and JSON files, and turns away anything else.

The server reads each file once, when it arrives, and the assistant gets what it read as text, marked as the file's content and never as instructions:

- PDF, Word and Excel files have their text taken out in a separate worker thread, a few at a time and capped in time and memory (a Word or Excel file is unpacked with a cap first, whatever sizes it claims), so a damaged or hostile file can't hold up the server. CSV, text, Markdown and JSON files are read as UTF-8 or UTF-16. Up to 100,000 characters are kept. The assistant is given up to 20,000 characters of each file and `FILE_TEXT_CHARS` across the whole conversation (16,000 by default, sized for Groq's free tier), newest message first, so the files just sent are always readable and older ones make way for them; it is told when a file was cut short or left out. The saved history holds only the files' ids, so a conversation with files never outgrows the model's limits by itself, and one that still does is told so plainly.
- Photos are described once by Groq's vision model (`GROQ_VISION_MODEL`, `qwen/qwen3.8-27b`, the only Groq model that takes images): any text in them word for word, then what they show. The chat models can't take images at all, so they only ever get this description. On the free tier Groq reads only about 3 images a minute; a photo it was too busy for is tried once more when the message is sent, and otherwise the assistant says it couldn't see it. A picture the model turns down for good (damaged, or not really an image) is not sent again. HEIC photos and images over 7 MB can't be read by it; the app should send JPEG.

Files hold copies of business data, so they are deleted with their conversation (by hand, or after `CONVERSATION_RETENTION_DAYS`), and an upload that was never sent with a message is deleted after a day.

**Files from connected systems.** An action can hand the person files, such as a report. Ask the demo "I want the daily pest control report": the assistant asks which day, then fetches the report, and the person sees it as a card with **Open**, **Download** and **Share** (on a phone, Share opens the share sheet with WhatsApp, Gmail and the rest). Every time such a file leaves the server it is recorded, like a conversation download: who, what for (opened, downloaded or shared), when, from which device, IP address and time zone, the file's fingerprint, and a copy of exactly what was handed out. A person's own uploads aren't recorded when they get them back, since they came from their device.

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
4. Ask for "the daily pest control report". The assistant asks which day, then hands you a sample report as a PDF to open, download or share. Attach a photo and ask it to attach the photo to F-102 as evidence.
5. Sign out, then sign in as `admin` with password `admin`. Open the menu at the top left and choose **Accounts** for the super admin view: each account, the devices it's signed in on, and what it last did.

Voice input in a browser needs a secure address: it works at http://localhost, but not at your computer's network address over plain http (use Expo Go on a phone for that). Demo data resets when you restart. If the app says it can't reach the assistant server, the server isn't running: start it again with `npm run demo`. The message shows the address the app tried.

### Real mode

Fill in `server/.env` (copy it from `server/.env.example`):

- `CREDENTIALS_KEY`: generate one with the command given in the file.
- `SUPER_ADMINS`: DCRS usernames that can open the super admin view.
- `GROQ_API_KEY`: create one at https://console.groq.com/keys.
- `DCRS_BASE_URL`: the DCRS API's base URL.

Then run `npm run dev`. In development the server uses an embedded Postgres (PGlite) stored in `server/.data/`, so no database setup is needed. In production, set `DATABASE_URL` to a Postgres connection string. Migrations run automatically when the server starts.

### On a phone

Your phone and computer need to be on the same Wi-Fi. The app finds the server on its own: it uses port 3000 on the computer that runs Expo. The first time the server starts, Windows may ask whether Node.js can use the network; choose **Allow** for private networks, or the phone can't reach it. You only need `EXPO_PUBLIC_API_URL` (see `mobile/.env.example`) when the server lives somewhere else, such as in production.

- **Expo Go:** run `npm run demo` (or `npm run dev`) and scan the QR code it shows in the terminal. Everything works there, voice included: the app records you, the server turns the recording into text, and replies can be read aloud. No development build is needed.

### Tests

The tests run the real server against an in-memory database, a fake connected system, a scripted model and a fake image reader. They cover sign-in logging, sessions, the confirmation rules (nothing runs until confirmed, and a confirmed change runs exactly once), streamed replies (including stopping and retrying one), conversation history and titles, voice transcription, attachments (reading real PDF, Word, Excel and text files made in the test, and what the model is given), files from connected systems, sharing conversations and files and the download records, weekly reports (including week boundaries in another time zone), the demo's pest control report, and the super admin view.

## Connectors

Each connected system is a connector: a **small, explicit list of allowed actions**. The model can only call those actions, and the server checks every call against the list and the action's input schema before anything runs. No other access to the system exists.

An action declares:

- `name` and `description`: tells the model what the action does and when to use it.
- `kind`: `read` runs immediately. `write` always needs the person's confirmation.
- `input`: a zod schema, validated on the server.
- `describe(input, ctx)`: the plain sentence shown on the confirmation card and in the audit log.
- `run(ctx, input)`: calls the system with the signed-in person's own credentials.

An action that hands the person files, such as a report, returns `withFiles(result, files)`: the server keeps each file in the conversation, shows it as a card to open, download or share, and tells the model it's there. Through `ctx.files.get(fileId)` an action (and its `describe`) can use the files in the conversation it runs in, such as a photo the person attached, and no others.

A connector can also list a few `examples`, short requests people can try, which the app shows on its welcome screen.

**Adding a system** means adding `server/src/connectors/<id>/index.ts` and listing it in `server/src/connectors/index.ts`. The agent, the confirmation flow, logging and the admin view pick it up automatically.

People sign in with their DCRS account. The server checks the credentials with DCRS and keeps the resulting DCRS sign-in encrypted with that device's session, so every action runs with that person's own DCRS permissions.

## Login and action logs, super admin view

- **Every sign-in attempt** is recorded, successful or not, with the IP address, user agent and device (name, model, OS and version, app version).
- **Each signed-in device** is a session. The server tracks its last IP and when it was last seen. A device that signs in again replaces its old session.
- **Every action** is recorded: lookups, proposed changes, confirmations, cancellations and failures, along with what the person said.
- **Every message** a person sends is counted (not its text), so the weekly numbers stay right after conversations are deleted.
- **Every download** of a conversation, and every time a file from a connected system is opened, downloaded or shared, is recorded with the file itself (see [Sharing a conversation](#sharing-a-conversation) and [Attachments and files](#attachments-and-files)).
- **Super admins** (set by `SUPER_ADMINS`) see every account in the app: where it's signed in right now, what it last did, its recent actions and sign-ins. They can also sign a device out.

### Security dashboard

Only super admins can open it (**Security** in the menu). Opening it isn't recorded, and nothing in it holds a session token or password.

- **Downloads**: every conversation download and every file from a connected system that was opened, downloaded or shared, newest first, with the person, the conversation's title at the time, the system a file came from, the date, weekday, time and year, the device, IP address and size. Search by export ID, fingerprint (the whole of it, or its first 12 or more characters), title, file name, system or name, and filter by person and period. Each download shows everything recorded about it, including exactly what was downloaded: a conversation's text, or for a file the copy kept with the record. Opening that copy is itself recorded, as the super admin opening the file.
- **Weekly reports**: for each week, what each person did: sign-ins (and failed ones), devices, messages and the files attached to them, lookups, changes confirmed, cancelled or failed, and downloads with the conversations' titles and the names of the files from connected systems. The week in progress is live. Once a week ends its report is stored and never changes afterwards; the server stores it within 15 minutes of the week ending, or when someone opens it first. The numbers come only from the logs, never from conversations, which their owners can delete.

Weeks run from Monday 00:00 to Sunday 24:00 in `REPORT_TIME_ZONE` (in `server/.env`, an IANA time zone such as `Asia/Kolkata`; `UTC` when unset). A date without a time in the Downloads filters means that whole day in the same time zone.

Behind a reverse proxy, set `TRUST_PROXY` so the logs record the real client IP.

## Model

The agent runs on Groq using `openai/gpt-oss-120b` with `medium` reasoning effort and a low temperature, which Groq recommends for reliable tool calls. If Groq rejects a malformed tool call, the request is retried once. In testing each step took 0.5 to 1.3 seconds, which suits voice. Change the model or effort in `server/.env`. The key's other chat models are `openai/gpt-oss-20b` (faster) and `qwen/qwen3.8-27b` (preview).

Three smaller jobs use their own models: `openai/gpt-oss-20b` titles new conversations (`GROQ_TITLE_MODEL`), `whisper-large-v3-turbo` turns voice recordings into text (`GROQ_TRANSCRIPTION_MODEL`), and `qwen/qwen3.8-27b` describes attached photos (`GROQ_VISION_MODEL`; about 3 images a minute on the free tier, see [Attachments and files](#attachments-and-files)).

Every request to Groq uses the shared API key's quota, so each person is limited:
- **Chat:** 20 requests a minute across all their devices, counting messages, confirmations and retries, and at most 3 running at once.
- **Voice:** 30 transcriptions a minute per device, up to 15 MB each.
- **Files:** 60 uploads and 60 downloads a minute across all their devices.

Going over a limit returns "Too many attempts. Wait a minute and try again."

## Status

- Done: the server, logging, super admin view, agent with confirmations, and the mobile app. Try them with `npm run demo`.
- Waiting on details: the DCRS connector. Its sign-in and its list of allowed actions will be built from the real DCRS API once the base URL and a test account are available. Until then, `npm run server` can't sign anyone in.
