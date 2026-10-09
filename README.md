# Verity 💛

An **unofficial fan-made desktop buddy** based on Verity from ThatMob's *VERITY™*. He lives on your desktop as a squishy 3D ball: he rolls around, bounces off your screen edges, talks, sings, eats, gets fat, works out, and turns evil at night.

Runs on **Windows, Linux and macOS**. Download the newest `verity-v…` release from [releases](https://github.com/137-Trimethylxanthin/buddity/releases). Once installed, he updates himself.

## Playing with him

| Do this | He does this |
|---|---|
| Click | Pets him (the PetPet hand; spam it) |
| Double-click | Giggles |
| Drag and let go | Gets carried and thrown; bounces off the edges |
| Drag into a screen edge or corner | Squishes against it |
| Shake while dragging | Gets sick (Obesity pukes) |
| Hold **both** mouse buttons on him | Gets squeezed |
| Right-click (or middle-click) | Menu around him: talk (sometimes he asks you a quiz), sing, feed, treadmill, microphone, chain, evil mode, wardrobe & skins, settings |

Hover over him for a moment and a little tag reminds you of all this.

- **Microphone:** right-click → 🎤 Microphone. He holds a mic and sings along to whatever you're playing, wherever he is: every line of the lyrics when "Sing along" finds them, otherwise he hums to the beat. Right-click → Put the mic down to stop.
- **Chain:** right-click → ⛓ Chain puts a chain round him, bolted to the floor next to him. Drag the bolt anywhere (drop it on a window and it moves with that window), scroll on it to make the chain longer or shorter. He can't get any further than the chain lets him: he stops at its end, swings when thrown, and dangles if you hang the bolt up high. Right-click → Unchain sets him free. He remembers both after a restart.
- **Food:** feed normal Verity 3 pieces and he turns into Obesity. The **treadmill** slims him back down.
- **Skins:** Verity, Falsity, Lovity, Obesity, Freakity, Goonity. Pick one in Settings (right-click → 👒 Wardrobe & skins).
- **Wardrobe:** right-click → 👒 Wardrobe & skins: the Master Verity hat, a bow, a crown, a party hat, devil horns, a halo, sunglasses and a bow tie. One hat, one pair of glasses and one neck thing at a time; he keeps them on when you switch skins.
- **Your windows:** the tops of your windows are ledges he stands and rolls on, and he can go inside a window and stand on its bottom edge. Move or resize the window and he's thrown around in it (or on it): its walls are solid and gravity pulls him. Drag a window into him fast and he gets knocked flying. He knows which app's window he's in front of or on top of, and now and then goes to visit one. On the window of the app that's playing music he dances and sings every line until you move him off. On Windows, the Start menu, Search and the notification center count too: one popping open on top of him shoves him out of the way. He only sees app names and where windows are, never titles or what's in them. Works on Windows, macOS, X11 and Hyprland (other Wayland desktops don't let apps see windows). Turn it off with "Climb windows" in Settings.
- **Several screens:** screens side by side are one big floor. He walks, rolls, gets thrown and dragged straight across the edges between them, half on one screen and half on the other while he crosses. He starts on the screen he was last on. Turn it off with "All screens" in Settings. This adds one invisible, click-through window per screen. Not on GNOME's Wayland session, which doesn't let apps place their windows.
- **Evil mode:** right-click → 😈 Get creepy. Also switches on by itself between midnight and 4 a.m.
- **Push my cursor when ignored:** ignore him for 5 minutes and he pushes your cursor across the screen (shake your mouse hard to break free) and rolls on the spot to scroll the window he's in. You can turn this off in Settings.
- **He knows things:** your OS, CPU and how busy it is, RAM, which app is hogging memory, your battery, how long your PC has been on, what day it is, and how often you've clicked, thrown, fed or closed him. In evil mode it gets creepy. All of it stays on your computer (he never reads window titles, files or browsing).
- **Music:** he notices what you're playing (Spotify, YouTube in the browser, any player that shows up in your system's media controls), comments on it, and dances. Sometimes he sings a few lines along with the song, with lyrics from [LRCLIB](https://lrclib.net), and he dances at the song's tempo from [Deezer](https://www.deezer.com) (the song's title and artist are sent to both; turn off "Sing along" in Settings to stop that). Deezer doesn't know every song's tempo; then he grooves at 120 BPM. The tempo is right but where the beat falls is a guess, so he can be a little off the beat. On macOS only Spotify and Apple Music are seen, and macOS asks once whether Verity may control them.
- **Don't close him:** sometimes (2%) Quit only pretends. He disappears, tray icon too, and a minute later he crashes out: grabs your cursor, jumpscares you, and pushes your cursor around for 30 seconds before calming down. Starting him again while he's gone brings him back right away.
- **Settings:** right-click → ⚙ Settings, or the tray icon → Settings…: skins and wardrobe with a preview of him, sound, how often he talks on his own (often, sometimes, quiet), push my cursor when ignored, all screens, climb windows, music, sing along, start with PC, Discord status (and one more, once you've earned it), plus a "Check for updates" button. Click "Later" on an update and he won't ask again until he restarts.
- **Discord:** while he runs, your Discord profile shows you're hanging out with Verity, and his mood.

## Development

Needs [Bun](https://bun.sh), Rust, and on Linux `webkit2gtk-4.1` and `gtk-layer-shell`.

```sh
bun install
bun run tauri dev      # run with hot reload
bun run dev            # just the character in a browser (http://localhost:1420/?skin=obesity)
bun run test           # unit tests (physics, the chain, window coordinates)
```

To test the fake quit without waiting: `VERITY_FAKE_QUIT_CHANCE=1 VERITY_FAKE_QUIT_SECS=20 bun run tauri dev`, or `?do=fakequit` in the browser.

**Releasing:** bump `version` in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json`, then push a tag like `v0.3.0`. GitHub Actions builds every platform and publishes the release in this repo (see `.github/workflows/release.yml` for the secrets it needs).

See [CREDITS.md](CREDITS.md). Not affiliated with ThatMob.
