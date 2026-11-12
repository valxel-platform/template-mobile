# Mobile template (React Native, Expo, TypeScript)

The golden path for Vrixel mobile apps on iOS and Android. The Vrixel SDLC creates product repos
from this template (role `mobile`); you can also use **Use this template** on GitHub.

It differs from the web template in two ways that shape everything else: a phone can't keep a
secret, so there is no BFF session (the app is a public client with its own tokens); and a store
app can't be deployed continuously, so a release is a build that is reviewed, rolled out in
stages and stays installed for months.

## What you get

| Area           | Choice                                                                                                                                   | Why                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| App            | Expo SDK 58, React Native 0.88, Expo Router, TypeScript (strict)                                                                         | One TypeScript stack with the web template; no native code to own |
| Quality        | ESLint (Expo rules plus type-checked strict), Prettier, `tsc --noEmit`, `expo-doctor`                                                    | One style; native modules match the SDK                           |
| Unit tests     | Jest (`jest-expo`), React Native Testing Library, coverage of at least 90% (VX-11)                                                       | Tests what people see                                             |
| Contract tests | Pact consumer tests write `pacts/*.json` for the API to verify                                                                           | The API can't break installed versions silently                   |
| End-to-end     | Maestro flows (`.maestro/`) on an Android emulator against dev and staging                                                               | Real sign-in, real offline behaviour                              |
| Sign-in        | Keycloak public client: authorization code with PKCE in the system browser; tokens in the Keychain or Keystore; refresh rotation         | VX-17: the app never sees a password; stolen codes are useless    |
| API calls      | Through the product's BFF mobile route (`<origin>/mobile/api/...`) with a bearer token, app version and `traceparent`                    | One edge per product; old versions are turned away with 426       |
| Offline        | Changes wait in an outbox (SQLite) with an idempotency key each, and are sent in order when there is signal                              | Fits Kafka-first (VX-16): a retried change is applied once        |
| PHI            | `APP_PHI=true`: SQLCipher-encrypted local data, biometric unlock, no screenshots, blurred app switcher, wipe on sign-out                 | Data on a lost phone stays unreadable                             |
| Feature flags  | OpenFeature with OFREP from the product's Flipt                                                                                          | Features ship dark in a store build and turn on later             |
| Errors         | Sentry (`@sentry/react-native`) when `SENTRY_DSN` is set: JavaScript errors, native crashes, release health; types and stacks only       | Problems on phones reach the incident flow                        |
| Releases       | EAS Build and Submit; TestFlight and Play's internal track for staging; staged rollout for production; over-the-air updates for JS fixes | Store review and old versions are part of the plan                |

## Checks and how the pipeline reads them

| Check                                        | Where         | Required  | Read by the Vrixel SDLC as                                      |
| -------------------------------------------- | ------------- | --------- | --------------------------------------------------------------- |
| `unit`                                       | `ci.yml`      | yes       | the `unit` suite (lint, format, types, tests, doctor, bundles)  |
| `contract`                                   | `ci.yml`      | yes       | the `contract` suite                                            |
| `CodeQL`                                     | default setup | yes       | the `sast` suite                                                |
| `dependency-review`                          | `ci.yml`      | no        | dependency diff                                                 |
| `integration / report`, `e2e / report`       | `release.yml` | per stage | Maestro in dev and staging                                      |
| `release / dev`, `/ staging`, `/ production` | `release.yml` | per stage | the stage's release: built (and submitted)                      |
| `rollout / <n>%`                             | `release.yml` | per step  | crash-free users of the version rolling out, from Play's vitals |

## Develop

```bash
npm ci
npx expo run:android      # or run:ios: a development build (native modules need one, not Expo Go)
npm test                  # unit tests with coverage
npm run test:contract     # writes pacts/template-mobile-template-service.json
npm run lint && npm run typecheck && npm run format:check
maestro test .maestro -e APP_ID=com.vrixel.template.development -e TEST_USERNAME=... -e TEST_PASSWORD=...
```

A development build talks to `http://10.0.2.2:8080` (the Android emulator's view of your
machine): run the product's BFF there and Keycloak on `:8180`. Settings come from `app.config.ts`;
EAS build profiles (`eas.json`) set them per environment:

| Variable                    | Example                                       |                                                                                                                                               |
| --------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                   | `development`, `dev`, `staging`, `production` | Store builds: staging and production                                                                                                          |
| `APP_ID`                    | `com.vrixel.example`                          | Bundle id, package and URL scheme                                                                                                             |
| `APP_ORIGIN`                | `https://example.vrixel.com`                  | The product's BFF                                                                                                                             |
| `APP_ISSUER`                | `https://id.vrixel.com/realms/example`        | The product's Keycloak realm                                                                                                                  |
| `APP_CLIENT_ID`             | `example-mobile`                              | This app's public client in the realm                                                                                                         |
| `APP_SCOPES`                | `openid profile offline_access example-api`   | The product's API scope puts its audience in                                                                                                  |
| `APP_PHI`                   | `true`                                        | The app shows or stores PHI                                                                                                                   |
| `SENTRY_DSN`                | `https://<key>@o1.ingest.sentry.io/42`        | Error and crash reports (unset: off)                                                                                                          |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.05`                                        | Share of sessions that send performance data (app start, slow and frozen frames, API call timings; paths only). `0`: errors and sessions only |
| `SENTRY_BAA`                | `true`                                        | Needed for reports from an app with PHI                                                                                                       |

Development and test builds install beside the store app, with `.<env>` appended to the id.

## Errors and crashes

`src/errors.ts` starts Sentry when the build has a DSN: JavaScript errors and native crashes, grouped
into issues, and release health (crash-free sessions per version) to watch a staged rollout. Sentry's
issue alerts reach the SDLC tool as incident signals (`/api/signals/sentry`).

A failed API call keeps its trace (the one the API names in `traceresponse`, else the
`traceparent` the app sent): a report about it is tagged with that `trace_id`, the endpoint and the
status, so the SDLC tool joins it to the backend's errors from the same request (one incident).
Server failures a screen shows are reported through `reportError`; being offline or a 4xx is not a
fault and isn't.

Every event is tagged `component` with this app's name (`src/component.ts`), so the SDLC tool
routes its issues to this component whatever the Sentry project is called. When the tool creates a
repo from this template, it puts the component's name in the files `.vrixel/identity` lists.

Each event also names the feature flags this install evaluated and their values (Sentry's feature
flags integration). An error that happens only with a feature on is plain in the issue.

Only an error's type, its stack, route paths and flag values leave the phone: no error messages, query strings,
user details, screenshots, view hierarchy, console output or taps (`scrub`). Keep names out of
routes: use ids. An app with PHI sends reports only when `SENTRY_BAA=true`, meaning the Sentry plan
is covered by a business associate agreement; otherwise `app.config.ts` leaves the DSN out of the
build. Upload source maps and native debug files from `release.yml` with a Sentry auth token if you
want readable stacks.

## Signing in

`src/auth/oidc.ts` signs in with `expo-auth-session`: the system browser opens the product's
Keycloak page (ephemeral on iOS, so a shared device keeps no sign-in), PKCE protects the code,
and the app exchanges it for tokens. `src/auth/session.ts` keeps them in the Keychain or Keystore
(`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, never backed up), refreshes the access token shortly before
it expires (one refresh however many calls need it) and signs the person out when Keycloak
refuses a refresh. Without signal the tokens are kept and changes wait. Sign-out revokes the
refresh token, ends the browser's Keycloak session and wipes the outbox.

The realm needs a public client for the app (`platform-security`, `mobile:` in the product's
spec) with the redirect URI of each build: `com.vrixel.example://callback`,
`com.vrixel.example.dev://callback`, and so on.

## Calling the API

The app calls `<origin>/mobile/api/...`. The product's BFF (`template-bff`) checks the token
(issuer and audience), checks the app's version, strips `/mobile` and passes the request to the
service with the token, which checks it again and applies its permissions (VX-17). Responses
follow RFC 9457: show the problem's title or detail, never a raw body.

Every request carries `X-App-Version`. When the BFF's minimum supported version
(`BFF_MOBILE_MIN_VERSION`) passes this one, it answers 426 and the app asks the person to update
(`UpdateScreen`; set the store URLs there). Raise the minimum only once few people are on older
versions, and keep the API compatible with every version still supported: contract tests run
against what this version relies on, and the API's expand-then-contract rule waits for the oldest
supported version.

## Offline: the outbox

Reads need signal. Changes go to the outbox (`src/outbox/`):

```ts
await outbox.enqueue(saveGreeting(id, { name, message }));
```

Each change gets an id that is sent as its `Idempotency-Key`; the service turns it into one event
and a retry gets the same event id, so it is applied once however often it is sent. Changes to
one record are sent in the order they were made; different records don't wait for each other.

| Answer                         | What happens                                                         |
| ------------------------------ | -------------------------------------------------------------------- |
| 2xx                            | Sent, removed                                                        |
| No signal, 408, 429, 5xx (503) | Kept, retried with backoff (2 s doubling to 5 min, jittered)         |
| 409, 412                       | Conflict: the person sends it again or discards it (`ChangesScreen`) |
| Other 4xx                      | Rejected: kept so the person sees it; discard it                     |
| 401 after a refresh            | Stops until the person signs in again                                |
| 426                            | Stops until the app is updated (the changes are kept)                |

Design events as facts where you can ("reading recorded") rather than overwrites: facts from two
devices both apply, and conflicts become rare. Where a record must not be overwritten blindly,
send its version (`If-Match`) and let the service answer 412.

## Feature flags

As in the web template: `useFeature("<product>.<feature>.<flag>")`. A store build can carry a
feature switched off; the SDLC tool switches it on at release, with no new build. With no signal
every flag reads as off.

**Gradual releases.** The tool turns a feature on for a growing share of installs and stops if the
people who have it fail more than the people who don't. `src/cohorts.ts` counts user-minutes: each
minute the app is in the foreground counts once for every flag the app has read, on this install's
side. The minute counts as failed if it had an uncaught JavaScript error, a reported error, or an
API call that failed (a 5xx or no answer; a 4xx isn't). Every minute the counts go to the BFF
(`POST <origin>/mobile/flag-cohorts`, with the person's token), which adds them up for everyone
and logs them for the tool. Only flag keys, on or off, and counts leave the phone. Signed out,
nothing is sent.

## Product events

As in the web template: when the HLD names this app as the one that records a feature's goal
event, `track("checkin_completed")` where it happens. The count rides in the minute's post to the
BFF, on each side of every flag in use and in total; the BFF logs it as `vrixel.events` for the
SDLC tool's staging check and the gradual-release comparison. Only names and counts leave the
phone. A name that isn't lowercase words throws in development and tests and is dropped in a
production build; at most 20 names and 120 of each per minute.

## Releases

`release.yml` runs when the Vrixel SDLC dispatches `vrixel-release` for a stage, or
`vrixel-rollout` to widen a production rollout:

1. **dev**: an APK built against dev is installed on an emulator and the Maestro flows run.
2. **staging**: the same against staging, then a store build goes to TestFlight and Play's
   internal track for testers.
3. **production**: a store build is submitted to the App Store and to Play's production track at
   1% of users. Submit the iOS version for review with phased release on in App Store Connect.
4. **rollout**: each step checks the crash-free users of the version on Play's vitals; if above
   the floor (99% by default, `MAX_CRASH_RATE`), the rollout widens to the step's share. Vitals
   arrive daily, so steps are at least a day apart. A failed check halts nothing by itself: the
   SDLC halts the rollout (`halt: true`) and pauses the App Store phased release.

Over-the-air updates (`eas update --channel production`) change JavaScript only and reach only
builds with the same native fingerprint (`runtimeVersion: fingerprint`). Treat one like a
hotfix: it goes through the same checks, and never changes what the app asks permission for.

Secrets: `EXPO_TOKEN`, `PLAY_SERVICE_ACCOUNT_JSON`, `TEST_USERNAME`, `TEST_PASSWORD` (a test
account in the dev and staging realms). Apple and Google submit credentials live in EAS
(`eas credentials`). Set `EAS_PROJECT_ID` in `eas.json`'s base profile once the EAS project
exists, and the App Store app id (`ascAppId`) in the submit profiles.

## Not here yet

- **DPoP** (tokens bound to a key on the device): Keycloak supports it; the app needs a native
  module that signs with a non-exportable key.
- **App attestation** (App Attest, Play Integrity): `@expo/app-integrity` provides the device side;
  the BFF has no verifier yet.
- **Crash reporting**: the rollout reads Play's vitals; add an SDK (Sentry, Crashlytics) for
  stack traces, and keep PHI out of its events.

## Performance tests

When the Vrixel SDLC labels a pull request `vrixel:perf-smoke` (screens, the API client, the
outbox, dependencies or app settings change; or the reviewer saw a performance risk), `perf.yml`
exports main's app and the PR's for Android and measures the JavaScript bundle as people download it
in an update (compressed; about 2.1 MB for the template). `perf/compare.py` posts
`perf-smoke / report`: failed when the PR's bundle is more than 20% bigger than main's or over the
budget (3 MB). App start and screen timings come from the sampled performance data in Sentry
(`SENTRY_TRACES_SAMPLE_RATE`), compared release over release during the staged rollout; a mobile
app has no staging load test.
