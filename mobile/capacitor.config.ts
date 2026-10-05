import type { CapacitorConfig } from '@capacitor/cli';

// The app ships the same web app as www.venband.com (built into ../dist), so
// it starts instantly and works like the website — with native extras:
// app icon, splash screen, status bar, back button, haptics and
// venband:// / https://www.venband.com links that open the app.
const config: CapacitorConfig = {
  appId: 'com.venband.app',
  appName: 'Venband',
  webDir: '../dist',
  backgroundColor: '#000000',
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: 'never',
    scheme: 'Venband',
    limitsNavigationsToAppBoundDomains: false,
  },
  server: {
    androidScheme: 'https',
    iosScheme: 'venband',
    // Venband talks to Supabase and the Venband API; everything else opens in the browser
    allowNavigation: ['www.venband.com', 'venband.com', '*.supabase.co'],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: '#000000',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: { style: 'DARK', backgroundColor: '#000000', overlaysWebView: false },
    Keyboard: { resize: 'native' as never, resizeOnFullScreen: true },
  },
};

export default config;
