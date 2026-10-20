// Game settings for the native projects `cap add` generates. Idempotent:
// run it after every `cap add` / Capacitor upgrade (npm run patch).
//
//   iOS:     status bar hidden, full screen on iPad, mic prompt (voice chat),
//            no export-compliance question, audio plays with the silent
//            switch on and mixes with other apps (AVAudioSession .playback).
//   Android: full screen + immersive (nav bar hidden, swipe to peek), mic
//            permission for voice chat, draws into the notch.
//
// usage: node scripts/patch-native.mjs ios android
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARK = 'noun-world:patched';

export const MIC_WHY =
  'Noun World uses the microphone only for optional proximity voice chat with other players.';

const PLIST_KEYS = [
  ['UIStatusBarHidden', '<true/>'],
  ['UIViewControllerBasedStatusBarAppearance', '<false/>'],
  ['UIRequiresFullScreen', '<true/>'],
  ['ITSAppUsesNonExemptEncryption', '<false/>'],
  ['NSMicrophoneUsageDescription', `<string>${MIC_WHY}</string>`],
];

/** Info.plist: set each key (replacing an existing value). */
export function patchPlist(xml) {
  let out = xml;
  for (const [key, value] of PLIST_KEYS) {
    const re = new RegExp(`(<key>${key}</key>\\s*)(<true/>|<false/>|<string>[^<]*</string>)`);
    if (re.test(out)) out = out.replace(re, `$1${value}`);
    else out = out.replace(/(<dict>)/, `$1\n\t<key>${key}</key>\n\t${value}`);
  }
  return out;
}

const AUDIO_SNIPPET = `        // ${MARK}: game audio plays with the silent switch on, mixed with other apps
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
`;

/** AppDelegate.swift: AVAudioSession .playback at launch. */
export function patchAppDelegate(swift) {
  if (swift.includes(MARK)) return swift;
  let out = swift;
  if (!/^import AVFoundation$/m.test(out))
    out = out.replace(/^import UIKit$/m, 'import UIKit\nimport AVFoundation');
  const re = /(didFinishLaunchingWithOptions[^{]*\{\n)/;
  if (!re.test(out))
    throw new Error('AppDelegate.swift: no didFinishLaunchingWithOptions to patch');
  return out.replace(re, `$1${AUDIO_SNIPPET}`);
}

const PERMS = ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS'];

/** AndroidManifest.xml: mic permissions for voice chat. */
export function patchManifest(xml) {
  let out = xml;
  for (const p of PERMS) {
    if (out.includes(`"${p}"`)) continue;
    out = out.replace(/(\n\s*<\/manifest>)/, `\n    <uses-permission android:name="${p}" />$1`);
  }
  return out;
}

const FULLSCREEN_ITEMS = [
  ['android:windowFullscreen', 'true'],
  ['android:windowLayoutInDisplayCutoutMode', 'shortEdges'],
];

/** styles.xml: every AppTheme style goes full screen into the notch. */
export function patchStyles(xml) {
  return xml.replace(
    /(<style name="AppTheme[^"]*"[^>]*>)([\s\S]*?)(<\/style>)/g,
    (all, open, body, close) => {
      let b = body;
      for (const [name, value] of FULLSCREEN_ITEMS) {
        if (b.includes(`name="${name}"`)) continue;
        b = `${b.replace(/\s*$/, '')}\n        <item name="${name}">${value}</item>\n    `;
      }
      return `${open}${b}${close}`;
    },
  );
}

/** MainActivity: immersive mode (bars hidden, swipe to show them briefly). */
export function patchMainActivity(java, pkg) {
  if (java.includes(MARK)) return java;
  if (!/class MainActivity extends BridgeActivity\s*\{\s*\}/.test(java))
    throw new Error(
      'MainActivity.java is not the stock Capacitor template; patch it by hand (see README)',
    );
  return `package ${pkg};

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

// ${MARK}: a game, so immersive full screen (bars come back with a swipe)
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        hideBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideBars();
    }

    private void hideBars() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
`;
}

function edit(file, fn) {
  if (!existsSync(file))
    throw new Error(`missing ${path.relative(ROOT, file)}: run \`npx cap add\` first`);
  const before = readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) writeFileSync(file, after);
  console.log(`${after === before ? 'ok     ' : 'patched'} ${path.relative(ROOT, file)}`);
}

function ios() {
  const app = path.join(ROOT, 'ios/App/App');
  edit(path.join(app, 'Info.plist'), patchPlist);
  edit(path.join(app, 'AppDelegate.swift'), patchAppDelegate);
}

function android() {
  const main = path.join(ROOT, 'android/app/src/main');
  edit(path.join(main, 'AndroidManifest.xml'), patchManifest);
  edit(path.join(main, 'res/values/styles.xml'), patchStyles);
  const pkg = 'wtf.noun.world';
  edit(path.join(main, 'java', ...pkg.split('.'), 'MainActivity.java'), j =>
    patchMainActivity(j, pkg),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const which = process.argv.slice(2);
  if (which.length === 0) which.push('ios', 'android');
  for (const w of which) {
    if (w === 'ios') ios();
    else if (w === 'android') android();
    else throw new Error(`unknown platform ${w}`);
  }
}
