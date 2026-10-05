# Venband for Android and iOS

The phone apps are [Capacitor](https://capacitorjs.com) shells around the same web app as www.venband.com
(built into `../dist`), so every web update ships to the apps with the next app release. Native extras:
app icon and splash screen, status bar, back button, haptics, microphone/camera permissions and links
(`venband://…` and `https://www.venband.com/invite/…`) that open the app.

## Build it yourself

```bash
cd mobile
npm install
npm run sync          # builds the web app and copies it into android/ and ios/
npm run android       # opens Android Studio  → Run, or Build → Generate Signed Bundle
npm run ios           # opens Xcode (Mac only) → pick your team → Product → Archive
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (like `.env.local` for the website) before building.

Icons and splash screens come from `assets/` (made by `scripts/make-app-icons.mjs`); regenerate with `npm run assets`.

## Publishing

**Google Play** (one-time $25 developer account):
1. Create a signing key: `keytool -genkey -v -keystore venband.keystore -alias venband -keyalg RSA -keysize 2048 -validity 10000`
   — keep it safe; you need the same key for every update.
2. Either build in Android Studio (Build → Generate Signed Bundle) or add the keystore as GitHub secrets
   (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`)
   and push a tag `mobile-v1.0.0` — `.github/workflows/mobile.yml` builds the `.aab`.
3. Upload the `.aab` in the Play Console, paste the listing from `store/google-play.md`, fill in the
   Data safety form with the answers there, and send it for review.
4. For `https://www.venband.com/invite/…` links to open the app directly, add
   `/.well-known/assetlinks.json` to the website with your signing key’s SHA-256 fingerprint.

**App Store** (Apple Developer Program, $99/year, needs a Mac with Xcode):
1. Open `ios/App/App.xcodeproj`, set your Team and the bundle ID `com.venband.app`.
2. Product → Archive → Distribute App → App Store Connect.
3. In App Store Connect use the text in `store/app-store.md`, add screenshots, a demo account and submit.
