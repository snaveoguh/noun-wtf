import type { CapacitorConfig } from '@capacitor/cli';

// The app loads the live game at noun.wtf/world (multiplayer, NOUN FM, trade
// and stats all need the site's server). www/ only holds the offline page
// shown when there's no connection. Point a build at staging with
// NOUN_WORLD_URL=https://dev-noun-wtf.netlify.app/world npx cap sync
const url = process.env.NOUN_WORLD_URL ?? 'https://noun.wtf/world?source=app';
const host = new URL(url).hostname;

const config: CapacitorConfig = {
  appId: 'wtf.noun.world',
  appName: 'Noun World',
  webDir: 'www',
  backgroundColor: '#181230',
  loggingBehavior: 'none',
  server: {
    url,
    cleartext: false,
    // Capacitor's local page when the remote one can't load
    errorPath: 'offline.html',
    // stay inside the app for the game's own pages; everything else opens outside
    allowNavigation: [host],
  },
  ios: {
    contentInset: 'never',
    scrollEnabled: false,
    allowsLinkPreview: false,
    preferredContentMode: 'mobile',
    backgroundColor: '#181230',
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#181230',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      launchFadeOutDuration: 300,
      backgroundColor: '#181230',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
