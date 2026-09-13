# stupidfont — native shells (iOS + Android)

Capacitor 8 wrappers around the web app in `packages/nouns-webapp/public/stupidfont/`.
The web code is bundled *into* the app (no live URL loading), which is what keeps
Apple's "minimum functionality" reviewers happy and makes it work offline.

App id `wtf.noun.stupidfont` · name `stupidfont` · version 1.0.0 (build 1)

## State on 13 Sep 2026

| | Android | iOS |
|---|---|---|
| Project generated | ✅ `android/` | ✅ `ios/` (Swift Package Manager, no CocoaPods) |
| Icons, portrait, version | ✅ | ✅ |
| Privacy manifest | n/a | ✅ `PrivacyInfo.xcprivacy` wired into the target |
| Release build | ✅ signed AAB + APK (see below) | ⛔ needs Xcode on this Mac |
| Tested on device | ❌ not yet (no emulator here) | ❌ |
| Store assets | ✅ `store/` | ✅ `store/` |

## Toolchain (already installed, user-local, no sudo)

- JDK 21: `~/.bubblewrap/jdk21/Contents/Home` (Capacitor 8 needs 21; the JDK 17 next to it is unused)
- Android SDK: `~/.bubblewrap/android_sdk` (platform 36, build-tools 36, licences accepted)
- `android/local.properties` points at that SDK. Gradle 8.14 downloads itself.

Rebuild Android:
```bash
cd stupidfont-app && npm run sync && cd android && \
JAVA_HOME=~/.bubblewrap/jdk21/Contents/Home ./gradlew bundleRelease assembleRelease
```
Outputs: `android/app/build/outputs/bundle/release/app-release.aab` (upload this) and
`.../apk/release/app-release.apk` (sideload for testing: `adb install`).

## Android signing (read this)

`android/upload.keystore` + `android/keystore.properties` were generated on 13 Sep 2026
(alias `upload`, 24-char random password in the properties file). Both are **gitignored**.
**Back them up somewhere safe now** (password manager). If they are lost you can still
recover via Play App Signing's "reset upload key" flow, but it's a support ticket.

Upload cert SHA-256:
`93:6F:96:99:CB:0A:F3:41:FF:53:5F:CF:4C:B7:FB:87:63:B5:7D:2A:A8:C9:53:1E:C4:A4:CB:E1:DF:20:0C:7A`

## What only you can do — Google Play

1. https://play.google.com/console → create developer account (one-time US$25). New personal
   accounts must run a 14-day closed test with 12 testers before production is unlocked.
2. Create app → name `stupidfont`, app, free.
3. **Store listing**: paste from `store/LISTING.md`; upload `store/app-icon-1024.png` (hi-res icon),
   `store/feature-graphic-1024x500.png`, and the four `store/shot-android-*.png`.
4. **App content**: privacy policy `https://noun.wtf/stupidfont/privacy.html`; ads: no; content rating
   questionnaire (all no → Everyone); target audience 13+ (not designed for children); data safety:
   "does not collect or share user data"; news app: no; COVID: no; government app: no.
5. **Release** → Testing → Closed testing → create release → let Google manage the signing key (Play App
   Signing, default) → upload `~/Downloads/stupidfont-android/stupidfont-1.0.0.aab` → roll out.
6. After the closed test, promote to production.

## What only you can do — Apple

1. Install Xcode from the Mac App Store (~10 GB), open it once, accept the licence, install the iOS
   platform when prompted.
2. Apple Developer Program: https://developer.apple.com/programs/ (US$99/yr). Wait for approval.
3. `cd stupidfont-app && npm run sync && npm run ios` → Xcode opens `ios/App/App.xcworkspace`.
   Signing & Capabilities → Team: pick yours → "Automatically manage signing". Bundle id is
   already `wtf.noun.stupidfont`.
4. Run on a simulator first (Product → Run). Check: draw, takes, export → share sheet appears,
   load font from Files. Then Product → Archive → Distribute → App Store Connect → Upload.
5. https://appstoreconnect.apple.com → My Apps → + → iOS app, bundle id `wtf.noun.stupidfont`,
   SKU `stupidfont`. Fill from `store/LISTING.md`. Screenshots: the four `store/shot-ios-6.7-*.png`
   (1290×2796, the required 6.7" size; Apple scales down for smaller phones). Age rating: all None.
   App Privacy: Data Not Collected. Encryption: already declared in Info.plist.
6. Pick the uploaded build, submit for review. Add review notes: "Font editor. No login. Draw a letter,
   tap export to see the share sheet." Expect 1–3 days.

Screenshots were captured in headless Chromium at exact device sizes. Once Xcode is installed
you can retake them from the simulator if you'd rather have real device chrome.

## Web (PWA) side, already live

`https://noun.wtf/stupidfont/` has a manifest, service worker (offline), icons, and the privacy
page. Chrome on Android and Safari on iOS both offer "Add to Home Screen" without any store.

## Updating the app

Edit the web app → `npm run sync` → bump `versionCode`/`versionName` in `android/app/build.gradle`
and `CURRENT_PROJECT_VERSION`/`MARKETING_VERSION` in Xcode → rebuild → upload. Bump `V` in
`public/stupidfont/sw.js` for the web install.
