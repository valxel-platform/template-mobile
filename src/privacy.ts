/**
 * Apps with PHI (APP_PHI=true): no screenshots or screen recording, and the app switcher shows a
 * blurred screen instead of the last one. Sign-out wipes tokens and queued changes (session.ts,
 * outbox). Never put PHI in push notifications, logs or crash reports.
 */
import * as ScreenCapture from "expo-screen-capture";

export async function protectScreens(phi: boolean): Promise<void> {
  if (!phi) return;
  try {
    await ScreenCapture.preventScreenCaptureAsync("phi");
    await ScreenCapture.enableAppSwitcherProtectionAsync(0.9);
  } catch {
    // Not available here (web, some simulators): nothing to protect against.
  }
}
