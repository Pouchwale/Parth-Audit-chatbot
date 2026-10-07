# Mitra

Mitra is a mobile voice and chat assistant. You say or type a request in plain language, and the assistant carries it out in a connected system in one turn. It looks things up straight away, and before it changes anything it shows you exactly what will change and waits for you to confirm.

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
5. You confirm, either by tapping or by saying "confirm" or "cancel" (or "હા" or "ના", "हाँ" or "नहीं": see [Languages and the voice](#languages-and-the-voice)). The server then runs exactly the stored call, once, as you, and the model tells you in plain language what happened.

Every action is logged, including proposed changes that were cancelled.

Replies stream in as they are written, with each lookup and each confirmation card shown in place, the way a chat assistant shows its work. You can stop a reply part-way, retry one that failed or was stopped, and edit a message you sent (see [Editing a message](#editing-a-message)). When the model is busy, the stream says so and how long the wait is, instead of going quiet.

One model response can ask for several things at once: its lookups run together (four at a time), and its changes go on one confirmation card as numbered steps, confirmed with one tap and run in order; the run stops at the first step that fails and the card says exactly what was and was not done. Stop pressed while confirmed changes run ends only the reply's words: the changes the person confirmed still run, and the card says how each went (the server can't tell Stop from a phone losing its connection, and a confirmed set is not left half done for either). Groq's own table (console.groq.com/docs/tool-use) marks `openai/gpt-oss-120b` and `openai/gpt-oss-20b` as not supporting parallel tool use, so with the default model the saving comes from the next point, and the server is ready for a model that does send several calls at once. A record can be named by its document and day rather than its id ("today's F-QC-30"): the connector asks DCRS which record that is while describing the change, so the card names the document in full and no lookup is needed first, and "start today's F-QC-30 and fill it with sample data" is one model call and one card, where it was two calls and two cards.

## Languages and the voice

People at the plant speak and type English, Gujarati and Hindi: each in its own script, Gujarati and Hindi often in English letters too ("aaje nu record kholo", "aaj ka record kholo"), and often with English names mixed in. Mitra answers in the language and script it was asked in: Gujarati asked, Gujarati answered; the same for Hindi and English.

- **The rule.** The standing instructions (`server/src/agent/prompt.ts`) tell the model to understand all of these and to answer in the language and script of the person's latest message. A bare yes or no, or a tap on a card, keeps the conversation's language. In every language, numbers and dates keep the digits 0-9, and format numbers (F/QC/30), record ids, field keys and values stay exactly as DCRS gives them; in Gujarati or Hindi, a document's name may be followed by its English name in brackets the first time. The rule is the same for everyone, so the start of every request is still the same and Groq keeps reusing it. It added 629 characters to that start: 149 tokens as gpt-oss counts them (2,053 to 2,202).
- **What the server adds** (`server/src/agent/language.ts`). In the note that follows the instructions, the server says what it can tell for sure from the words: the script, or Gujarati and Hindi in English letters by their everyday little words ("Their latest message is in Gujarati, in Latin letters: answer in Gujarati, in Latin letters."). For a bare "ok" it looks back to the person's last message that has a language. English needs no line. The few sentences the server says itself are said in the same language: after a Gujarati request, a cancelled card's "Okay, I didn't change anything." is "ઠીક છે, મેં કંઈ બદલ્યું નથી."
- **Mitra replies in** (Settings, Language): "The language I write in" (the default), "English", "ગુજરાતી" or "हिन्दी". The app sends the choice with every message, edit, decision and retry as `replyLanguage` (`'auto' | 'en' | 'gu' | 'hi'`, `ReplyLanguage` in `shared/api.ts`); any other value is refused with 400 `invalid_request`. A fixed choice goes in the note too ("Reply language, chosen in the app's settings: Hindi, in Devanagari, whatever language they write in."). The sign-in and settings words stay English.
- **Answering a card by voice or by typing** (`mobile/src/lib/answer.ts`): "yes" and "no", "હા" and "ના", "હા જી", "ઠીક છે", "રહેવા દો", "हाँ" and "नहीं", "ठीक है", "मत करो", and the same in English letters ("ha", "haan ji", "nahi", "rehne do") answer the card that is waiting. Words that could mean either ("band karo", a bare "ji", "chalo") go to Mitra as a message instead.
- **Hearing Gujarati and Hindi** (`server/src/voice/transcriber.ts`). Whisper tells the language from the recording; none is forced. It is shown the plant, the words it must spell right and the three languages, each with a short request in its own script: "Mitra; Digital Controlled Record System, DCRS, Gujarat Print Pack, Mehsana, F/QC/30, F/HR/17, CAPA. English, Gujarati, Hindi: Open today's record. આજનો રેકોર્ડ ખોલો. आज का रिकॉर्ड खोलो." That is 123 tokens in Whisper's own tokenizer; Groq allows 224, and its guidelines say to "use the same language as the language of the audio file", which here can be any of the three. A connector lists its own such words (`spokenTerms`). The default model is now `whisper-large-v3` rather than the turbo: Groq's docs (console.groq.com/docs/speech-to-text) give it a word error rate of 10.3% against the turbo's 12% and advise it "if your application is error-sensitive and requires multilingual support", and the free plan's limits are the same for both. **A `server/.env` that sets `GROQ_TRANSCRIPTION_MODEL=whisper-large-v3-turbo` keeps the turbo: change it to `whisper-large-v3`, or remove the line.**
- **The welcome screen** shows one example in Gujarati and one in Hindi among its four (the DCRS connector's `examples`).

**The voice** (`mobile/src/lib/speech.ts`, with the rules in `speech-voice.ts`). Replies are read aloud with the phone's own voices, through expo-speech, which Expo Go includes:

- Each part of a reply is said by the voice of its own language, told from its script: Gujarati script by a gu-IN voice, Devanagari by a hi-IN voice, the rest by Indian English (en-IN), the accent staff hear every day. A Gujarati answer with an English card summary after it is said in two voices, one after the other. An English voice can't read Gujarati or Hindi letters, so they are never given to one.
- The voice is the best the device lists for that language (`Speech.getAvailableVoicesAsync()`, asked once a session): one that sounds like a person first (an iPhone's Premium and Enhanced voices, Android's Google voices, Edge's "Online (Natural)" voices, the browsers' Google voices), then any voice of the language. For English, Indian English comes first among equally good voices. Robotic voices (an iPhone's Eloquence and novelty voices, eSpeak) come last. Where a voice's name tells, a woman's voice is chosen, as DCRS's Mitra has by default, so Mitra sounds like the same person in each language; on Android, a voice on the phone comes before the same kind over the internet, since it works offline and starts at once. When the device can't list its voices, each part goes to the engine with its language tag, for the engine's own voice for it. A voice that fails to speak (Android can list a voice before its data is on the phone) is not chosen again that session: what it was to say goes to the next best voice of the same language, never to another language's.
- Rate 0.95 and pitch 1: a touch slower than the engines' everyday speed of 1, which is quick on a noisy shop floor and for someone listening in their second language. The pitch is left at the voice's own, because moving it is what makes a natural voice sound processed.
- The text is made for the ear first, as DCRS's Mitra says it: no markdown marks, "F/QC/30" as "F Q C 30", "2026-10-06" as "6th October" ("6 ઓક્ટોબર" in Gujarati, "6 अक्टूबर" in Hindi), "92%" as "92 percent" ("92 ટકા", "92 प्रतिशत"), a record's long id left out rather than spelled letter by letter, each list item a sentence with a pause after it, and a block of code not read out. The reply is read in pieces that end at sentence ends (the danda too), each piece when the last has ended.
- When the device has no voice at all for a language (Chrome has no Gujarati voice, and an iPhone may have none), those words are shown and not read, and a line under the reply says so, once a session: "No Gujarati voice on this phone, so the Gujarati isn't read aloud. You can add one in the phone's text-to-speech settings." (on Android). Tapping **Read aloud** on such a reply says it again, under that reply.

What only real phones can show: how each phone's voices actually sound, which voices each phone has (Android's Gujarati and Hindi voices come with Google's speech engine once their voice data is installed; whether an iPhone has a Gujarati voice depends on its iOS), what Android does with a voice whose data is not installed yet (an error, which moves the words to the next voice, or a wait while it downloads), and how well Whisper hears Gujarati and Hindi spoken on the shop floor.

## Conversations

Each person sees their own conversations in the app's history, named with a short title the assistant writes from the first request. They can rename and delete them.

Conversations hold copies of data read from connected systems, so they are deleted 30 days after their last message (`CONVERSATION_RETENTION_DAYS` in `server/.env`). Deleting a conversation, by hand or after that time, never removes anything from the action log.

### Editing a message

A person can change the words of a message they sent: `POST /assistant/conversations/:conversationId/messages/:messageId/edit` with `{ text, timeZone?, stream?, attachments? }` (`EditMessageRequest` in `shared/api.ts`). Everything after that message leaves the conversation: the reply, later messages, their lookups, files and confirmation cards. A confirmation still waiting is cancelled first, so it can never be confirmed afterwards. The message keeps its id and its files (unless `attachments` lists the files it now carries; `[]` takes them all off), gets the new words and an `editedAt` time, and the turn runs again exactly as a new message does, answering the same way: one JSON `AssistantReply`, or the same stream, whose `start` event carries the edited message as saved. It is refused with 404 `message_not_found` (no such message of the person's in that conversation; another person's conversation is 404 `conversation_not_found` as everywhere), 409 `conversation_busy` while a reply in it is still being written, and 400 `invalid_request` for no words or more than 4,000.

What was already done is never undone or rewritten: a change made in DCRS stays made, and the action log, the download records, the weekly reports and the admin's views keep every action with the words that asked for it at the time. Only the conversation, which its owner can also delete, changes. It keeps its title, even when its first message is the one changed: the person may have chosen the title, and can rename it. `server/test/edit.test.ts` proves each of these.

In the app, every message the person sent has **Copy** and a pen (**Edit**) under it, and a long press still copies it. The pen turns the bubble into an editor holding the words, with Cancel and Save. Save is off while the words are empty, unchanged or over 4,000 characters, and while Mitra is answering; the pen itself is off while Mitra answers, and says "Mitra is still answering. Stop it or wait, then edit." when tapped. When the replies being replaced made changes in DCRS, the editor says once: "Changes already made in DCRS stay as they are." Saving shows the new words at once with everything after them gone, and streams the new reply; an edited message says "Edited" under it. If the server never took the change (a reply still being written there, the message gone, no connection), the conversation is put back exactly as it was, a message that had failed to send before it included, and the editor opens again on the words typed, saying why they weren't saved: Save tries again, Cancel drops them. The words typed are kept outside the editor, so they survive the message being scrolled far out of view and back, and the keyboard opens only when the pen is tapped. When the keyboard opens (or the window gets shorter), the editor is brought down to just above it; when the whole editor can't fit above the keyboard (a phone on its side), its top is shown, where the words are, and Save is back in view once the keyboard closes. The note about changes in DCRS appears as soon as a change after the message runs, even with the editor already open, and the "still answering" hint goes as soon as Mitra has finished. Android's back button closes the editor only while the chat is the screen in front (not with Settings, another chat or the menu over it), and Escape closes it in a browser. The parts: `mobile/src/components/chat/UserBubble.tsx`, `MessageEditor.tsx`, and `openEditor()`, `edit()` and the editor's state in `mobile/src/lib/chat-session.ts`.

While the assistant's model is busy and the server waits to ask again (the `status` stream events), the reply shows a calm line where the thinking dots go: "The AI service is busy. Continuing in 12 s", counting down, which goes when the reply resumes (`WaitingLine.tsx`).

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

## Fast on low-end phones

The chat is drawn so that a reply streaming in costs as little as it can on a slow phone, measured in the web build in headless Chromium at 6x CPU throttling (see the numbers below):

- A row of the conversation is drawn from its own message and the chat's controls (`ChatControls`, a context that changes when a request starts or ends, a card becomes answerable, reading aloud starts or an editor opens), not from the screen's render. So while a reply streams in, only the row whose message changed is drawn again; the list's row renderer and the composer stay the same.
- Markdown is drawn block by block (`markdown-blocks.ts`). A block ends only where markdown starts afresh: at a blank line followed by a line at the left margin that does not carry a list on. So a list keeps everything indented under its items (paragraphs, nested lists, code), a code fence runs to its closing fence, and text with a link definition or a line of HTML is kept whole, as is the rest of a list once a code fence appears inside it. Each block is parsed on its own and kept while its words stay the same, so a reply streaming in parses and draws only the block being written, and a finished reply is never parsed again when something else on the screen changes. `server/test/markdown-blocks.test.ts` checks the splitting, and that 400 made-up replies, and every stage of each as it streams in, read exactly as marked (the app's own copy) reads them whole.
- Streamed text reaches the screen in batches of at least 50 ms; after a slow draw the next batch waits twice as long as the draw took, up to 400 ms, so the screen stays free to scroll and type between them (`chat-session.ts`).
- The list draws the screen and two screens either side (`windowSize` 5, ten rows at first, five a batch), and measures the newest row only while the person has scrolled up to read, since a browser lays the page out again for every measurement. It measures with a sensor laid over the row and drawn only then: the browser build of React Native starts watching a view's size only when the view is first drawn, so a size handler given later to a row already on screen would never be called, and the place would be lost.
- Every component and hook of the app compiles under the React Compiler (`experiments.reactCompiler` in `app.json`), so values and elements are reused between renders by default. A hook with `try … finally`, or one that reads a ref while rendering, is skipped by the compiler and then returns a new object every render, which drags everything it is passed to along: `voice.ts`, `attachments.ts`, `share.ts`, `chat-sessions.tsx`, `conversations.tsx` and `downloads.ts` are written so that the compiler takes them. To check which functions the compiler skips, run `babel-plugin-react-compiler` over `src` with its `logger` option and look for `CompileError` events.
- In browsers with CSS `field-sizing` (Chromium-based ones), the message boxes grow with their text by themselves; elsewhere the app sets their height from the box's reported content size, which costs a layout on every keystroke (`auto-size.ts`).

Measured on 6 October 2026 (production web build, headless Chromium, 390x844, 6x CPU throttling; the app as it was before this work against the app now, runs interleaved on the same busy PC, so single runs vary by half; medians): opening a 200-message conversation from the drawer took 762 ms → 424 ms, its worst task 448 ms → 202 ms, and the drawer with 100 conversations opened in 376 ms → 234 ms (three runs each); the 6,000-character "long" reply streaming in had 37 tasks over 50 ms → 8 (8 → 4 over 100 ms, 1,311 ms → 681 ms blocked in all), the worst still at the start, where the new chat moves to its own screen (393 ms → 298 ms); scrolling fast through the 200 messages (24 turns of the wheel, four runs each) had 0 to 7 tasks over 50 ms → 0 to 4, its worst frame gap 67–183 ms → 33–83 ms; and typing in the composer on screen with them open painted in a median 35.5 ms → 33.5 ms from key to paint, and one key in ten took over 113 ms → over 43 ms (five runs each of 60 keys, typing measured alone). The web bundle is 1.8 MB in 1,071 modules. What `npm run phones` serves Expo Go in production mode is 7.7 MB of JavaScript in 2,023 modules for Android and 7.4 MB in 1,940 modules for iPhones; `expo export` makes the same app 3.4 MB and 3.3 MB.

Route modules load with the app rather than on first use. Expo can split a web build into one chunk per route (`extra.router.asyncRoutes` on for web): the admin, security, settings and viewer screens then leave the first load, about 140 KB of 1.77 MB. It was tried and left off: in that build the drawer never reached its open position in the automated check and the flow's drawer steps failed, and the phones never run the web build. Expo Go in production has one bundle in any case; what each screen needs is required when it is first drawn.

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
| `npm run phones` | The app for phones in Expo Go, on port 8081, at this computer's address on the company network (see [On a phone](#on-a-phone)). |

**Trying it in demo mode:** run `npm run demo` and wait for the browser to open. If it doesn't open, go to http://localhost:8081 yourself. Then:

1. Sign in as `demo` with password `demo`. The eye button shows the password as you type it.
2. Ask "What findings are still open?". The assistant looks them up straight away.
3. Say or type "Close F-101, the pallets were moved". A confirmation card shows exactly what will change, and nothing happens until you tap **Confirm** or say "confirm".
4. Ask for "the daily pest control report". The assistant asks which day, then hands you a sample report as a PDF to open, download or share. Attach a photo and ask it to attach the photo to F-102 as evidence.
5. Sign out, then sign in as `admin` with password `admin`. Open the menu at the top left and choose **Accounts** for the super admin view: each account, the devices it's signed in on, and what it last did.

Voice input in a browser needs a secure address: it works at http://localhost, but not at your computer's network address over plain http (use Expo Go on a phone for that). Demo data resets when you restart. If the app says it can't reach its server, the server isn't running: start it again with `npm run demo`. The message shows the address the app tried.

### Real mode

Fill in `server/.env` (copy it from `server/.env.example`):

- `CREDENTIALS_KEY`: generate one with the command given in the file.
- `SUPER_ADMINS`: more DCRS usernames that can open the super admin view. DCRS's own super admin (role "admin" in DCRS's answer at each sign-in) can open it without being listed.
- `GROQ_API_KEY`: create one at https://console.groq.com/keys.
- `DCRS_BASE_URL`: the DCRS API's base URL.

Then run `npm run dev`. In development the server uses an embedded Postgres (PGlite) stored in `server/.data/`, so no database setup is needed. In production, set `DATABASE_URL` to a Postgres connection string. Migrations run automatically when the server starts.

### On a phone

People use Mitra in **Expo Go**, Expo's free app: from the Play Store on Android phones, and the App Store on iPhones. Nothing else is installed or built: no APK, no TestFlight. The app is on Expo SDK 57, which is what Expo Go from both stores opens (Expo Go 57.0.9, 2 September 2026). Expo Go opens one SDK, the latest. When Expo releases the next SDK, the stores' Expo Go moves to it, and the app must be upgraded with `npx expo install expo@^<that SDK>.0.0 --fix`, then `npx expo install --fix` and `npx expo-doctor`, before phones update Expo Go.

**On the computer that runs the Mitra server** (the plant's server PC):

1. Connect it to the company network the phones use. Its Wi-Fi address is in `ipconfig`, under "Wireless LAN adapter Wi-Fi", "IPv4 Address", for example 192.168.0.107.
2. Start the Mitra server: `npm --prefix server start` (port 3000, on every network card: `HOST` is 0.0.0.0 unless set).
3. Start the app for the phones: `npm run phones`, in its own window, and keep it open. It runs `expo start --lan --port 8081 --no-dev --minify` in `mobile/` (production mode: smaller and faster on the phones) and prints a QR code for `exp://<address>:8081`. The address is the Wi-Fi card's. To choose another, set it first, in PowerShell `$env:REACT_NATIVE_PACKAGER_HOSTNAME = "192.168.0.107"`. Expo itself would pick the card with the default route, which on a PC with a cable as well, or a WSL adapter, is often not the one the phones reach. `npm run phones -- --dev` runs it in development mode instead, which reloads when the code changes and shows errors on the phone.
4. Let the phones in: Windows Firewall must allow ports 3000 and 8081 in. The first time each starts, Windows asks whether Node.js may use the network: tick the kind of network the PC is on and choose **Allow**. A company network should be set to **Private** (Settings, Network & internet, the connection, Network profile type). Alternatively, an administrator can open the two ports in PowerShell: `New-NetFirewallRule -DisplayName "Mitra (3000, 8081)" -Direction Inbound -Protocol TCP -LocalPort 3000,8081 -Action Allow -Profile Private,Domain`.

**On each phone:** install Expo Go, join the company Wi-Fi, and scan the QR code: with Expo Go's **Scan QR code** on Android, with the Camera app on an iPhone. Mitra opens in Expo Go; next time it is under **Recently opened** in Expo Go.

- **iPhone, local network.** Expo Go asks to "find and connect to devices on your local network" the first time. Tap **Allow**: without it the phone can reach neither Expo nor the Mitra server. To change it later: Settings, Privacy & Security, Local Network, Expo Go.
- **Microphone and camera.** In Expo Go these are Expo Go's permissions, asked for Expo Go (on an iPhone in its words, "Allow Expo projects to access your microphone"). Allow them for voice and for photos. To change them later: in the phone's Settings, under Expo Go (on Android: Apps, Expo Go, Permissions). If one was refused, Mitra says to allow it for Expo Go. Photos, files and folders are picked with the phone's own pickers and need no permission, and the share sheet needs none.
- **Finding the server.** The app finds the server on its own: port 3000 on the computer whose address is in the QR code (`mobile/src/lib/server-address.ts`). If it can't reach it, it says so with that address, and asks the person to try again, check the company Wi-Fi, then ask their administrator. You only need `EXPO_PUBLIC_API_URL` (see `mobile/.env.example`) when the server lives somewhere else.

Everything works in Expo Go, voice included: the app records you, the server turns the recording into text, and replies can be read aloud. Plain http is fine there: Expo Go allows it on both Android and iPhone. For trying it on your own computer, `npm run demo` (or `npm run dev`) also shows a QR code for Expo Go in the terminal.

### Tests

The tests run the real server against an in-memory database, a fake connected system, a scripted model and a fake image reader. They cover sign-in logging, sessions, the confirmation rules (nothing runs until confirmed, and a confirmed change runs exactly once), streamed replies (including stopping and retrying one), editing a message, conversation history and titles, voice transcription, attachments (reading real PDF, Word, Excel and text files made in the test, and what the model is given), files from connected systems, sharing conversations and files and the download records, weekly reports (including week boundaries in another time zone), the demo's pest control report, the super admin view, the model's waits and retries (on a fake clock), the request the model is sent (`server/test/request-size.test.ts`: the same start for every person and every day, within the free plan's budget), and the languages (`server/test/language.test.ts`: the rule, the reply language choice changing only the note after it, an unknown one refused, the server's own sentences in Gujarati and Hindi, and what Whisper is sent). A few of the app's own plain modules are checked with the server's tests too, since the app has no test runner of its own: where it finds its server (`server-address.test.ts`), its chat session when a message is edited (`chat-session.test.ts`), a yes or no in three languages (`answer.test.ts`), and how it reads replies aloud (`speech-voice.test.ts`: the language from the script, the text for the ear, the voice it chooses from lists like an iPhone's, an Android phone's, Edge's and Chrome's, and the next one when a voice fails).

`node --no-warnings server/test/request-size.ts [out.json]` prints the size of the request a typical turn sends, in characters and estimated tokens, and can write it out for an exact token count.

**A server for testing the app without Groq.** `DCRS_BASE=http://127.0.0.1:4000 node --no-warnings server/test/flow-server.ts --port 8899 --origin http://localhost:8081` starts the real server with the DCRS connector on that DCRS, an in-memory database and a scripted model, so the app can be driven end to end. People sign in with their DCRS account. What the scripted model does with a message: any words are echoed back in a stream; "due today" runs the today lookup and streams a summary; "start F-QC-30" proposes one card with two steps (open the day's record, fill it with sample data) and, once confirmed, streams "Done"; "long" streams about 6,000 characters in about 300 pieces, 30 ms apart, with a table, a list and a code block; "busy" shows the waiting status for about 5 seconds, then answers; "fail" writes a few words and then fails (the reply can be retried). It answers in the language the server's note tells the real model to (the reply language chosen in the app, else Gujarati or Hindi, in their own script or in English letters, when the message is written in it): "આજે શું બાકી છે?" gets the today lookup and a Gujarati summary, "आज क्या बाकी है?" a Hindi one, and "F-QC-30 શરૂ કરો" the card, with a Gujarati "Done" once confirmed. `--origin` is the web origin allowed to call it (`*` for any).

## Connectors

Each connected system is a connector: a **small, explicit list of allowed actions**. The model can only call those actions, and the server checks every call against the list and the action's input schema before anything runs. No other access to the system exists.

An action declares:

- `name` and `description`: tells the model what the action does and when to use it.
- `kind`: `read` runs immediately. `write` always needs the person's confirmation.
- `input`: a zod schema, validated on the server.
- `describe(input, ctx)`: the plain sentence shown on the confirmation card and in the audit log.
- `run(ctx, input)`: calls the system with the signed-in person's own credentials.

An action that hands the person files, such as a report, returns `withFiles(result, files)`: the server keeps each file in the conversation, shows it as a card to open, download or share, and tells the model it's there. Through `ctx.files.get(fileId)` an action (and its `describe`) can use the files in the conversation it runs in, such as a photo the person attached, and no others.

A connector can also list a few `examples`, short requests people can try, which the app shows on its welcome screen, and `spokenTerms`, words people say about the system that a voice recording's text must spell as written (its short name, its kind of format numbers), which Whisper is shown.

**Adding a system** means adding `server/src/connectors/<id>/index.ts` and listing it in `server/src/connectors/index.ts`. The agent, the confirmation flow, logging and the admin view pick it up automatically.

People sign in with their DCRS account. The server checks the credentials with DCRS and keeps the resulting DCRS sign-in encrypted with that device's session, so every action runs with that person's own DCRS permissions.

### The DCRS connector

`server/src/connectors/dcrs/` works through DCRS's API for this app (`/api/v1`, described in DCRS's `docs/chatbot-integration.md` and `docs/api/dcrs-api.openapi.json`). Set `DCRS_BASE_URL` in `server/.env` to the DCRS server's address, such as `http://192.168.1.20:4000` (see `server/.env.example`).

- **Signing in.** People sign in with their DCRS email and password. The server checks them with DCRS's own sign-in, reads the person's DCRS id and name, and keeps DCRS's session token encrypted. DCRS ends every sign-in at the close of its day (6:20 pm for staff, midnight for the super admin; his sign-in in the day's last ten minutes runs to the next midnight), and the app's session ends with it, so each day starts with signing in again. Outside the staff's working hours DCRS turns staff's sign-in down; the super admin can sign in at any time. For a switched-off account or after too many wrong passwords DCRS turns the sign-in down too, and the person sees DCRS's own words. The person DCRS answers as its super admin (role "admin", read from DCRS at each sign-in) is the app's super admin as well; a role taken away in DCRS stops counting at the next sign-in. An account still on the password the administrator gave it must choose its own in DCRS first.
- **As the person.** Every call carries the person's DCRS sign-in and the header `X-Client-Name: Mitra mobile app`. So DCRS applies its own department rules, working hours, checks and record steps, exactly as for its own pages, and writes each change in the record's history and in its activity log as "Through Mitra mobile app".
- **Refusals** reach the person in DCRS's words: another department's records, outside the staff's working hours ("Staff working hours: 8:40 am to 6:20 pm on working days. Today's staff hours ended at 6:20 pm; they start again on …"), a record that must be reopened before it can be corrected, the problems that stop a submit. Today's facts give the model DCRS's words for the hours as they are, with DCRS's line for the super admin ("these are the staff's hours, and you can keep working at any time"), so Mitra never tells him DCRS is closed. A change card that opens today's record carries DCRS's date for today, so a card shown before midnight and confirmed after it opens the day it showed, as its other steps do. One is put in Mitra's own words: a document name that fits nothing ("No document matches ... Look it up with find_documents, or say its format number."), since DCRS's answer there points to its web API and the model would repeat it. When DCRS no longer accepts the sign-in, the session ends and the app asks the person to sign in again.
- **Brief answers.** Each answer the model is given is cut to a few thousand characters (a long list keeps its first items and says how many more there are), because Groq's free tier allows 8,000 tokens a minute for the whole key. Lists of like things go as tables (the keys once, then a row for each) and a record's values as lines of text, which say the same in a third of the room.
- **A record by its document.** Every action that takes a record accepts its `recordId`, or its `documentId` (DCRS's id, a format number however it is written, or the document's name) with a `date`, today when left out. The connector asks DCRS which record that is while describing the call, so "fill today's F-QC-30 with sample data" needs no lookup first and the card reads "Fill today's record of F-QC-30 Lamination Adhesive Viscosity Record with sample data". A change to a day's record not started yet starts it as part of the change, and the card says so ("Start today's record of … and fill it …"); a lookup of one that is not started says how to start it. A name that fits several documents comes back in DCRS's own words, with the documents it could mean, for the assistant to ask.

What it can do. Lookups run at once; changes are shown on a confirmation card and run only when the person confirms.

| Action | Kind | What it does |
|---|---|---|
| `find_documents` | lookup | Finds the person's documents (formats) by words, format number or module |
| `get_document` | lookup | One document: what it is for, who fills it in, when, its fields |
| `todays_facts` | lookup | Today: working day or holiday, and what is due, overdue and pending |
| `list_records` | lookup | One document's records between two dates |
| `search_records` | lookup | Searches the words written on records |
| `get_record` | lookup | One record (by id, or by document and day): status, whether it can be edited, its fields, values and history |
| `record_pdf` | lookup | Hands over a record as the PDF DCRS prints, to open, download or share |
| `history_figures` | lookup | Figures from past records for a question about history |
| `hr_master_lookup` | lookup | A person on HR Master Data (Human Resources only) |
| `equipment_lookup` | lookup | A machine on the equipment list, F/MNT/01, by its number, serial, model, maker or place, with DCRS's own answer (Maintenance only) |
| `insights` | lookup | What stands out in the person's records: the headline DCRS's Mitra is given with every message, and the insights behind it |
| `escalations` | lookup | The escalations DCRS raised for the super admin: who keeps handing records in late, or leaves them undone (the super admin only) |
| `list_findings`, `get_finding` | lookup | The internal CAPA findings |
| `list_complaints` | lookup | The customer complaints (F/MKT/05) |
| `get_pest_control_report` | lookup | The daily pest control record (F/HR/17) of a date, as a PDF |
| `get_pest_control_report_summary` | lookup | The same record as data |
| `open_record` | change | Opens a document's record for a date, starting it if there is none |
| `edit_record` | change | Changes values on a record, as DCRS's Mitra changes them |
| `record_action` | change | Submit, verify, send back, resume, reopen for correction, cancel a correction, or delete a record |
| `add_photo_to_record` | change | Adds a photo attached in the chat to a record's photos or scans |
| `fill_record_with_sample_data` | change | Fills a record with sample data, marked as made up; it stays a draft |
| `close_finding` | change | Closes a CAPA finding with a note |

Not offered, as DCRS's hand-off says: moving around DCRS's own pages, its question-by-question fill and its questions with buttons (the chat does these itself), reading attachments (this server reads them itself), and changing a document's format (a design task for DCRS on a desktop).

Its tests run it against a stand-in DCRS: every action, what each sends, and every refusal (`server/test/dcrs-connector.test.ts`), and sign-in, a lookup and a confirmed change through the server (`server/test/dcrs-app.test.ts`).

## Login and action logs, super admin view

- **Every sign-in attempt** is recorded, successful or not, with the IP address, user agent and device (name, model, OS and version, app version).
- **Each signed-in device** is a session. The server tracks its last IP and when it was last seen. A device that signs in again replaces its old session.
- **Every action** is recorded: lookups, proposed changes, confirmations, cancellations and failures, along with what the person said.
- **Every message** a person sends is counted (not its text), so the weekly numbers stay right after conversations are deleted.
- **Every download** of a conversation, and every time a file from a connected system is opened, downloaded or shared, is recorded with the file itself (see [Sharing a conversation](#sharing-a-conversation) and [Attachments and files](#attachments-and-files)).
- **Super admins** (DCRS's own super admin, and anybody listed in `SUPER_ADMINS`) see every account in the app: where it's signed in right now, what it last did, its recent actions and sign-ins. They can also sign a device out.

### Security dashboard

Only super admins can open it (**Security** in the menu). Opening it isn't recorded, and nothing in it holds a session token or password.

- **Downloads**: every conversation download and every file from a connected system that was opened, downloaded or shared, newest first, with the person, the conversation's title at the time, the system a file came from, the date, weekday, time and year, the device, IP address and size. Search by export ID, fingerprint (the whole of it, or its first 12 or more characters), title, file name, system or name, and filter by person and period. Each download shows everything recorded about it, including exactly what was downloaded: a conversation's text, or for a file the copy kept with the record. Opening that copy is itself recorded, as the super admin opening the file.
- **Weekly reports**: for each week, what each person did: sign-ins (and failed ones), devices, messages and the files attached to them, lookups, changes confirmed, cancelled or failed, and downloads with the conversations' titles and the names of the files from connected systems. The week in progress is live. Once a week ends its report is stored and never changes afterwards; the server stores it within 15 minutes of the week ending, or when someone opens it first. The numbers come only from the logs, never from conversations, which their owners can delete.

Weeks run from Monday 00:00 to Sunday 24:00 in `REPORT_TIME_ZONE` (in `server/.env`, an IANA time zone such as `Asia/Kolkata`; `UTC` when unset). A date without a time in the Downloads filters means that whole day in the same time zone.

Behind a reverse proxy, set `TRUST_PROXY` so the logs record the real client IP.

## Model

The agent runs on Groq using `openai/gpt-oss-120b` with `medium` reasoning effort and a low temperature, which Groq recommends for reliable tool calls. If Groq rejects a malformed tool call, the request is retried once. In testing each step took 0.5 to 1.3 seconds, which suits voice. Change the model or effort in `server/.env`. The key's other chat models are `openai/gpt-oss-20b` (faster) and `qwen/qwen3.8-27b` (preview).

**The free plan's budget.** Groq's free plan allows the gpt-oss models 8,000 tokens a minute and 200,000 a day for the whole key (console.groq.com/docs/rate-limits), and every model call carries the standing instructions and all 23 tool definitions. So the request is kept small and the same at its start for everyone: the instructions and the tools come first, byte for byte the same for every person and every turn; what differs (who is signed in, today's date in their time zone) follows as a note from the app; then the conversation. Groq keeps its work on a prompt's start for two hours and reuses it for the next request that starts the same (prompt caching, for the gpt-oss models; console.groq.com/docs/prompt-caching), and "cached tokens do not count towards your rate limits". The turn being answered goes to the model in full; earlier turns go whole, newest first, while they fit `HISTORY_CHARS` (12,000 by default), with their lookups' results cut short, and the model is told when the start of the conversation was left out. Lists from DCRS go as tables and a record's values as lines, which say the same in a third of the room. `server/test/request-size.test.ts` fails if the start of the request ever differs between two people or two days, or outgrows the budget.

Measured on 3-Oct-2026 with the scripted model over the five baseline turns (hello; what is due today; which document is the vehicle cleaning record; start today's F-QC-30 and fill it with sample data, confirmed; what does that record say now), counting tokens as gpt-oss sees them (o200k_base, tools as signatures): the standing start went from 11,735 to 10,767 characters (2,266 to 2,053 tokens, above the 128 to 1,024 tokens Groq says a prompt needs before it can be cached); the mean request from 3,248 to 2,494 tokens a call; the five turns from 11 model calls and 35,732 tokens to 9 calls and 22,450. When the start is cached, what counts against the minute is the rest: about 440 tokens a call on average, where it was about 980. The `model call` log line's `cachedTokens` shows whether Groq is reusing the start.

**Waiting for the model.** When Groq turns a call away for the key's limits (a 429), the server takes over from the SDK, which would wait and retry in silence. A wait of up to 2 seconds is just waited. A longer one goes to `GROQ_FALLBACK_MODEL` when one is set (off by default; `openai/gpt-oss-20b` is the suggested value, see `server/.env.example` for what it trades), or is waited with the person told: the stream carries `{ type: 'status', status: 'waiting_for_model', retryInMs }` and then `{ type: 'status', status: null }` when the wait is over. One wait is at most 30 seconds and one turn waits at most a minute in all; past that the reply fails with `assistant_busy`, saying when to try again ("Try again in a minute", "in about 3 minutes", "in about 2 hours" for a daily limit), and Retry continues it. A dropped connection or an error on Groq's side is tried twice more; nothing is retried once the person has seen part of the reply.

**What the server logs.** One line per model call (`model call`): the model, the attempt, how long it took and how long Groq took to start answering, the request's size in characters, the prompt, completion, cached and reasoning tokens from Groq's usage block, Groq's queue, prompt and completion times, what is left of the key's limits from Groq's rate-limit headers (`x-ratelimit-*`), and for a refusal its code and, for a limit, which one (TPM, TPD...) with how much was used and asked for, and the retry-after. One line per request (`turn`): its kind (message, edit, decision, retry), how many model calls and connector calls it made, how long it took and how it ended. Names and numbers only: never the key and never anybody's words.

Three smaller jobs use their own models: `openai/gpt-oss-20b` titles new conversations (`GROQ_TITLE_MODEL`), `whisper-large-v3` turns voice recordings into text, in whichever of the three languages was spoken (`GROQ_TRANSCRIPTION_MODEL`; see [Languages and the voice](#languages-and-the-voice)), and `qwen/qwen3.8-27b` describes attached photos (`GROQ_VISION_MODEL`; about 3 images a minute on the free tier, see [Attachments and files](#attachments-and-files)).

Every request to Groq uses the shared API key's quota, so each person is limited:
- **Chat:** 20 requests a minute across all their devices, counting messages, confirmations and retries, and at most 3 running at once.
- **Voice:** 30 transcriptions a minute per device, up to 15 MB each.
- **Files:** 60 uploads and 60 downloads a minute across all their devices.

Going over a limit returns "Too many attempts. Wait a minute and try again."

## Status

- Done: the server, logging, super admin view, agent with confirmations, and the mobile app. Try them with `npm run demo`.
- Done: the DCRS connector ([The DCRS connector](#the-dcrs-connector)). `npm run server` signs people in with DCRS once `DCRS_BASE_URL` is set.
- New from 2 to 6 October 2026:
  - **Gujarati asked, Gujarati answered**: Mitra answers in the language and script it was asked in (English, Gujarati, Hindi), or always in the one chosen in Settings, and reads replies aloud with each language's own voice, the most natural the phone has ([Languages and the voice](#languages-and-the-voice)). Voice recordings now go to `whisper-large-v3` by default.
  - **`npm run phones`**: Mitra in Expo Go on Android phones and iPhones, from the plant's server PC ([On a phone](#on-a-phone)).
  - **Faster on low-end phones**: replies drawn block by block, and only the row that changed drawn again ([Fast on low-end phones](#fast-on-low-end-phones)).
  - **The edit pen** under every message a person sent ([Editing a message](#editing-a-message)).
  - **The waiting notice**: when Groq's limits make the model wait, the reply says so and counts down, instead of going quiet; past a minute it fails with "Try again in ..." and Retry continues it ([Model](#model)).
  - **`GROQ_FALLBACK_MODEL`** (off unless set; `openai/gpt-oss-20b` suggested) answers when the main model would wait more than 2 seconds, and **`HISTORY_CHARS`** (12,000) sets how much of the earlier conversation each request carries ([Model](#model), `server/.env.example`).
  - A smaller request, the same at its start for everyone so Groq can reuse its work on it, and several changes on one card.
  - **The flow server**, `server/test/flow-server.ts`: the real server with a scripted model, for driving the app without Groq ([Tests](#tests)).
