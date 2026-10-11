#!/usr/bin/env bash
set -euo pipefail

# The runner defines every public build variable; local dotenv files cannot change it.
export EXPO_NO_DOTENV=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ARTIFACTS_BUILDS_DIR="$REPO_ROOT/.artifacts/mobile-e2e/builds"

# Ensure Node and NVM are in PATH if available
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
fi

# Java Discovery
if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -d "/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home" ]]; then
    export JAVA_HOME="/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home"
  elif [[ -d "/usr/lib/jvm/java-17-openjdk-amd64" ]]; then
    export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
  fi
fi
if [[ -n "${JAVA_HOME:-}" ]]; then
  export PATH="$JAVA_HOME/bin:$PATH"
fi

VARIANT="test"
CLEAN_BUILD=false
SKIP_NPM_CI=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --variant)
      VARIANT="$2"
      shift 2
      ;;
    --clean)
      CLEAN_BUILD=true
      shift
      ;;
    --no-npm-ci)
      SKIP_NPM_CI=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--variant test|consumer|all] [--clean] [--no-npm-ci]" >&2
      exit 1
      ;;
  esac
done

echo "=================================================="
echo "Ride Maker Mobile E2E Bootstrap & Build Runner"
echo "Variant: $VARIANT"
echo "Clean Build: $CLEAN_BUILD"
echo "=================================================="

# 1. Environment & Toolchain Verification
echo "[1/4] Verifying Toolchain..."
echo "Node: $(node --version)"
echo "NPM: $(npm --version)"

if command -v java >/dev/null 2>&1; then
  echo "Java: $(java -version 2>&1 | head -n 1)"
else
  echo "ERROR: java is not installed or not in PATH." >&2
  exit 1
fi

if [[ -z "${ANDROID_HOME:-}" ]]; then
  if [[ -d "$HOME/Library/Android/sdk" ]]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
  elif [[ -d "$HOME/Android/Sdk" ]]; then
    export ANDROID_HOME="$HOME/Android/Sdk"
  else
    echo "ERROR: ANDROID_HOME is not set and standard Android SDK path not found." >&2
    exit 1
  fi
fi
echo "ANDROID_HOME: $ANDROID_HOME"

AAPT_BIN=""
if compgen -G "$ANDROID_HOME/build-tools/*" > /dev/null; then
  for bdir in $(ls -d "$ANDROID_HOME"/build-tools/* 2>/dev/null | sort -V -r); do
    if [[ -x "$bdir/aapt" ]]; then
      AAPT_BIN="$bdir/aapt"
      break
    fi
  done
fi

if [[ -z "$AAPT_BIN" || ! -x "$AAPT_BIN" ]]; then
  echo "ERROR: aapt executable not found in $ANDROID_HOME/build-tools. Refusing to build unverified APK." >&2
  exit 1
fi
echo "aapt: $AAPT_BIN"

mkdir -p "$ARTIFACTS_BUILDS_DIR"

# 2. Dependency Management
if [[ "$SKIP_NPM_CI" != "true" ]]; then
  echo "[2/4] Installing dependencies via npm ci..."
  (cd "$REPO_ROOT" && npm ci)
else
  echo "[2/4] Skipping npm ci as requested..."
fi

# Build function for a specific variant
build_variant() {
  local target_var="$1"
  echo "--------------------------------------------------"
  echo "Building Variant: $target_var"
  echo "--------------------------------------------------"

  local expected_pkg=""
  local expected_cleartext=false

  if [[ "$target_var" == "test" ]]; then
    export EXPO_PUBLIC_ENABLE_DIAGNOSTICS="true"
    export EXPO_PUBLIC_TEST_MODE="true"
    export EXPO_PUBLIC_API_URL="http://127.0.0.1:8088/api"
    export APP_ENV="test"
    expected_pkg="net.thg3.ridemaker.e2e"
    expected_cleartext=true
  elif [[ "$target_var" == "consumer" ]]; then
    export EXPO_PUBLIC_ENABLE_DIAGNOSTICS="false"
    export EXPO_PUBLIC_TEST_MODE="false"
    export EXPO_PUBLIC_API_URL=""
    export APP_ENV="production"
    expected_pkg="net.thg3.ridemaker"
    expected_cleartext=false
  else
    echo "ERROR: Unknown variant '$target_var'. Must be 'test' or 'consumer'." >&2
    exit 1
  fi

  # Compute pure content-based source fingerprint
  local fingerprint
  fingerprint="$(node "$SCRIPT_DIR/fingerprint.mjs" "$target_var")"
  echo "Variant Fingerprint: $fingerprint"

  # Preserve tsconfig.json before prebuild to prevent unreviewed alterations
  local tsconfig_path="$REPO_ROOT/apps/mobile/tsconfig.json"
  local tsconfig_backup=""
  if [[ -f "$tsconfig_path" ]]; then
    tsconfig_backup="$(cat "$tsconfig_path")"
  fi

  # Dynamic Expo Prebuild
  echo "Generating native android configuration via Expo prebuild..."
  (
    cd "$REPO_ROOT/apps/mobile"
    npx expo prebuild --platform android --clean
  )

  # Restore tsconfig.json if prebuild modified it
  if [[ -n "$tsconfig_backup" ]]; then
    echo "$tsconfig_backup" > "$tsconfig_path"
  fi

  # Prebuild --clean removed app build outputs, so JS is freshly bundled.
  # Keep dependency compilation cached; it is independent of the app variant.
  echo "Building release APK via Gradle assembleRelease..."
  (
    cd "$REPO_ROOT/apps/mobile/android"
    if [[ "$CLEAN_BUILD" == "true" ]]; then
      ./gradlew clean
    fi
    ./gradlew assembleRelease
  )

  local release_apk="$REPO_ROOT/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
  if [[ ! -f "$release_apk" ]]; then
    echo "ERROR: Release APK not found at $release_apk" >&2
    exit 1
  fi

  local dest_apk="$ARTIFACTS_BUILDS_DIR/app-${target_var}-release.apk"
  cp -f "$release_apk" "$dest_apk"

  local apk_sha256
  if command -v sha256sum >/dev/null 2>&1; then
    apk_sha256="$(sha256sum "$dest_apk" | awk '{print $1}')"
  else
    apk_sha256="$(shasum -a 256 "$dest_apk" | awk '{print $1}')"
  fi
  local apk_size
  apk_size="$(stat -f%z "$dest_apk" 2>/dev/null || stat -c%s "$dest_apk" 2>/dev/null || echo 0)"

  # Strict AAPT verification - FAIL on unknown/missing
  local actual_pkg
  actual_pkg="$("$AAPT_BIN" dump badging "$dest_apk" 2>/dev/null | sed -n "s/package: name='\([^']*\)'.*/\1/p" || true)"
  if [[ -z "$actual_pkg" ]]; then
    echo "ERROR: aapt failed to extract package name from $dest_apk. Refusing to accept unverified APK." >&2
    exit 1
  fi

  local actual_cleartext
  actual_cleartext="$(node "$SCRIPT_DIR/inspect-apk.mjs" "$AAPT_BIN" "$dest_apk")"

  echo "APK Path:              $dest_apk"
  echo "APK Size:              $apk_size bytes"
  echo "APK SHA-256:           $apk_sha256"
  echo "APK Package:           $actual_pkg (expected: $expected_pkg)"
  echo "APK Cleartext Traffic: $actual_cleartext (expected: $expected_cleartext)"

  if [[ "$actual_pkg" != "$expected_pkg" ]]; then
    echo "ERROR: Package name mismatch for $target_var: expected $expected_pkg, got $actual_pkg" >&2
    exit 1
  fi

  if [[ "$actual_cleartext" != "$expected_cleartext" ]]; then
    echo "ERROR: Cleartext mismatch for $target_var: expected $expected_cleartext, got $actual_cleartext" >&2
    exit 1
  fi

  # Record fingerprint record
  local fp_file="$dest_apk.fingerprint.json"
  cat <<EOF > "$fp_file"
{
  "variant": "$target_var",
  "fingerprint": "$fingerprint",
  "apkSha256": "$apk_sha256",
  "apkSize": $apk_size,
  "apkPackage": "$actual_pkg",
  "cleartextTraffic": $actual_cleartext,
  "builtAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
  echo "Recorded fingerprint to $fp_file"
}

# 3. Execute Builds
if [[ "$VARIANT" == "all" ]]; then
  build_variant "consumer"
  build_variant "test"
else
  build_variant "$VARIANT"
fi

echo "=================================================="
echo "Bootstrap & Build Finished Successfully!"
echo "=================================================="
