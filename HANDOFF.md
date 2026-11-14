# HANDOFF — Recordly → Android APK (fully local, no server)

Repo: fork DeepuExplainsAi/Recordly, branch `mobile-apk`. Upstream: webadderallorg/Recordly (Electron desktop app).
Goal: working Android APK, mobile-first UI, all processing on-device (no server/cloud cost).
Rule: after EACH part: commit, push to `fork mobile-apk`, then update this file (Status log) and push again. Don't ask the user; continue to next part.

## Approach
Capacitor (Android WebView) wraps the Vite/React renderer. `window.electronAPI` (Electron IPC, ~166 methods, typed in electron/electron-env.d.ts) is replaced by a shim in `src/mobile/` using web APIs + Capacitor plugins (Filesystem, Preferences). Capture via getDisplayMedia / MediaRecorder (Android foreground service plugin if needed). Export via existing WebCodecs/canvas exporter (src/lib/exporter), no ffmpeg/native helpers, no cloud.

## Parts
1. [x] Toolchain: JDK17 + Android SDK + Capacitor installed; env notes below
2. [x] Mobile entry (mobile.html/main), Vite mobile config, electronAPI shim (stubs + local storage)
3. [x] Capacitor Android project, debug APK builds
4. [ ] Recording on-device (screen/camera/mic) + save to app storage
5. [ ] Editor works on touch: responsive layout, touch timeline
6. [ ] Local export (WebCodecs/MP4/GIF) -> save to gallery/Downloads
7. [ ] Remove cloud/auth/billing/update/telemetry paths (no server)
8. [ ] Signed release APK, README, CI workflow

## Status log
- Part 1 done: toolchain installed.
- (start) Repo cloned, forked, branch created. Env: node 24, no JDK/Android SDK initially; root disk ~3.5G free.

## Env notes
- JDK17 via apt (needs `mkdir -p /usr/share/man/man1; dpkg --configure -a` if apt errors). /opt, apt installs reset on VM rebuild; only /root persists (2G!).
- Android SDK at /root/android-sdk (platform 34, build-tools 34.0.0). `export ANDROID_HOME=/root/android-sdk`.
- Put Gradle cache on / : `export GRADLE_USER_HOME=/opt/gradle` (/root too small).
- gh logged in as DeepuExplainsAi; `gh auth setup-git` done; remote `fork` = DeepuExplainsAi/Recordly.
- node_modules is a symlink-like bind mount to /opt/nm (disk). VM has 480MB RAM: build with NODE_OPTIONS=--max-old-space-size=2200 and a 2G swap at /opt/swap (`fallocate -l 2G /opt/swap; mkswap; swapon`). Re-create after VM rebuild.
- package.json was trimmed for mobile (removed electron, electron-builder, vite-plugin-electron*, ffmpeg-static, sherpa-onnx, uiohook, capturekit, electron-updater, playwright). Added explicit deps heroui needs (@react-aria/*, etc.) via --legacy-peer-deps. Install: `npm install --ignore-scripts --legacy-peer-deps`.
- Renderer build: `npx vite build --config vite.mobile.config.ts` -> dist-mobile/ (OK, ~80s, 76MB). Alias stub for @radix-ui/primitive/is-development in src/mobile/.
- Part 2 done: src/mobile/{fileStore,electronShim,saveToDevice,installShim}.ts. Shim = window.electronAPI backed by IndexedDB (virtual paths /recordly/{recordings,projects,imports,exports}) + localStorage settings; unimplemented methods fall back via Proxy (on* -> no-op unsubscribe, others -> {success:false}). main.tsx imports ./mobile/installShim first. index.html defaults to ?windowType=editor&startupView=home. Build passes (tsc clean for src/mobile).
- Known gaps for later parts: recording (startNativeScreenRecording etc. -> use getDisplayMedia/MediaRecorder path in src/hooks), saveToDevice is browser download (swap to Capacitor Filesystem/Share), cloud/auth/updates UI still present (Part 7), touch layout (Part 5), HUD/source-selector windows not applicable on mobile.
- Part 3 done: Capacitor 7 (JDK 21 required by cap android lib; SDK platform 35 + build-tools 35 installed) -> `android/` committed. Debug APK built OK: android/app/build/outputs/apk/debug/app-debug.apk (72MB; copy at ~/apk/recordly-debug.apk). appId com.recordly.mobile, minSdk 23, target 35. Manifest has CAMERA/RECORD_AUDIO/MODIFY_AUDIO_SETTINGS.
- BUILD RECIPE: `export ANDROID_HOME=/root/android-sdk GRADLE_USER_HOME=/opt/gradle JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64`; `NODE_OPTIONS=--max-old-space-size=2200 npx vite build --config vite.mobile.config.ts && npx cap sync android && cd android && ./gradlew assembleDebug --no-daemon` (android/local.properties needs sdk.dir; gradle.properties has -Xmx768m, daemon off). Gradle wrapper uses -bin dist.
- DISK WARNING: VM root (/) is ~9.8G and nearly full; /opt/gradle ~1G, /opt/nm ~0.8G. Don't recreate big swap (use 1G). Free space: rm -rf /var/cache/pkg/npm /tmp/* android/app/build. Don't touch /usr/local/install (preinstalled tools).
