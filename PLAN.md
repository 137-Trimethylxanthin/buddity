# Verity Desktop Assistant: Research and Plan

> **Status (2026-10-08, evening):** a working desktop buddy (Tauri v2 + three.js) for Windows and Linux.
> - Verity is a squishy 3D ball using the real face. He roams a full-screen click-through overlay (layer-shell on Wayland), rolls, hops, bounces, gets dizzy and wipes out on hard hits.
> - Skins: Verity, Falsity, Lovity, and Obesity (a fat blob that waddles). Synthesised babble voice, short sung meme lines with floating notes, mouth animation and blinking.
> - Right-click menu: food (3 pieces turns Verity into Obesity), treadmill (back to Verity), sing, talk, skins, creepy mode, sound.
> - Hold to squeeze him; drag him into screen edges to squish him; shake him and he gets sick (Obesity pukes).
> - Not done yet: macOS build, auto-update, a real Obesity model (FintuBoi's, via Patreon), AI chat.

> **Decisions (2026-10-08):** route **B**, a free, open-source fan app labelled "unofficial fan project" with no monetisation. No version stages: build in order, **character first**, then continue down the list. AI chat comes at the end of the list.

_Drafted 2026-10-08_

## 1. What "Verity" is

- **Origin:** *VERITY™* is a three-episode Minecraft horror web series by YouTuber **ThatMob**. It ran on YouTube from 30 May to 8 July 2026.
- **The character:** Verity is an in-game "helpful AI assistant" with a round, yellow, grinning smiley face. It is delivered in a box. It gets steadily creepier, recites details of the player's personal life, and ends up as a hostile humanoid. JustWhispy does the voice.
- **The meme:** The trend grew out of Horror Skunx's fan song *"It's me, It's Verity."* The song and the series each have more than 20M views. The lines people share most are the quiz bit ("What's the capital of France?" "**Paris!**"), the giggle and smile ("**tee hee**"), and the countdown ("something is coming in three days"). The fanbase is mostly Gen Alpha. Commentators file it under "corporate horror" alongside the Backrooms and Skibidi Toilet, plus "the AI is a shoggoth with a smiley mask."
- **Status:** The trend peaked around August–September 2026. Forbes covered it on 27 Sept, and the Anne Hathaway *Verity* movie promo referenced it. Memes usually fade within months, so **getting something out fast matters more than having every feature.**
- **Existing spin-offs:** There are several Minecraft mods. One reached 4.9M downloads in a month, and at least one says it is *officially licensed by contract with ThatMob*. There is also unofficial Roblox merch. I found **no official desktop app** and **no published fan-content or merch policy.**

### ⚠️ The money problem: IP

Verity's name, smiley design and voice belong to ThatMob. The song and its lyrics belong to **Horror Skunx**, a separate rights holder, so route A means pitching both. A free fan app is common and usually tolerated. **Selling** something branded "Verity" without a license is how you get takedowns: Steam, itch.io and the app stores all act on DMCA and trademark complaints. Other companies also use "Verity" as a brand (BlackLine Verity AI, Verity.md, VerityRMS). There are three routes:

| Route | Money | Risk |
|---|---|---|
| **A. License it.** Email ThatMob and pitch the app with a revenue share. The Verity JE mod *claims* to have a contract, which is unverified, but ThatMob does openly support fan mods. | Yes, and it is the official app | Lowest. They may say no or not answer. |
| **B. Free fan app.** Open source, no monetisation, labelled "unofficial fan project." | None directly, but it builds an audience and a portfolio | Low–medium |
| **C. Original "creepy-cute assistant" in the same genre.** Own name and design. It can ride the vibe without copying the character. | Yes | Low, as long as it really is original |

**Recommendation:** build the engine so the character is just a skin. Ship with an original default character (route C). Pitch ThatMob in parallel (route A). If they agree, the official Verity skin drops in without code changes. If not, you still have a sellable product. Do **not** bundle the song or the voice clips.

### Audience caution
Most fans are children. That means:
- No data collection, no accounts, and no telemetry by default. Everything stays local. This also avoids COPPA and GDPR-K trouble.
- The "creepy" features must only *pretend* to know things. Use local, harmless data such as the OS username, the time of day or the weather city the user typed in. Never real tracking.
- Any jumpscares are opt-in and off by default.
- Avoid loot boxes. If AI chat is added, it needs a strict safety filter.

## 2. How desktop assistants and pets are built

> **Chosen design (2026-10-08): a full-screen roaming overlay.** One transparent window covers the screen, and Verity walks, falls and gets thrown anywhere inside it. Only her body and speech bubble catch clicks. Linux uses a GTK input shape for this; Windows and macOS toggle click-through from a cursor poll. Linux Wayland desktops (Hyprland, KDE, Sway) use **gtk-layer-shell** as an overlay layer, because plain Wayland windows can't position themselves or stay on top. GNOME and X11 fall back to a monitor-sized window. Runtime dependency: `gtk-layer-shell`. The real Verity art loads as a picture skin from `public/skins/verity/face.png` (+ optional `creepy.png`).

A desktop pet is a **transparent, borderless, always-on-top window with no taskbar entry**. It draws only the character, and clicks pass through everywhere except on the character itself.

| Stack | Pros | Cons |
|---|---|---|
| **Tauri v2 + TypeScript** (recommended) | Installers around 10 MB. Web tech for UI and skins. Rust for system hooks. [WindowPet](https://github.com/SeakMengs/WindowPet) shows the stack works (45+ pets, click-through, MIT licence), but it was last updated Jan 2024 on Tauri v1, so use it as an example, not a v2 reference. | Linux renders through WebKitGTK, and transparency on Wayland is flaky |
| Electron | The most mature transparency and click-through (`setIgnoreMouseEvents`). Huge ecosystem. | Installers of 100 MB or more and high RAM use, which is bad for an app that is "always running" |
| Godot 4 | A game engine, so animation and particles are excellent. Supports transparent windows and mouse passthrough. | Settings and chat UI are clunkier. Fewer system integrations. |

**Known pain points (from Tauri issues and existing pet apps):**
- **Click-through and hover:** with `setIgnoreCursorEvents(true)`, JavaScript cannot see the mouse. You need a **Rust-side cursor poll** of about 30–60 Hz that turns click-through off whenever the cursor is over the character's pixels.
- **macOS:** needs the `macOSPrivateApi` flag for transparency. Set the window level and `canJoinAllSpaces` so the character follows you across Spaces. The app must be notarized, which requires a $99/yr Apple Developer account.
- **Windows:** use the `WS_EX_TOOLWINDOW`/`NOACTIVATE` window styles so the pet doesn't steal focus. Sign the installer to avoid SmartScreen warnings.
- **Linux:** under Wayland the app cannot position its own window and transparency varies by compositor. The fallback is to force XWayland (`GDK_BACKEND=x11`). If that fails, use a "window mode" with a solid background. Test on KDE, GNOME and Hyprland, since you are on CachyOS.

## 3. Feature list

### Core
1. **The character on screen.** Idle bobbing, blinking, and eyes that **follow your cursor**. It can be dragged, it reacts when thrown, and it falls and sits on the taskbar or screen edge.
2. **Speech bubbles with the meme lines.**
   - The quiz: "What's the capital of France?" Clicking reveals "Paris! tee hee."
   - "It's me, it's [name]!" greeting on startup.
   - "Something is coming in **3 days**..." which ties into a real countdown feature, see 4. (Unverified: this line only came from a TikTok search page.)
   - **Lyric caution:** a trivia-quiz format, "Paris" and "tee hee" are generic enough to use. "It's me, it's Verity" is the **song's title line**. In the original-character build, reword it (e.g. "Hi, it's me, [name]!") unless Horror Skunx approves it.
3. **Two personalities, Friendly and Creepy,** switched from the tray. In Creepy mode the smile slowly widens, the eyes track harder, and the character "knows" things like your username, how long the PC has been on, or that you're up at 3 a.m.
4. **Useful assistant tools**, so there is a reason to keep it running:
   - Timers, reminders and a Pomodoro timer, delivered as speech-bubble alerts
   - Quick notes and a to-do list
   - A countdown to any date ("3 days until your exam... tee hee")
   - Clock, date and optional weather, using Open-Meteo, which needs no API key
5. **Skins system v1**, see section 4.
6. **Tray menu:** show or hide, personality, skin, mute, settings and quit. **Autostart** on login.
7. Installers (last step) for **Windows (.msi/.exe), macOS (.dmg, universal), and Linux (AppImage, .deb, Flatpak, plus AUR for you)** built by GitHub Actions. Auto-updates through the Tauri updater.

### Extras
- **Daily quiz and trivia** in the "capital of France" style, with a streak counter
- **Mini-games:** catch the smiley, whack-a-smile, and "don't look away" staring contest
- **Desktop antics:** walks along the bottom of the screen, peeks from the screen edge, and hides behind windows
- **Random events:** the character occasionally "glitches", says something cryptic, or knocks on the screen
- Sound effects such as the giggle and squeak, using original audio
- System stats: "your CPU is sweating, tee hee"

### Later on the list
- **AI chat.** The user types to the character and it answers in character. This is expensive and risky with kids, so make it opt-in and bring-your-own-API-key, or use a small local model through Ollama. Use a strict system prompt and a moderation filter.
- Voice output (TTS) with an original voice
- **Skin workshop:** Steam Workshop or a simple skin gallery site
- Shimeji import, which would open up thousands of existing community skins

## 4. Skins architecture

Each skin is a folder or zip file:

```
skins/smiley-classic/
  skin.json        # name, author, version, size, anchor point, animation map, voice-line overrides
  idle.png         # sprite sheets (or animated WebP / Lottie JSON)
  blink.png
  talk.png
  creepy_idle.png
  drag.png
  fall.png
  eyes/pupil.png   # separate layer for cursor-following eyes
  sounds/*.ogg     # optional
  lines.json       # optional: replace or extend dialogue
```

- The **animation state machine** lives in code: idle, blink, talk, drag, fall, sit, walk, creepy and glitch. A skin only provides frames for each state and falls back to idle if one is missing.
- **Layers** include body, face, eyes and accessories. With these, **recolours and hats** are cheap to make, which helps both monetisation and community skins.
- Skins load from the app's data directory. Drag a `.zip` onto the character to install it.
- Planned skins: Classic Smiley (default, original), Pastel, Pixel/Minecraft-style, Glitch/Corrupted, Halloween and Christmas (seasonal, good for timed sales), and later the official Verity skin if route A works out.

## 5. Monetisation
None. This is a free fan app (route B). Do not sell skins or anything else branded Verity.

## 6. Build plan

| Phase | Deliverable | Rough time |
|---|---|---|
| 0 | ~~Decide the IP route~~: B, a free fan app | done |
| 1 | Tauri v2 + Vite + TypeScript scaffold. Transparent always-on-top window, drag, tray, autostart. **Test on Linux X11 and Wayland, Windows and macOS on day 1.** | 2–3 days |
| 2 | Rust cursor-poll click-through, eye tracking, animation state machine, skin loader with `skin.json` schema validation | 3–4 days |
| 3 | Speech bubbles and dialogue engine (meme lines, Friendly and Creepy modes, local "creepy knowledge") | 2–3 days |
| 4 | Assistant tools: timers, reminders, Pomodoro, notes, countdown, weather; a settings window | 3–4 days |
| 5 | 3 polished skins, sound effects, onboarding | 3–5 days (art is the bottleneck) |
| 6 | CI release pipeline, code signing, auto-update, itch.io page, TikTok demo clips | 2–3 days |
| 7 | Extras, then AI chat | later |

**Testing:** unit tests for the dialogue engine, skin validation and state machine (Vitest, plus cargo test for Rust). Manual smoke tests per OS before each release.

## 7. Open decisions
1. ~~IP route~~: B, a free fan app.
2. AI chat: comes at the end; bring-your-own key or local model to be decided then.
3. Who makes the art: you, a commissioned artist, or programmer art first?

## Sources
- Wikipedia, Verity (web series): https://en.wikipedia.org/wiki/Verity_(meme)
- Forbes, "Who Is 'Verity'? TikTok's New Obsession Is An Evil AI" (2026-09-27): https://www.forbes.com/sites/danidiplacido/2026/09/27/tiktoks-its-me-its-verity-meme-explained/
- "It's me, It's Verity" (Horror Skunx): https://villainsong.fandom.com/wiki/It's_me,_It's_Verity
- Know Your Meme: https://knowyourmeme.com/memes/subcultures/verity-minecraft-arg
- Verity mods: https://github.com/ThatMobbb/VerityCraft · https://www.curseforge.com/minecraft/mc-mods/verity-je · https://modrinth.com/mod/verity-java
- WindowPet (Tauri pet app): https://github.com/SeakMengs/WindowPet
- Shijima-Qt (Shimeji runner): https://pixelomer.itch.io/shijima
- Tauri Linux graphics issues: https://v2.tauri.app/develop/debug/linux-graphics/
- Tauri click-through issue: https://github.com/tauri-apps/tauri/issues/11461
