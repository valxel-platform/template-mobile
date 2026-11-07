/**
 * Crash and error reporting with Sentry: JavaScript errors and native crashes, grouped into issues,
 * with release health (crash-free sessions per release) for staged rollouts. Sentry's issue alerts
 * reach the SDLC tool as incident signals (/api/signals/sentry).
 *
 * Off unless the build has a DSN (SENTRY_DSN in eas.json). An app with PHI reports only with
 * SENTRY_BAA=true, meaning the Sentry plan is covered by a business associate agreement.
 *
 * What leaves the device: the error's type, its stack and the screen's route. Never error
 * messages (they can echo what a person typed), request queries, user details, screenshots, the
 * view hierarchy, console output or what was typed. Each event names the feature flags this
 * install evaluated and their values, so an error that only happens with a feature on is plain.
 */
import * as Sentry from "@sentry/react-native";
import { ApiError } from "./api/http";
import { cohorts } from "./cohorts";
import type { AppConfig } from "./config";

type ErrorEvent = Parameters<NonNullable<Sentry.ReactNativeOptions["beforeSend"]>>[0];

const pathOnly = (url: unknown): string | undefined => {
  if (typeof url !== "string") return undefined;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
};

type EventHint = Parameters<NonNullable<Sentry.ReactNativeOptions["beforeSend"]>>[1];

/** Strips an event down to what may leave the device, and ties a failed API call to the
 * backend's trace (tags trace_id, endpoint, status) so the SDLC tool sees one incident. */
export function scrub(event: ErrorEvent, hint?: EventHint): ErrorEvent {
  const error = hint?.originalException;
  if (error instanceof ApiError) {
    event.tags = {
      ...event.tags,
      ...(error.traceId ? { trace_id: error.traceId } : {}),
      ...(error.endpoint ? { endpoint: error.endpoint } : {}),
      status: String(error.status),
    };
  }
  delete event.user;
  delete event.extra;
  delete event.message;
  event.logentry = undefined;
  if (event.request) event.request = { url: pathOnly(event.request.url) };
  for (const ex of event.exception?.values ?? []) {
    ex.value = undefined;
    for (const frame of ex.stacktrace?.frames ?? []) delete frame.vars;
  }
  event.breadcrumbs = (event.breadcrumbs ?? [])
    .filter((b) => b.category !== "console" && b.category !== "touch" && b.category !== "ui.input")
    .map((b) => ({
      category: b.category,
      level: b.level,
      timestamp: b.timestamp,
      type: b.type,
      data: b.data
        ? {
            url: pathOnly(b.data.url),
            to: pathOnly(b.data.to),
            method: typeof b.data.method === "string" ? b.data.method : undefined,
            status_code: typeof b.data.status_code === "number" ? b.data.status_code : undefined,
          }
        : undefined,
    }));
  return event;
}

/** Reports an error the app handled (shown to the person) but that someone should fix. Does
 * nothing while reporting is off. */
export function reportError(error: unknown): void {
  cohorts.fail();
  Sentry.captureException(error);
}

/** A flag was evaluated: later error events carry it and its value (Sentry's feature flags
 * integration). Does nothing while reporting is off. */
export function noteFlag(key: string, on: boolean, sentry: Pick<typeof Sentry, "getClient"> = Sentry): void {
  sentry
    .getClient()
    ?.getIntegrationByName<Sentry.FeatureFlagsIntegration>("FeatureFlags")
    ?.addFeatureFlag(key, on);
}

/** Starts Sentry when the build has a DSN; returns whether it did. */
export function startErrors(config: AppConfig, sentry: Pick<typeof Sentry, "init"> = Sentry): boolean {
  if (!config.sentryDsn) return false;
  sentry.init({
    dsn: config.sentryDsn,
    environment: config.env,
    // Sentry's default sends no personal data; scrub() removes whatever else could carry it.
    attachScreenshot: false,
    attachViewHierarchy: false,
    // Traces go through OpenTelemetry on the backend; the app sends errors and sessions only.
    tracesSampleRate: 0,
    maxBreadcrumbs: 30,
    // The flags evaluated in this run and their values ride along on each event.
    integrations: [Sentry.featureFlagsIntegration()],
    beforeSend: (event, hint) => scrub(event, hint),
  });
  return true;
}
