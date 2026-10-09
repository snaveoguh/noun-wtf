# Noun World — iOS + Android app

[Noun World](https://noun.wtf/world) (the 3D skate game at
`packages/nouns-webapp/src/miniapps/world2`) packaged as a native app with
[Capacitor](https://capacitorjs.com/). The game build is **bundled inside the
app**; there is no live-site wrapper. Landscape only, full screen, with the
game's existing touch controls, in-game radio and voice chat.

```
packages/noun-world-app
├── src/                 native shell: router, audio unlock, back button, fonts
├── scripts/             sync-game-assets.mjs — copies /world2, /models, /fonts
├── android/             Android Studio project (Capacitor)
├── ios/                 Xcode project (Capacitor, Swift Package Manager)
├── codemagic.yaml       CI for both platforms
└── capacitor.config.ts  appId wtf.noun.world
```

The game code itself is **not** copied or modified: Vite imports it in place
from `../nouns-webapp/src` (the `@/` alias in `vite.config.ts` /
`tsconfig.json`). Anything the game needs changed for mobile goes into the
webapp as its own small PR.

## What the shell does

| Concern        | Where                                                                                                                                                                                       | Notes                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Game bundle    | `pnpm build` → `dist/`                                                                                                                                                                      | Vite build of `World2Page` behind a `MemoryRouter`                                                                       |
| Game assets    | `scripts/sync-game-assets.mjs`                                                                                                                                                              | `/world2/*`, 3dnouns heads + manifest + glasses textures, fonts → `public/` (≈100 MB, gitignored)                        |
| Landscape lock | Android: `android:screenOrientation="sensorLandscape"`; iOS: `UISupportedInterfaceOrientations` (+`~ipad`)                                                                                  | Portrait is impossible; `.nw-rotate` in `src/index.css` is a fallback for split-screen                                   |
| Full screen    | Android: `MainActivity` hides system bars (sticky immersive), draws under the cutout; iOS: `UIStatusBarHidden`, `GameViewController` hides the home indicator and defers edge swipes        |                                                                                                                          |
| Keep screen on | Android: `FLAG_KEEP_SCREEN_ON`; iOS: `isIdleTimerDisabled`                                                                                                                                  |                                                                                                                          |
| Audio unlock   | `src/native.ts` resumes the `AudioContext` on `touchend` / `pointerup` and on `appStateChange`; iOS `AppDelegate` sets the `AVAudioSession` category so audio plays with the mute switch on | The game already unlocks on `pointerdown`; this covers older WebKit + resume after an interruption                       |
| Microphone     | Android: `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS`; iOS: `NSMicrophoneUsageDescription`                                                                                                      | The game's `getUserMedia` call triggers the OS prompt via Capacitor; a denied prompt is handled by the game's `Voice.ts` |
| Dark splash    | Android theme + `drawable/splash.xml`; iOS `LaunchScreen.storyboard`                                                                                                                        | Solid `#0d1117`, no logo bitmap, so there's no flash before the first frame                                              |
| Back button    | `src/native.ts`                                                                                                                                                                             | Minimises the app instead of killing the session                                                                         |
| Pause          | `src/native.ts`                                                                                                                                                                             | `game.setPaused(true)` when backgrounded                                                                                 |

## Prerequisites

- Node 22, pnpm 10.12 (`corepack enable`)
- Android: JDK 21, Android SDK with **platform 36** and **build-tools 36.0.0**
  (Capacitor 8 compiles against SDK 36)
- iOS: a Mac with Xcode 16+; no CocoaPods needed (Capacitor 8 uses SPM)

Install only the workspace packages this app needs (a full-workspace install
pulls in Foundry / Hardhat tooling you don't need for the app):

```sh
# from the repo root
pnpm install --filter @nouns/noun-world-app --filter @nouns/voxel-engine
```

## Web bundle

```sh
cd packages/noun-world-app
pnpm check      # tsc --noEmit (includes the game sources)
pnpm build      # runs sync-game-assets first, then vite build → dist/
pnpm dev        # http://localhost:5174 — the game in a plain browser tab
```

`pnpm build` must be run before any `cap sync`; Capacitor copies `dist/` into
the native projects (those copies are gitignored).

## Android

### Debug APK

```sh
cd packages/noun-world-app
pnpm build
pnpm exec cap sync android
cd android
echo "sdk.dir=$ANDROID_HOME" > local.properties   # gitignored
./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

or, in one go, `pnpm android:debug`. Install on a device / emulator with
`adb install -r app/build/outputs/apk/debug/app-debug.apk`, or
`pnpm android:run` to let Capacitor pick a target.

If the SDK is missing the platform or build-tools:

```sh
yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools"
```

`pnpm android:open` opens the project in Android Studio. Chrome
`chrome://inspect` can attach to the WebView (debugging is enabled in
`capacitor.config.ts`; turn it off for store builds).

### Release build

Create an upload keystore once (keep it out of git — `*.jks` / `*.keystore`
are ignored):

```sh
keytool -genkeypair -v -keystore noun-world-upload.jks -alias noun_world_upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

Then add a `signingConfigs.release` block to `android/app/build.gradle` reading
the path/passwords from environment variables (`CM_KEYSTORE_PATH`,
`CM_KEYSTORE_PASSWORD`, `CM_KEY_ALIAS`, `CM_KEY_PASSWORD` are what Codemagic
exports), and run `./gradlew bundleRelease` for the Play Store `.aab`.

## iOS

### Build + run on a Mac

```sh
cd packages/noun-world-app
pnpm build
pnpm exec cap sync ios
pnpm ios:open          # opens ios/App/App.xcodeproj in Xcode
```

In Xcode:

1. Let it resolve the Swift packages (Capacitor + `@capacitor/app` come in via
   `ios/App/CapApp-SPM/Package.swift`; `cap sync` regenerates that file, don't
   edit it).
2. Select the **App** target → _Signing & Capabilities_:
   - **Bundle Identifier**: `wtf.noun.world` (already set in the project;
     register it under _Certificates, Identifiers & Profiles_ in the Apple
     Developer portal, no extra capabilities are required).
   - **Team**: pick your Apple Developer team.
   - **Automatically manage signing**: on for development. Xcode creates a
     development certificate + provisioning profile for the bundle id.
3. Pick a device (the game needs WebGL 2 + a real GPU; the simulator works but
   is slow and has no mic) and press Run.

Required `Info.plist` keys are already in place: `NSMicrophoneUsageDescription`,
landscape-only `UISupportedInterfaceOrientations` for iPhone and iPad,
`UIRequiresFullScreen`, `UIStatusBarHidden`. The deployment target is iOS 15.

### Manual App Store / TestFlight signing

1. In the Apple Developer portal create an **App Store distribution**
   certificate and an **App Store provisioning profile** for `wtf.noun.world`.
2. In Xcode turn _Automatically manage signing_ **off** for the _Release_
   configuration and select that profile.
3. _Product → Archive_, then _Distribute App → App Store Connect_.

From the terminal (equivalent to what CI does):

```sh
cd packages/noun-world-app
xcodebuild -resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/NounWorld.xcarchive archive \
  DEVELOPMENT_TEAM=<TEAMID>
xcodebuild -exportArchive -archivePath build/NounWorld.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/ipa
```

where `ExportOptions.plist` has `method = app-store-connect` and your team id.

## Codemagic

`codemagic.yaml` in this directory defines three workflows:

| Workflow          | Machine     | Output                                                                 |
| ----------------- | ----------- | ---------------------------------------------------------------------- |
| `android-debug`   | Linux       | `app-debug.apk` artifact on every push to `main` / `claude/mobile-app` |
| `android-release` | Linux       | signed `.aab` + `.apk` on `noun-world-app-v*` tags                     |
| `ios-app-store`   | Mac mini M2 | signed `.ipa`, uploaded to TestFlight                                  |

One-time setup in the Codemagic UI:

1. **Add the repo** (GitHub app or OAuth) and pick _codemagic.yaml_ as the
   configuration; set the yaml path to `packages/noun-world-app/codemagic.yaml`
   (_App settings → Configuration_).
2. **iOS signing** — _Teams → Integrations → App Store Connect_: add an API key
   (Users and Access → Integrations → App Store Connect API, role _App
   Manager_) and name the integration `noun_world_asc`. The `ios_signing`
   block then fetches/creates the distribution certificate + profile for
   `wtf.noun.world` automatically. Create the app record in App Store Connect
   with that bundle id first, and put its numeric Apple ID in
   `APP_STORE_APPLE_ID` (used to bump the build number).
3. **Android signing** — _Code signing identities → Android keystores_: upload
   the upload keystore with reference name `noun_world_upload` and fill in the
   alias/passwords. The debug workflow needs nothing.
4. Replace the `you@example.com` recipients (or delete the `email:` blocks).

Both iOS and Android jobs install with
`pnpm install --frozen-lockfile --filter @nouns/noun-world-app --filter @nouns/voxel-engine`
from the repo root, run `pnpm check && pnpm build`, `cap sync`, then the
native build. Expect ~10 min per platform; the game assets (≈100 MB) are
copied, not downloaded.

## Troubleshooting

- **`import/no-unresolved` on `@/miniapps/world2/...` in the pre-commit hook**:
  the root `eslint.config.mjs` has a `packages/noun-world-app` block pointing
  the import resolver at this package's `tsconfig.json`. If you add another
  alias, add it to both `tsconfig.json` `paths` and `vite.config.ts` `alias`.
- **`tsc` complains about `n8ao`**: the ambient declaration lives in the game
  (`n8ao-types.ts`) and is listed in this package's `tsconfig.json` `include`.
- **Gradle `429 Too Many Requests` from Maven Central**: Central rate-limits
  some CI / sandbox egress IPs. Put Google's mirror of Central first with a
  user-level init script (`~/.gradle/init.d/central-mirror.gradle`):

  ```groovy
  def mirror = 'https://maven-central.storage-download.googleapis.com/maven2/'
  settingsEvaluated { s -> s.pluginManagement.repositories { maven { url = mirror } } }
  allprojects {
    buildscript { repositories { maven { url = mirror } } }
    repositories { maven { url = mirror } }
  }
  ```

  and rerun; the dependency cache also fills up across retries.

- **Black screen on device**: WebGL 2 is required; the game navigates to
  `/world/classic` on a fatal WebGL error, which the app renders as a retry
  screen (`src/App.tsx`).
- **No sound on iOS with the mute switch on**: `AppDelegate.swift` must set the
  `AVAudioSession` category to `.playAndRecord` / `.playback`; check the Xcode
  console for `AVAudioSession setup failed`.
