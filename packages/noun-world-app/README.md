# Noun World app (iOS + Android)

Capacitor shells that put Noun World (noun.wtf/world) on the App Store and Google Play.

## How it works

- **What the app loads:** the live game at `https://noun.wtf/world?source=app`, set by `server.url` in `capacitor.config.ts`.
  - Multiplayer, NOUN FM, trading and records all run on noun.wtf's servers, so a web deploy updates the app too.
  - Store review only matters for native changes: config, icons, plugins.
- **`www/`:** only holds the offline page (`offline.html`). The app shows it when noun.wtf can't load.
- **Native settings:** `scripts/patch-native.mjs` applies the game settings after `cap add`. It is safe to re-run.
  - iOS:
    - status bar hidden;
    - full screen on iPad;
    - microphone prompt for voice chat;
    - game audio plays with the silent switch on;
    - no export-compliance question.
  - Android:
    - immersive full screen;
    - drawing into the notch;
    - microphone permission.
- **Icons and splash:** generated from `resources/` by `@capacitor/assets`. `resources/` is made from the game cover by `packages/nouns-webapp/scripts/world-app-icons.py`.
- **Install:** this package is **not** in the pnpm workspace (see `pnpm-workspace.yaml`). It has its own `pnpm-lock.yaml` and is installed on your Mac, so the Netlify build never downloads Capacitor.

## One-time setup (on your Mac)

You need:
- **iOS:** Xcode 16+ and an Apple Developer account (**enrolled as an organisation**, see STORE.md).
- **Android:** Android Studio (Ladybug or newer, JDK 21) and a Google Play developer account.

```sh
cd packages/noun-world-app
pnpm install --ignore-workspace     # its own lockfile; builds `sharp` for the icon generator
pnpm add:ios                        # = cap add ios     + patch-native ios
pnpm add:android                    # = cap add android + patch-native android
pnpm assets                         # icons + splash for both platforms from resources/
pnpm sync                           # copies config + www into the native projects
```

Commit the generated `ios/` and `android/` folders. They hold your signing and project settings from then on. After any Capacitor upgrade or a fresh `cap add`, run `pnpm patch`.

## Build, run, sign

### iOS
1. Run `pnpm ios`. Xcode opens `ios/App/App.xcodeproj`.
2. Target **App** → Signing & Capabilities: choose your Team. The Bundle ID `wtf.noun.world` must match the App ID you create in App Store Connect.
3. Run on a device (⌘R). To ship: Product → Archive → Distribute App → App Store Connect. TestFlight first.

### Android
1. Run `pnpm android`. Android Studio opens `android/`.
2. Build → Generate Signed Bundle / APK → **Android App Bundle**. Create an upload keystore, keep it **off** the repo and back it up. Play App Signing holds the real key.
3. Upload the `.aab` to the Internal testing track first.

### Pointing a build at staging
```sh
NOUN_WORLD_URL=https://dev-noun-wtf.netlify.app/world pnpm sync
```
Without the variable, the build points at production.

## Things to know

- **Service worker:** the PWA's worker (`/world-sw.js`) doesn't run inside the iOS app. WKWebView only allows service workers for App-Bound Domains, and turning those on would restrict the YouTube decks and RPC calls. The app needs a connection anyway; when there is none, it shows `offline.html`.
- **Audio:**
  - iOS: the `.playback` session means the radio and SFX play with the ring switch on silent.
  - Android: Capacitor's WebView already lets media play without a tap.
  - The game still starts audio on PRESS START, as on the web.
- **Mic:** voice chat is optional. The OS asks the first time a rider turns their mic on.
- **External links** (wallets, YouTube "watch on", the site): `allowNavigation` only lists noun.wtf, so other hosts open in the system browser rather than inside the app.
- **Before submitting, read STORE.md.** On iOS some web features must be hidden in the app (wallet, on-chain cash-out, NFT-gated perks), and chat needs report and block tools.

## Tests

```sh
pnpm test        # patch-native.mjs against Capacitor 8's templates (node --test)
```
