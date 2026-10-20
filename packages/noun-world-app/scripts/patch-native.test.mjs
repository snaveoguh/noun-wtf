import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MIC_WHY,
  patchAppDelegate,
  patchMainActivity,
  patchManifest,
  patchPlist,
  patchStyles,
} from './patch-native.mjs';

// trimmed copies of what `cap add` (Capacitor 8) generates
const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>Noun World</string>
\t<key>UIViewControllerBasedStatusBarAppearance</key>
\t<true/>
</dict>
</plist>`;

const DELEGATE = `import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }
}`;

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="@string/app_name"></application>
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>`;

const STYLES = `<resources>
    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
    </style>
    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
    </style>
    <style name="Other"><item name="x">1</item></style>
</resources>`;

const ACTIVITY = `package wtf.noun.world;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
`;

const twice = (fn, s) => {
  const once = fn(s);
  assert.equal(fn(once), once, 'idempotent');
  return once;
};

test('Info.plist: status bar hidden, full screen, mic reason, exempt encryption', () => {
  const out = twice(patchPlist, PLIST);
  assert.match(out, /<key>UIStatusBarHidden<\/key>\s*<true\/>/);
  assert.match(out, /<key>UIViewControllerBasedStatusBarAppearance<\/key>\s*<false\/>/);
  assert.match(out, /<key>UIRequiresFullScreen<\/key>\s*<true\/>/);
  assert.match(out, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  assert.ok(out.includes(`<string>${MIC_WHY}</string>`));
  assert.equal(out.match(/UIViewControllerBasedStatusBarAppearance/g).length, 1);
});

test('AppDelegate: playback audio session at launch', () => {
  const out = twice(patchAppDelegate, DELEGATE);
  assert.match(out, /^import AVFoundation$/m);
  assert.match(out, /didFinishLaunchingWithOptions[^{]*\{\n.*noun-world:patched/);
  assert.ok(out.includes('setCategory(.playback'));
});

test('AndroidManifest: mic permissions once', () => {
  const out = twice(patchManifest, MANIFEST);
  assert.equal(out.match(/RECORD_AUDIO/g).length, 1);
  assert.equal(out.match(/MODIFY_AUDIO_SETTINGS/g).length, 1);
  assert.match(out, /<\/manifest>$/);
});

test('styles: only AppTheme styles go full screen', () => {
  const out = twice(patchStyles, STYLES);
  assert.equal(out.match(/windowFullscreen/g).length, 2);
  assert.equal(out.match(/shortEdges/g).length, 2);
  assert.match(out, /<style name="Other"><item name="x">1<\/item><\/style>/);
});

test('MainActivity: immersive, refuses a customised file', () => {
  const out = twice(j => patchMainActivity(j, 'wtf.noun.world'), ACTIVITY);
  assert.match(out, /^package wtf\.noun\.world;/);
  assert.ok(out.includes('BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE'));
  assert.throws(() => patchMainActivity(ACTIVITY.replace('{}', '{ int x; }'), 'wtf.noun.world'));
});
