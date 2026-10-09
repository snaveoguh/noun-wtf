import type { CapacitorConfig } from '@capacitor/cli';

// Noun World ships the game build (dist/) inside the app; there is no
// live-site wrapper. Orientation lock, full-screen and the mic permission
// are declared in the native projects (android/ and ios/), see README.md.
const config: CapacitorConfig = {
  appId: 'wtf.noun.world',
  appName: 'Noun World',
  webDir: 'dist',
  // Dark splash + web view background so the first frame is never white.
  backgroundColor: '#0d1117',
  android: {
    // Serve the bundle from https://localhost so getUserMedia (mic) and
    // WebRTC are allowed (they need a secure context).
    allowMixedContent: false,
    webContentsDebuggingEnabled: true,
    backgroundColor: '#0d1117',
  },
  ios: {
    // The game draws edge to edge in landscape; never pad for the notch.
    contentInset: 'never',
    backgroundColor: '#0d1117',
    scrollEnabled: false,
    // The game lays out its own overlay, keep WebKit's zoom off.
    preferredContentMode: 'mobile',
  },
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
