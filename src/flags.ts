/**
 * Feature flags through OpenFeature, as in the web template.
 *
 * The Vrixel SDLC tool gives each feature a flag in the product's Flipt when its design is
 * approved: on in dev and staging, off in production until the feature is released. A store
 * release can carry a feature switched off and the tool switches it on later, without a new
 * build. Put the feature's new screens behind it:
 *
 *   const kiosk = useFeature("medspa.ms-feat-3.check-in-kiosk");
 *   return kiosk ? <KioskCheckIn /> : <FrontDeskCheckIn />;
 *
 * The app reads flags over OFREP from the product's origin (`<origin>/ofrep/`, served for the
 * web app too). Until the first answer, and with no signal, every flag is off.
 */
import { OFREPWebProvider } from "@openfeature/ofrep-web-provider";
import { OpenFeature, useBooleanFlagValue, type Provider } from "@openfeature/react-sdk";

export function flagProvider(origin: string): Provider {
  return new OFREPWebProvider({ baseUrl: origin, pollInterval: 60_000 });
}

export function startFlags(provider: Provider): Promise<void> {
  return OpenFeature.setProviderAndWait(provider).catch(() => undefined);
}

/** Whether the feature is on for this person. Re-renders when the flag changes. */
export function useFeature(key: string): boolean {
  return useBooleanFlagValue(key, false);
}
