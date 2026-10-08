# Verity 💛

An **unofficial fan-made desktop buddy** based on Verity from ThatMob's *VERITY™*. He lives on your desktop as a squishy 3D ball: he rolls around, bounces off your screen edges, talks, sings, eats, gets fat, works out, and turns evil at night.

Runs on **Windows, Linux and macOS**. Download the latest version from [verity-releases](https://github.com/137-Trimethylxanthin/verity-releases/releases/latest). Once installed, he updates himself.

## Playing with him

| Do this | He does this |
|---|---|
| Click | Talks (sometimes asks you a quiz) |
| Double-click | Giggles |
| Drag and let go | Gets carried and thrown; bounces off the edges |
| Drag into a screen edge | Squishes against it |
| Shake while dragging | Gets sick (Obesity pukes) |
| Hold **both** mouse buttons on him | Gets squeezed |
| Right-click | Menu: food, treadmill, sing, skins, evil mode, sound, pester, start with PC |

- **Food:** feed normal Verity 3 pieces and he turns into Obesity. The **treadmill** slims him back down.
- **Skins:** Verity, Falsity, Lovity, Obesity, Freakity, Goonity.
- **Evil mode:** right-click → 😈. Also switches on by itself between midnight and 4 a.m.
- **Pester:** ignore him for 5 minutes and he nudges your cursor and scrolls your window. You can turn this off in the menu.

## Development

Needs [Bun](https://bun.sh), Rust, and on Linux `webkit2gtk-4.1` and `gtk-layer-shell`.

```sh
bun install
bun run tauri dev      # run with hot reload
bun run dev            # just the character in a browser (http://localhost:1420/?skin=obesity)
```

**Releasing:** bump `version` in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json`, then push a tag like `v0.3.0`. GitHub Actions builds every platform and publishes to `verity-releases` (see `.github/workflows/release.yml` for the secrets it needs).

See [CREDITS.md](CREDITS.md). Not affiliated with ThatMob.
