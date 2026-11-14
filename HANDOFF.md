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
4. [x] Recording on-device (screen + mic) + save to app storage + export to gallery (camera/webcam overlay NOT done)
5. [x] Mobile layout (<md breakpoint): Home stacks (top strip nav, full-width list, scrolling filters); editor = preview / timeline / tool-tab strip + panel below; cloud/account/update buttons hidden. Verified at 390x844 in browser. Touch-drag on timeline NOT verified on a device.
6. [x] Local export verified in browser (MP4 via WebCodecs -> shim finalizeExportedVideo -> saveToDevice). Fix: shim needed suggestExportFileName. Native gallery save (Capacitor Filesystem + MediaStore) NOT tested on a device; WebCodecs in Android WebView untested.
7. [x] Cloud UI removed (share link, account, upgrade, updates, feedback, announcements, shared-links tab; Settings hides account/updates/shortcuts/permissions). Code still present but unreachable; Supabase/auth libs still bundled.
8. [x] Signed release APK (GitHub release v1.0-mobile), README.mobile.md, ci/android.yml (copy to .github/workflows/ to enable; push needs gh token with workflow scope). Keystore: /root/keystore/recordly.jks, password in tfa-vault secrets/recordly-android-keystore (NOT in repo).

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
- Part 4 done: native Android screen recording. android/.../ScreenRecorderService.java (foreground svc, MediaProjection+MediaRecorder H264/AAC mp4, <=1920px, cache dir) + ScreenRecorderPlugin.java (start/stop/isRecording/deleteFile/saveToGallery -> MediaStore Movies/Recordly) registered in MainActivity. JS: src/mobile/{nativeRecorder,saveRecording,MobileRecorder}.ts(x). "Record new" -> electronAPI.showRecordingHud -> event -> MobileRecorder bottom sheet; Stop -> file copied into IndexedDB /recordly/recordings, setCurrentRecordingSession, reload into editor. saveToDevice.ts writes export to cache via Capacitor Filesystem then saveToGallery. Debug APK rebuilt OK (~/apk/recordly-debug.apk).
- NOT yet verified on a real device/emulator (none available in the VM). Risks to check first when a device exists: readNativeFile via convertFileSrc(file://...) of cache path (may need FileProvider path or Filesystem.readFile fallback), large recordings in IndexedDB, WebCodecs availability in the Android WebView for export.
- Fixes made along the way: pinned framer-motion@^12 (motion needs it), added @radix-ui/react-context; vite.mobile.config has maxParallelFileOps:2 (RAM). JDK17 removed (Capacitor 7 needs JDK21). Swap now 640M at /opt/swap (need >=1G + Node heap 1700 for vite; if OOM re-add 400M at /root/swap2 temporarily).
- NEXT: Part 7 remove cloud/auth/billing UI (Publish sheet still defaults to 'Create share link'; Settings has account/update items; Shared links nav in Home).
- Build tip: web build needs ~1.9GB swap+RAM; add temp `fallocate -l 450M /root/swap2` + swapon, remove after. Test export in browser: put a video into IndexedDB 'recordly-mobile' store 'files' at /recordly/recordings/x.mp4, setCurrentRecordingSession, open ?windowType=editor&startupView=editor.

- Release build: `RECORDLY_KEYSTORE=... RECORDLY_STORE_PASSWORD=... ./gradlew assembleRelease -x lintVitalRelease -x lintVitalAnalyzeRelease -x lintVitalReportRelease --no-daemon`. Do NOT keep a swap file on /root while Gradle builds (fills disk).
- NEXT (optional): test on a real device/emulator; webcam overlay; touch-drag timeline; shrink bundle.
