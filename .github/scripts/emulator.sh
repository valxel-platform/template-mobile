#!/usr/bin/env bash
# Start an Android emulator on a GitHub-hosted Ubuntu runner (it has the Android SDK and KVM) and
# wait for it to boot. Uses only the SDK's own tools, so nothing third-party runs with the job's
# token. Usage: emulator.sh [api-level]
set -euo pipefail

API="${1:-35}"
IMAGE="system-images;android-${API};google_apis;x86_64"
SDK="${ANDROID_HOME:?ANDROID_HOME is not set}"
BIN="$SDK/cmdline-tools/latest/bin"

# Hardware acceleration: let the runner's user open /dev/kvm.
echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm.rules >/dev/null
sudo udevadm control --reload-rules
sudo udevadm trigger --name-match=kvm

yes | "$BIN/sdkmanager" --licenses >/dev/null || true
"$BIN/sdkmanager" --install "platform-tools" "emulator" "$IMAGE" >/dev/null
echo no | "$BIN/avdmanager" create avd --force --name ci --package "$IMAGE" --device pixel_7 >/dev/null

"$SDK/emulator/emulator" -avd ci -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect -camera-back none &
"$SDK/platform-tools/adb" wait-for-device
for _ in $(seq 1 120); do
  if [ "$("$SDK/platform-tools/adb" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
    "$SDK/platform-tools/adb" shell settings put global window_animation_scale 0
    "$SDK/platform-tools/adb" shell settings put global transition_animation_scale 0
    "$SDK/platform-tools/adb" shell settings put global animator_duration_scale 0
    echo "emulator ready"
    exit 0
  fi
  sleep 5
done
echo "emulator did not boot in 10 minutes" >&2
exit 1
