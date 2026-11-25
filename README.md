# Ommesh Mini-Apps

Official catalog, source code, starter templates and packaging tools for **Ommesh** isolated LoRa mini-apps (`.omapp`).

**English** · [Русский](README.ru.md)

Mini-apps run inside Ommesh (desktop, web, Android and iOS) in a strict `sandbox="allow-scripts"` iframe with `connect-src 'none'`, talking to the radio, local storage, contacts and notifications exclusively through [`@ommesh/miniapp-sdk`](https://github.com/cm4ker/ommesh/tree/master/packages/miniapp-sdk).

> Looking for the full SDK API & interactive methods portal? See the main Ommesh repository:
> - [SDK Quickstart & Guide](https://github.com/cm4ker/ommesh/blob/master/packages/miniapp-sdk/README.md)
> - [SDK Methods Reference (EN)](https://github.com/cm4ker/ommesh/blob/master/docs/miniapp-sdk.md) · [Справочник методов (RU)](https://github.com/cm4ker/ommesh/blob/master/docs/miniapp-sdk.ru.md)
> - [Interactive Methods Portal & Playground](https://github.com/cm4ker/ommesh/blob/master/docs/miniapp-sdk-portal.html)

## Official Catalog

| Mini-App | ID | `appId` | Scope | Permissions | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **LoRa Chess** | `ommesh.chess` | `0x0100` | `p2p` | `peerData`, `storage`, `notifications` | FIDE peer-to-peer chess over MCRS v2 (1 AES block per move, two-way resync, in-game chat, background worker) |
| **LoRa Calculator** | `ommesh.lora-calc` | `0x0000` | `standalone` | *(none)* | Offline LoRa airtime and Fresnel zone calculator |

## Quickstart

Requires **Node.js 22+** (zero external npm dependencies).

```sh
# Validate every app, template and registry.json
npm run validate

# Run mini-app unit tests
npm test

# Build self-contained dist/*.omapp bundles + dist/catalog.json
npm run build
```

Then install any generated `dist/<id>.omapp` in Ommesh via **Apps → Store → Load .omapp** (you can test P2P apps without hardware in **Demo mode**).

## Create a New Mini-App

Scaffold from the built-in templates:

```sh
# Offline utility (appId = 0, no radio permissions)
npm run new -- my-tool --standalone

# LoRa P2P app (assigns a dev appId in 0xFF00..0xFFFF)
npm run new -- my-game --p2p --app-id 0xff10
```

Each mini-app lives in `apps/<slug>/`:

```text
apps/my-app/
├── manifest.json   # Schema v1 metadata, appId, scope, permissions, backgroundNotices
├── icon.svg        # Monochrome SVG using currentColor (no <script>)
├── index.html      # UI entry point (supports ./style.css, ./script.js and /* @include */)
├── worker.js       # Optional background packet handler (self.onPacket)
└── test.mjs        # Optional node:test unit tests
```

`npm run build` automatically inlines local `./*.js`, `./*.css` and `/* @include ./file.js */` references into a single self-contained `.omapp` bundle (`<= 512 KiB`).

## `appId` Allocation Ranges

| Range | Purpose |
| :--- | :--- |
| `0x0000` | Standalone offline utilities (no LoRa P2P packets) |
| `0x0100..0xFEFF` | Registered catalog P2P apps (tracked in `registry.json`) |
| `0xFF00..0xFFFF` | Developer sideloading & local experiments |

## Submitting a Mini-App

1. Fork this repository and add your app under `apps/<slug>/`.
2. For P2P apps, claim the next unused `appId` in `registry.json` (`0x0100..0xFEFF`).
3. Ensure your app:
   - uses Ommesh CSS theme tokens (`var(--bg)`, `var(--panel)`, `var(--text)`, `var(--accent)`, …) and adapts to mobile safe areas (`var(--safe-bottom)`) and soft keyboards (`data-keyboard="open"`),
   - fits within the 512 KiB `.omapp` limit and 150 B LoRa payload limit,
   - passes `npm run validate`, `npm test` and `npm run build`.
4. Open a Pull Request describing your app and wire protocol (for P2P apps).
