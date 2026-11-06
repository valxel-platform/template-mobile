import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Build-time configuration. Each EAS build profile (eas.json) sets these for its environment; a
 * local run reads them from your shell or .env. Nothing here is a secret: a mobile app can't keep
 * one, so it is a public client of the product's Keycloak realm (PKCE, no client secret).
 *
 * | Variable                | Example                                    |
 * | ----------------------- | ------------------------------------------ |
 * | APP_ENV                 | development, preview, production           |
 * | APP_ID                  | com.vrixel.example (bundle id, scheme)     |
 * | APP_NAME                | Example                                    |
 * | APP_ORIGIN              | https://example.vrixel.com (the BFF)       |
 * | APP_ISSUER              | https://id.vrixel.com/realms/example       |
 * | APP_CLIENT_ID           | example-mobile                             |
 * | APP_SCOPES              | openid profile offline_access example-api  |
 * | APP_PHI                 | true: the app shows or stores PHI          |
 * | SENTRY_DSN              | Sentry project for error reports (optional)|
 * | SENTRY_BAA              | true: Sentry is under a BAA (PHI apps)     |
 * | EAS_PROJECT_ID          | the EAS project, for builds and updates    |
 */
const env = (name: string, fallback = ""): string =>
  ((process.env as Record<string, string | undefined>)[name] ?? fallback).trim();

export default ({ config }: ConfigContext): ExpoConfig => {
  const appEnv = env("APP_ENV", "development");
  const appId = env("APP_ID", "com.vrixel.template");
  const phi = env("APP_PHI", "false") === "true";
  const projectId = env("EAS_PROJECT_ID");
  // Error reports leave the device: an app with PHI sends them only under a BAA (src/errors.ts).
  const sentryDsn = phi && env("SENTRY_BAA") !== "true" ? "" : env("SENTRY_DSN");
  if (appEnv !== "development") {
    // A store or tester build must say where its product is; local defaults would ship broken.
    const missing = ["APP_ID", "APP_ORIGIN", "APP_ISSUER", "APP_CLIENT_ID"].filter((name) => !env(name));
    if (missing.length) throw new Error(`${appEnv} build: set ${missing.join(", ")} (eas.json)`);
  }
  // Store builds (staging goes to TestFlight and Play's internal track only, never to the stores)
  // use the app's id; development and test builds install beside it, with their own id and name.
  const store = appEnv === "production" || appEnv === "staging";
  const suffix = store ? "" : `.${appEnv}`;

  return {
    ...config,
    name: env("APP_NAME", "Template") + (store ? "" : ` (${appEnv})`),
    slug: env("APP_SLUG", "template-mobile"),
    // The store version people see. Raise it for every store release; the pipeline reads it.
    version: "1.0.0",
    // Store builds and over-the-air updates must agree on native code: an update only reaches
    // builds with the same runtime version, so a JavaScript fix never lands on a binary it
    // doesn't fit. The fingerprint changes whenever native code or config does.
    runtimeVersion: { policy: "fingerprint" },
    orientation: "default",
    icon: "./assets/icon.png",
    scheme: appId + suffix,
    userInterfaceStyle: "automatic",
    ios: {
      supportsTablet: true,
      bundleIdentifier: appId + suffix,
      config: { usesNonExemptEncryption: false },
      privacyManifests: {
        NSPrivacyAccessedAPITypes: [
          // expo-constants and expo-updates read app settings (UserDefaults).
          {
            NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
            NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
          },
        ],
      },
    },
    android: {
      package: appId + suffix,
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
      // No backups of app data to the cloud: tokens and queued changes stay on this device.
      allowBackup: false,
      predictiveBackGestureEnabled: false,
    },
    plugins: [
      "expo-router",
      "expo-web-browser",
      ["expo-secure-store", { faceIDPermission: "Unlock your saved sign-in." }],
      // Apps with PHI encrypt the local database (queued changes) with SQLCipher.
      ["expo-sqlite", { useSQLCipher: phi }],
    ],
    experiments: { typedRoutes: true },
    updates: projectId
      ? { url: `https://u.expo.dev/${projectId}`, checkAutomatically: "ON_LOAD", fallbackToCacheTimeout: 0 }
      : { enabled: false },
    extra: {
      ...(projectId ? { eas: { projectId } } : {}),
      app: {
        env: appEnv,
        origin: env("APP_ORIGIN", "http://localhost:8080"),
        issuer: env("APP_ISSUER", "http://localhost:8180/realms/template"),
        clientId: env("APP_CLIENT_ID", "template-mobile"),
        scopes: env("APP_SCOPES", "openid profile offline_access"),
        phi,
        scheme: appId + suffix,
        sentryDsn,
      },
    },
  };
};
