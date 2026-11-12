/**
 * Product events: the things a feature's goal counts, for the SDLC tool's outcome loop.
 *
 * The feature's PRD names them (its Instrumentation section) and the HLD says which repo records
 * each. When it's this app, track them where they happen:
 *
 *   import { track } from "./events";
 *   track("checkin_completed");
 *
 * The count rides in the minute's post to the BFF (cohorts.ts): on each side of every flag in use,
 * so a gradual release can compare how often people with a feature on do it against people with it
 * off, and in total, which the BFF logs as `vrixel.events {"checkin_completed":12}` for the tool's
 * staging check and counts on its `vrixel.events` meter.
 *
 * Only the name and how many times leave the device: no attributes, screens or anything about the
 * person. A name that isn't lowercase words joined by _ or . is a mistake in the code: it throws
 * in development and tests, and is dropped in production rather than break the app.
 */
import { EVENT, cohorts, type FlagCohorts } from "./cohorts";

export function track(event: string, counter: FlagCohorts = cohorts): void {
  if (!EVENT.test(event) || event.length > 100) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(`Event names are lowercase words joined by _ or . (checkin_completed): ${event}`);
    }
    return;
  }
  counter.record(event);
}
