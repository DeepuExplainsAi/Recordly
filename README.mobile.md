# Recordly Mobile (Android)

Offline Android port of Recordly. Recording, editing and export run on the phone; there is no server, account or network dependency.

## Use
Install the APK from the Releases page (allow "install unknown apps"). Tap **Record new**, grant screen-capture and mic permission, record, then edit and **Publish → Export Video**. Exports are saved to `Movies/Recordly` in the gallery.

## Build
```
npm install --legacy-peer-deps
npx vite build --config vite.mobile.config.ts
npx cap sync android
cd android && ./gradlew assembleDebug      # JDK 21, Android SDK 35
```
Release signing: set `RECORDLY_KEYSTORE`, `RECORDLY_STORE_PASSWORD` (and optional `RECORDLY_KEY_ALIAS`) then `./gradlew assembleRelease`.
CI: `ci/android.yml` (copy to `.github/workflows/` to enable; needs a token with `workflow` scope) (secrets `RECORDLY_KEYSTORE_B64`, `RECORDLY_STORE_PASSWORD` for signed builds).

## Architecture
See `HANDOFF.md`. Capacitor 7 WebView hosts the React editor; `src/mobile/electronShim.ts` replaces the Electron IPC with IndexedDB + localStorage; screen capture is a native MediaProjection foreground service.

## Not done / untested
Never run on a physical device or emulator. Camera/webcam overlay recording is not implemented. Desktop-only features (cursor telemetry, native exporters, auto-zoom from cursor, global shortcuts) are unavailable. The signing key lives only on the build machine, so keep your own copy if you publish updates.
