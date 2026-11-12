import { FlagCohorts, MAX_COUNT, MAX_EVENTS } from "./cohorts";
import { track } from "./events";

const KEY = "emr.emr-feat-3.check-in-kiosk";

test("events ride in the minute's post, on each flag's side and in total", () => {
  const c = new FlagCohorts();
  c.see(KEY, true);
  track("checkin_completed", c);
  track("checkin_completed", c);
  track("kiosk.abandoned", c);
  c.touch();
  const events = { checkin_completed: 2, "kiosk.abandoned": 1 };
  expect(c.take()).toEqual({ flags: { [KEY]: { on: { requests: 1, errors: 0, events } } }, events });
  c.touch();
  expect(c.take()).toEqual({ flags: { [KEY]: { on: { requests: 1, errors: 0 } } } }); // counts start again
});

test("an app that used no flag still reports its events", () => {
  const c = new FlagCohorts();
  track("checkin_completed", c);
  expect(c.take()).toEqual({ events: { checkin_completed: 1 } });
  expect(c.take()).toBeNull();
});

test("names are lowercase words, and a minute stays within the BFF's limits", () => {
  const c = new FlagCohorts();
  expect(() => {
    track("CheckinCompleted", c);
  }).toThrow(/lowercase/);
  expect(() => {
    track("checkin completed", c);
  }).toThrow();
  for (let i = 0; i < MAX_COUNT + 10; i++) track("checkin_completed", c);
  for (let i = 0; i < MAX_EVENTS + 5; i++) track(`event_${String(i)}`, c);
  const events = c.take()?.events ?? {};
  expect(events.checkin_completed).toBe(MAX_COUNT);
  expect(Object.keys(events)).toHaveLength(MAX_EVENTS);
});
