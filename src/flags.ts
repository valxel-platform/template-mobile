/**
 * Feature flags through OpenFeature, as in the web template.
 *
 * The Valxel SDLC tool gives each feature a flag in the product's Flipt when its design is
 * approved: on in dev and staging, off in production until the feature is released. A store
 * release can carry a feature switched off and the tool switches it on later, without a new
 * build. Put the feature's new screens behind it:
 *
 *   const kiosk = useFeature("medspa.ms-feat-3.check-in-kiosk");
 *   return kiosk ? <KioskCheckIn /> : <FrontDeskCheckIn />;
 *
 * The app reads flags over OFREP from the product's origin (`<origin>/ofrep/`, served for the
 * web app too), as this install (`installKey`), so gradual releases work. Until the first answer,
 * and with no signal, every flag is off. The app's layout adds a hook so every flag the app reads
 * is counted for the tool's on/off comparison (cohorts.ts) and named on error reports (errors.ts).
 */
import { OFREPWebProvider } from "@openfeature/ofrep-web-provider";
import { OpenFeature, useBooleanFlagValue, type Provider } from "@openfeature/react-sdk";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

export function flagProvider(origin: string): Provider {
  return new OFREPWebProvider({ baseUrl: origin, pollInterval: 60_000 });
}

const DEVICE_KEY = "valxel.flags.install";

type KeyStore = Pick<typeof SecureStore, "getItemAsync" | "setItemAsync">;

/**
 * A random id for this install, kept on the device. The tool releases features gradually (on for
 * 5% of users, then 25%, ...), and Flipt picks who gets a feature by this id, so each install keeps
 * the same answer as the share grows. It says nothing about the person and goes only to the flag
 * server. If it can't be stored, a fresh one is used for this run.
 */
export async function installKey(
  store: KeyStore = SecureStore,
  uuid: () => string = Crypto.randomUUID,
): Promise<string> {
  try {
    const have = await store.getItemAsync(DEVICE_KEY);
    if (have) return have;
  } catch {
    // unreadable: make one below
  }
  const made = uuid();
  try {
    await store.setItemAsync(DEVICE_KEY, made);
  } catch {
    // unwritable: this run still gets a consistent answer
  }
  return made;
}

/** Start reading flags as this install. Until the first answer, and with no signal, flags are off. */
export async function startFlags(provider: Provider, key?: string): Promise<void> {
  try {
    await OpenFeature.setContext({ targetingKey: key ?? (await installKey()) });
  } catch {
    // without a key every install gets the same answer: still correct, just not gradual
  }
  return OpenFeature.setProviderAndWait(provider).catch(() => undefined);
}

/** Whether the feature is on for this person. Re-renders when the flag changes. */
export function useFeature(key: string): boolean {
  return useBooleanFlagValue(key, false);
}
