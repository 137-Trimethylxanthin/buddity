# Verity 💛

An **unofficial fan-made desktop buddy** based on Verity from ThatMob's *VERITY™*. He lives on your desktop as a squishy 3D ball: he rolls around, bounces off your screen edges, talks, sings, eats, gets fat, works out, and turns evil at night.

Runs on **Windows, Linux and macOS**. Download the newest `verity-v…` release from [releases](https://github.com/137-Trimethylxanthin/buddity/releases). Once installed, he updates himself.

## Playing with him

| Do this | He does this |
|---|---|
| Click | Talks (sometimes asks you a quiz) |
| Double-click | Giggles |
| Drag and let go | Gets carried and thrown; bounces off the edges |
| Drag into a screen edge or corner | Squishes against it |
| Shake while dragging | Gets sick (Obesity pukes) |
| Hold **both** mouse buttons on him | Gets squeezed |
| Right-click | Pets him (the PetPet hand; spam it) |
| Middle-click | Menu: food, treadmill, sing, talk, skins, evil mode, settings |

- **Food:** feed normal Verity 3 pieces and he turns into Obesity. The **treadmill** slims him back down.
- **Skins:** Verity, Falsity, Lovity, Obesity, Freakity, Goonity.
- **Evil mode:** right-click → 😈. Also switches on by itself between midnight and 4 a.m.
- **Pester:** ignore him for 5 minutes and he pushes your cursor across the screen (shake your mouse hard to break free) and rolls on the spot to scroll your page. You can turn this off in Settings.
- **He knows things:** in evil mode he brings up how long your PC has been on, what day it is, and how often you've clicked, thrown, fed or closed him. All of it stays on your computer.
- **Don't close him:** sometimes (2%) Quit only pretends. He disappears, tray icon too, and about half an hour later he crashes out: grabs your cursor, jumpscares you, and pushes your cursor around for 30 seconds before calming down. Starting him again while he's gone brings him back right away.
- **Settings:** middle-click → ⚙, or the tray icon → Settings…: sound, pester, start with PC, Discord status (and one more, once you've earned it), plus a "Check for updates" button. Click "Later" on an update and he won't ask again until he restarts.
- **Discord:** while he runs, your Discord profile shows you're hanging out with Verity, and his mood.

## Development

Needs [Bun](https://bun.sh), Rust, and on Linux `webkit2gtk-4.1` and `gtk-layer-shell`.

```sh
bun install
bun run tauri dev      # run with hot reload
bun run dev            # just the character in a browser (http://localhost:1420/?skin=obesity)
```

To test the fake quit without waiting: `VERITY_FAKE_QUIT_CHANCE=1 VERITY_FAKE_QUIT_SECS=20 bun run tauri dev`, or `?do=fakequit` in the browser.

**Releasing:** bump `version` in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json`, then push a tag like `v0.3.0`. GitHub Actions builds every platform and publishes the release in this repo (see `.github/workflows/release.yml` for the secrets it needs).

See [CREDITS.md](CREDITS.md). Not affiliated with ThatMob.
