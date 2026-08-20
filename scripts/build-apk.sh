#!/usr/bin/env bash
# Build an installable Qadam APK.
#
#   ./scripts/build-apk.sh                 release APK, signed with a local keystore
#   ./scripts/build-apk.sh --debug         debug APK, no keystore needed
#   ./scripts/build-apk.sh --bundle-only   just prove the JS bundles, skip the native build
#
# TWO ROUTES TO AN APK, AND WHY YOU MIGHT WANT EITHER
#
#   EAS (no Android SDK on this machine):
#       npm --prefix mobile install --no-save eas-cli
#       npx --prefix mobile eas login
#       npx --prefix mobile eas build --platform android --profile preview
#     The `preview` profile in mobile/eas.json builds buildType "apk", so the
#     link EAS hands back is a file a phone can install. `production` builds an
#     .aab because that is what Play requires — an .aab is not installable by
#     hand, so do not reach for it when what you want is an APK.
#
#   Locally (this script): needs the Android SDK. Qadam is NOT an Expo Go app —
#   Health Connect, HealthKit, AdMob and Play Integrity are native modules, so
#   there is no route that skips a real build.
#
# WHAT THE APK IS SIGNED WITH
#
#   A release APK has to be signed by something. If android/app/qadam.keystore
#   does not exist this script generates one and tells you where it is. THAT
#   FILE IS YOUR APP'S IDENTITY: lose it and Play will never accept an update to
#   this package name again. Back it up somewhere that is not this repo — and
#   note .gitignore already refuses to commit *.jks and *.p12 for you.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/mobile"

MODE="release"
BUNDLE_ONLY="no"
for arg in "$@"; do
  case "$arg" in
    --debug)       MODE="debug" ;;
    --bundle-only) BUNDLE_ONLY="yes" ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
# 1. Does the app even bundle?
#
# Metro finds a broken import in ten seconds; Gradle finds it in eleven minutes,
# after downloading half of Maven. Always ask the cheap question first.
# ---------------------------------------------------------------------------
say "bundling the JavaScript"
rm -rf dist
npx expo export --platform android --output-dir dist >/dev/null
BUNDLE="$(find dist/_expo/static/js/android -name '*.hbc' -o -name '*.js' | head -1)"
if [ -z "$BUNDLE" ]; then
  echo "no bundle was produced — fix that before going near Gradle" >&2
  exit 1
fi
echo "   ok: $(du -h "$BUNDLE" | cut -f1) of Hermes bytecode"

if [ "$BUNDLE_ONLY" = "yes" ]; then
  echo
  echo "   --bundle-only: stopping here. The JS is fine."
  exit 0
fi

# ---------------------------------------------------------------------------
# 2. The Android SDK
# ---------------------------------------------------------------------------
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
if [ ! -d "$SDK/platform-tools" ] && [ ! -d "$SDK/cmdline-tools" ]; then
  cat >&2 <<EOF

No Android SDK at $SDK.

  Install it once:
    mkdir -p "\$HOME/Android/Sdk/cmdline-tools"
    curl -o /tmp/cmdline-tools.zip \\
      https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
    unzip -q /tmp/cmdline-tools.zip -d "\$HOME/Android/Sdk/cmdline-tools"
    mv "\$HOME/Android/Sdk/cmdline-tools/cmdline-tools" "\$HOME/Android/Sdk/cmdline-tools/latest"
    export ANDROID_HOME="\$HOME/Android/Sdk"
    yes | "\$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses
    "\$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \\
      "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006"

  Or skip all of it and let EAS build it in the cloud:
    npm --prefix mobile install --no-save eas-cli
    npx --prefix mobile eas build --platform android --profile preview

EOF
  exit 1
fi
export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"

# ---------------------------------------------------------------------------
# 3. Generate the native project
#
# android/ is gitignored on purpose: it is generated from app.json by the config
# plugins, and a committed copy is a copy that silently stops matching. --clean
# so a stale one from an older app.json cannot survive.
# ---------------------------------------------------------------------------
say "generating the native project"
npx expo prebuild --platform android --clean

# ---------------------------------------------------------------------------
# 4. Signing
# ---------------------------------------------------------------------------
if [ "$MODE" = "release" ]; then
  KEYSTORE="$ROOT/mobile/android/app/qadam.keystore"
  if [ ! -f "$KEYSTORE" ]; then
    say "generating a release keystore"
    keytool -genkeypair -v -storetype PKCS12 \
      -keystore "$KEYSTORE" -alias qadam \
      -keyalg RSA -keysize 2048 -validity 10000 \
      -storepass "${QADAM_KEYSTORE_PASSWORD:-qadamqadam}" \
      -keypass  "${QADAM_KEYSTORE_PASSWORD:-qadamqadam}" \
      -dname "CN=Qadam, OU=Mobile, O=Qadam, L=Lahore, C=PK"
    cat <<EOF

  Keystore written to $KEYSTORE

  BACK THIS UP. It is your app's identity. Lose it and Google Play will never
  accept another update to com.qadam.app — you would have to ship a new listing
  under a new package name and leave every installed user behind.

EOF
  fi

  cat > android/keystore.properties <<EOF
storeFile=qadam.keystore
storePassword=${QADAM_KEYSTORE_PASSWORD:-qadamqadam}
keyAlias=qadam
keyPassword=${QADAM_KEYSTORE_PASSWORD:-qadamqadam}
EOF

  # Point the release buildType at it. Prebuild regenerates build.gradle every
  # run, so this patch is applied every run rather than committed.
  python3 - <<'PY'
import re, pathlib
p = pathlib.Path('android/app/build.gradle')
s = p.read_text()
if 'qadamRelease' not in s:
    s = s.replace(
        'signingConfigs {',
        '''signingConfigs {
        qadamRelease {
            def props = new Properties()
            def f = rootProject.file('keystore.properties')
            if (f.exists()) {
                props.load(new FileInputStream(f))
                storeFile file(props['storeFile'])
                storePassword props['storePassword']
                keyAlias props['keyAlias']
                keyPassword props['keyPassword']
            }
        }''', 1)
    s = re.sub(r'(release \{\n(?:.*\n)*?\s*)signingConfig signingConfigs\.debug',
               r'\1signingConfig signingConfigs.qadamRelease', s, count=1)
    p.write_text(s)
    print('   build.gradle: release signs with qadam.keystore')
PY
fi

# ---------------------------------------------------------------------------
# 5. Build
# ---------------------------------------------------------------------------
say "gradle assemble${MODE^}"
cd android
./gradlew "assemble${MODE^}" --no-daemon
cd ..

APK="$(find android/app/build/outputs/apk -name '*.apk' -newermt '-10 minutes' | head -1)"
if [ -z "$APK" ]; then
  echo "gradle finished but produced no apk" >&2
  exit 1
fi

VERSION="$(node -p "require('./app.json').expo.version")"
mkdir -p "$ROOT/dist"
OUT="$ROOT/dist/qadam-$VERSION-$MODE.apk"
cp "$APK" "$OUT"

say "done"
echo "   $OUT  ($(du -h "$OUT" | cut -f1))"
echo
echo "   Install it:  adb install -r \"$OUT\""
echo "   Or send the file to a phone and open it — Android will ask about"
echo "   'install from unknown sources' once, which is expected for a build"
echo "   that has not come from Play."
