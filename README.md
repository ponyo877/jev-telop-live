# Jev Live

English | [日本語](README.ja.md)

Talk to your camera, and Japanese variety-show captions and manga effects appear on their own, matched to what you are saying.

- Sound-effect words such as 「ドン!」 (*don!*, impact), 「ざわ…ざわ…」 (*zawa zawa*, uneasy murmur) and 「ガーン」 (*gaan*, shock), with speed lines, flashes and sound effects
- Your punchline itself, shown as a big outlined caption
- Sunglasses that are always on. When a mood settles in, the lenses change color, rain falls, the picture warps and your voice changes

What appears, and when, is decided by [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) alone.
Jev does not write text. It answers typed questions with probabilities.
Everything shown or played is picked from a closed set.

## Run it

You need macOS 26 or later, Xcode 26, Node.js 20 or later, Chrome, and a [TypeSafe](https://console.typesafe.ai/) API key.
There are no npm dependencies.
Wear headphones so the sound effects do not leak back into the microphone.

```sh
npm run build:stt                 # build the speech recognizer (first time only)
TYPESAFE_API_KEY=... npm start    # http://localhost:8054
```

Open the page and click the stage. It asks for camera and microphone access.
The key stays inside the server and never reaches the browser.

Without a key or a camera, you can still fire every effect by hand from the buttons in the panel.

```sh
node server.js --no-stt                          # no speech recognition; type into the input box instead
STT_CMD="node sim/fake-stt.js promo" npm start   # play a one-minute script, so you can watch a full run without talking
npm run fetch:vendor                             # download the face-tracking files (for venues with no network)
```

| URL parameter | Effect |
|---|---|
| `?stage=1` | Show only the stage, full screen (the `P` key toggles it too) |
| `?scale=1.5` | Draw the stage at 1920x1080 |
| `?mirror=0` / `?shades=0` | Do not mirror the picture / do not keep the sunglasses on |
| `?still=1` | Reduce motion |
| `?camera=<image URL>` | Feed a still image instead of the camera |

The "● 録画" (record) button under the stage, or the `R` key, saves picture and sound as one mp4.
You can record the whole browser window, the tab, or the stage alone.
The sound is the effects and your microphone, mixed inside the app.

The interface and the captions are in Japanese, and the speech recognizer is set to Japanese.

## How it works

```
speech recognition (Swift) → transcript → scheduler (when to ask) → Jev (30 questions in one request)
  → director (show it, or hold it back) → effect events → stage (picture) and sound
```

Jev receives the transcript and 30 typed questions.

| Question | Type | What it decides |
|---|---|---|
| Which effect fits | choice | A bundle of sound-effect word, screen effect and sound (15 kinds, or none) |
| Which mood has settled in | choice | A bundle of lens color, face, screen and voice effects (8 kinds, or none) |
| For each effect and each mood: show it now? | noul × 23 | Backing for the choice answers |
| Was that a punchline? Is the sentence finished? Is there too little to judge? | noul × 3 | Whether to show the spoken-line caption |
| Caption style | choice | Typeface, color and motion (8 kinds) |
| Heat | score | Text size, shake, volume, and how strong the word is (ドン, ドン!, ドドン!!) |

A noul is a yes/no question answered as a probability.

Design decisions.

- **Pick bundles.** Jev evaluates each question independently. Ask for the word, the sound and the screen effect separately, and you get 「ガーン」 with a laugh track. The combinations are fixed in a table
- **Ask with both choice and noul.** A choice sums to 1, so it leans toward something even when nothing fits. If the noul, which is an absolute judgment, is low, the effect is held back even if it won the choice
- **Judge one utterance at a time.** Hand over the finished line and the line still being spoken side by side, and the punchline of the first gets credited to the second
- **Code is what holds effects back.** Jev only answers what fits right now. Rules such as once per utterance, or 8 seconds before the same word again, live in the `director`. Earlier answers are never sent back to Jev, because it gets pulled toward its own answers
- **Do not wait for the final transcript.** Apple's recognizer takes about 3 seconds after you stop talking to finalize. Effects fire when the transcript stops moving and Jev says the sentence is finished
- **If you speak, something appears.** An utterance with no fitting word gets its own words as a caption. No effect lasts more than 3 seconds

The path from transcript to effect events (`src/pipeline.js`) never touches the DOM.
The page and the live-API test run go through the same code.

## Verification

```sh
npm test                                  # node:test
npm run probe                             # live API: how to phrase the questions
npm run sim -- --script promo --pace 6.5  # live API: play a script at speaking pace, through to effect events
node sim/replay.js logs/live.jsonl        # replay recorded answers through the current director (no API calls)
```

Measured on 2026-09-19, Apple M5, `jev-1.13.0`.

| Item | Result |
|---|---|
| Response time | 250 ms median (30 questions in one request) |
| Cost | About $0.00011 per request. Around $0.5 for an hour of nonstop talking |
| 8 lines of ordinary talk | "None" won every time. No word fired by mistake |
| 12 scripted lines | The expected word was in the top 3 for 10 of 10 |
| Punchline score | 0.05 or lower for ordinary talk, 0.52 to 0.88 for punchlines |
| From end of sentence to effect | 0.68 s median (with the fake speech recognizer) |

Not verified yet.

- Nobody has listened to the sound. Effect volumes were matched by numbers only. Synthesized laughter does not sound good, so drop in `assets/se/laugh.mp3` (any `assets/se/<id>.mp3` takes priority over the synthesized sound)
- Playing back a saved recording, and the flow of picking a window to record
- Face tracking with a real camera, and capturing into OBS

Question wording, thresholds and the reasons for them, what the probing found, and notes on the microphone and recording are in [docs/notes.md](docs/notes.md) (Japanese).

## Files

```
server.js      static files, relay to Jev, transcript over SSE, starts the speech recognizer
src/
  effects.js   the closed set of effects, and the bundles
  ask.js  scheduler.js  director.js  pipeline.js   how to ask, when to ask, show or hold back, and the wiring
  stage/       picture compositing (Canvas 2D), face tracking (MediaPipe)
  audio/       sound-effect synthesis and voice processing (WebAudio)
  recorder.js  recording
sim/           scripts, fake speech recognizer, probing, full test runs
stt/           speech recognition (Swift, Apple SpeechAnalyzer)
test/          node:test
```

The speech recognizer comes from [jev-realtime-brain-scanner](https://github.com/ponyo877/jev-realtime-brain-scanner).
