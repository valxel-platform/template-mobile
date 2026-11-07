/**
 * The app's services, built once at launch from its configuration. Screens reach them through
 * AppProvider (AppContext.tsx); tests build them with fakes instead.
 */
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { createApiClient, type ApiClient } from "./api/client";
import { createHttp, type Http } from "./api/http";
import { keycloak } from "./auth/oidc";
import { Session } from "./auth/session";
import { secureVault } from "./auth/vault";
import { cohorts } from "./cohorts";
import { apiBase, readConfig, type AppConfig } from "./config";
import { Outbox } from "./outbox/outbox";
import { sqliteStore } from "./outbox/sqlite";

export interface Services {
  config: AppConfig;
  session: Session;
  api: ApiClient;
  outbox: Outbox;
  /** Set when the BFF says this version is too old. */
  upgrade: { required: boolean; listeners: Set<() => void> };
  /** Calls through the BFF's mobile route, for what isn't the product's API (flag counts). */
  http: Http;
}

export function appVersion(): string {
  return Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "0.0.0";
}

export async function createServices(): Promise<Services> {
  const config = readConfig(Constants.expoConfig?.extra);
  const session = new Session(secureVault(config.phi), keycloak(config));
  const upgrade = { required: false, listeners: new Set<() => void>() };
  const http = createHttp({
    base: apiBase(config),
    session,
    appVersion: appVersion(),
    platform: Platform.OS,
    randomBytes: (count) => Crypto.getRandomBytes(count),
    onUpgradeRequired: () => {
      upgrade.required = true;
      upgrade.listeners.forEach((listener) => listener());
    },
    onFailure: () => cohorts.fail(),
  });
  const outbox = new Outbox(await sqliteStore(config.phi), http, { uuid: () => Crypto.randomUUID() });
  // Signing out leaves nothing about the person on the device, including unsent changes.
  session.onSignOut(() => outbox.clear());
  await session.restore();
  return { config, session, api: createApiClient(http), outbox, upgrade, http };
}
