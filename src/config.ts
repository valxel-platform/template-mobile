/**
 * The app's settings, from app.config.ts (`extra.app`), checked once at start so a misconfigured
 * build fails on launch with a clear message rather than on the first sign-in.
 */
export interface AppConfig {
  /** development, preview or production */
  env: string;
  /** The product's BFF origin. The app calls `<origin>/mobile/api/...` and reads flags at `<origin>/ofrep/`. */
  origin: string;
  /** The product's Keycloak realm, e.g. https://id.vrixel.com/realms/emr */
  issuer: string;
  /** This app's public client in that realm */
  clientId: string;
  scopes: string[];
  /** The app shows or stores PHI: biometric unlock, no screenshots, encrypted local data. */
  phi: boolean;
  /** The URL scheme Keycloak redirects back to */
  scheme: string;
  /** Sentry's DSN for error reports; empty when reporting is off (src/errors.ts). */
  sentryDsn: string;
  /** Share of app sessions (0 to 1) that send performance data: app start, slow and frozen
   * frames, and API call timings (paths only). 0: errors and sessions only. */
  sentryTracesSampleRate: number;
}

export class ConfigError extends Error {}

const DSN = /^https:\/\/[0-9a-f]{16,64}@[A-Za-z0-9.-]{1,253}\/[0-9]{1,20}$/;

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?(\/|$)/;

export function readConfig(extra: unknown): AppConfig {
  const app = (extra as { app?: Record<string, unknown> } | null | undefined)?.app;
  if (!app) throw new ConfigError("app.config.ts has no extra.app");
  const text = (name: string): string => {
    const value = app[name];
    if (typeof value !== "string" || value.trim() === "")
      throw new ConfigError(`extra.app.${name} is missing`);
    return value.trim();
  };
  const url = (name: string): string => {
    const value = text(name).replace(/\/+$/, "");
    // TLS everywhere except a developer's own machine (10.0.2.2 is the Android emulator's host).
    if (!value.startsWith("https://") && !LOCAL.test(value)) {
      throw new ConfigError(`extra.app.${name} must be https (got ${value})`);
    }
    return value;
  };
  const config: AppConfig = {
    env: text("env"),
    origin: url("origin"),
    issuer: url("issuer"),
    clientId: text("clientId"),
    scopes: text("scopes")
      .split(/[\s,]+/)
      .filter(Boolean),
    phi: app.phi === true,
    scheme: text("scheme"),
    sentryDsn: typeof app.sentryDsn === "string" ? app.sentryDsn.trim() : "",
    sentryTracesSampleRate: rate(app.sentryTracesSampleRate),
  };
  if (config.sentryDsn && !DSN.test(config.sentryDsn)) {
    throw new ConfigError("extra.app.sentryDsn must look like https://<key>@<host>/<project id>");
  }
  if (config.env === "production" && (LOCAL.test(config.origin) || LOCAL.test(config.issuer))) {
    throw new ConfigError("a production build must not point at a local server");
  }
  if (!config.scopes.includes("openid")) config.scopes.unshift("openid");
  return config;
}

/** A sample rate between 0 and 1; anything else is 0 (no performance data). */
function rate(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

/** Where the product's API is, through the BFF's mobile route. */
export function apiBase(config: AppConfig): string {
  return `${config.origin}/mobile`;
}
