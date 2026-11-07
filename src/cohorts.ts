/**
 * Users with a feature on against users with it off, while the SDLC tool releases it gradually,
 * as in the web template.
 *
 * The services count their own requests; this counts what only the app sees. Each minute in which
 * the app is in the foreground (or something failed) counts once for every flag the app has used,
 * on the side this install got, and as failed when the minute had an uncaught JavaScript error, a
 * reported error, or an API call that failed (5xx or no answer). Once a minute the counts go to
 * the BFF (`POST <origin>/mobile/flag-cohorts`, with the person's token), which adds them up for
 * everyone and logs them for the tool. Signed out, nothing is sent.
 *
 * Only counts leave the device: flag keys, on or off, and how many minutes failed.
 */
import type { Hook } from "@openfeature/web-sdk";
import type { Http } from "./api/http";

const KEY = /^[A-Za-z0-9._-]{1,200}$/;
const MAX_FLAGS = 50;

type Side = { requests: number; errors: number };
export type CohortPost = { flags: Record<string, { on?: Side; off?: Side }> };

export class FlagCohorts {
  private readonly used = new Map<string, boolean>();
  private failed = false;
  private active = false;

  /** A flag was evaluated: from now on each minute counts for it, on the side it last had. */
  see(key: string, on: boolean): void {
    if (!KEY.test(key) || (!this.used.has(key) && this.used.size >= MAX_FLAGS)) return;
    this.used.set(key, on);
  }

  /** Something failed this minute. */
  fail(): void {
    this.failed = true;
  }

  /** The person was using the app this minute (it was in the foreground). */
  touch(): void {
    this.active = true;
  }

  /** This minute's counts, or null when there's nothing to say; the next minute starts. */
  take(): CohortPost | null {
    const counted = this.active || this.failed;
    const errors = this.failed ? 1 : 0;
    this.active = false;
    this.failed = false;
    if (!counted || this.used.size === 0) return null;
    const flags: CohortPost["flags"] = {};
    for (const [key, on] of this.used) {
      flags[key] = { [on ? "on" : "off"]: { requests: 1, errors } };
    }
    return { flags };
  }
}

export const cohorts = new FlagCohorts();

/** An OpenFeature hook: every boolean flag the app evaluates is counted, and `also` is told. */
export function cohortHook(counter: FlagCohorts = cohorts, also?: (key: string, on: boolean) => void): Hook {
  return {
    after(_ctx, details) {
      if (typeof details.value !== "boolean") return;
      counter.see(details.flagKey, details.value);
      also?.(details.flagKey, details.value);
    },
  };
}

/** Whether an API answer counts as a failure for the person: the server failed. */
export function failedResponse(status: number): boolean {
  return status >= 500;
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

export interface CohortOptions {
  http: Http;
  counter?: FlagCohorts;
  every?: number;
  /** Whether the app is in the foreground now (AppState.currentState === "active"). */
  foreground: () => boolean;
  /** React Native's ErrorUtils: uncaught JavaScript errors count too. */
  errorUtils?: { getGlobalHandler(): GlobalHandler; setGlobalHandler(handler: GlobalHandler): void };
}

/** Counts uncaught errors and foreground minutes, and posts each minute's counts. Returns a stop function. */
export function startCohorts({
  http,
  counter = cohorts,
  every = 60_000,
  foreground,
  errorUtils,
}: CohortOptions): () => void {
  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      counter.fail();
      previous(error, isFatal);
    });
  }
  const timer = setInterval(() => {
    if (foreground()) counter.touch();
    const body = counter.take();
    if (!body) return;
    // Signed out or offline: the BFF can't take it, and a lost minute is fine.
    http.send({ method: "POST", path: "/flag-cohorts", body }).catch(() => undefined);
  }, every);
  return () => {
    clearInterval(timer);
  };
}
