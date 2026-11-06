import type { ApiClient } from "../api/client";
import type { ApiRequest, ApiResponse, Http } from "../api/http";
import { Session, type Oidc, type Tokens } from "../auth/session";
import { memoryVault } from "../auth/vault";
import type { AppConfig } from "../config";
import { memoryStore, Outbox } from "../outbox/outbox";
import type { Services } from "../services";

export const config: AppConfig = {
  env: "development",
  origin: "https://example.vrixel.com",
  issuer: "https://id.vrixel.com/realms/example",
  clientId: "example-mobile",
  scopes: ["openid", "profile", "offline_access"],
  phi: false,
  scheme: "com.vrixel.example",
  sentryDsn: "",
};

/** A JWT-shaped token with these claims (unsigned: only ever decoded for display). */
export function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${part({ alg: "none" })}.${part(claims)}.sig`;
}

export function tokens(overrides: Partial<Tokens> = {}): Tokens {
  return {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    idToken: jwt({ sub: "u1", name: "Ada Lovelace" }),
    expiresAt: Date.now() / 1000 + 300,
    ...overrides,
  };
}

export function fakeOidc(overrides: Partial<Oidc> = {}): Oidc & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    signIn: () => {
      calls.push("signIn");
      return Promise.resolve(tokens());
    },
    refresh: (refreshToken) => {
      calls.push(`refresh:${refreshToken}`);
      return Promise.resolve(tokens({ accessToken: "access-2", refreshToken: "refresh-2" }));
    },
    signOut: () => {
      calls.push("signOut");
      return Promise.resolve();
    },
    ...overrides,
  };
}

/** An API that answers from a script: one response (or error) per call, in order. */
export function scriptedHttp(...answers: (ApiResponse | Error)[]): Http & { requests: ApiRequest[] } {
  const requests: ApiRequest[] = [];
  return {
    requests,
    send: (request) => {
      requests.push(request);
      const answer = answers.shift() ?? { status: 202, body: { eventId: "e", status: "accepted" } };
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
}

export async function fakeServices(
  options: { signedIn?: boolean; api?: Partial<ApiClient>; http?: Http } = {},
): Promise<Services> {
  const session = new Session(memoryVault(options.signedIn === false ? null : tokens()), fakeOidc());
  await session.restore();
  let n = 0;
  const outbox = new Outbox(memoryStore(), options.http ?? scriptedHttp(), {
    uuid: () => `cmd-${String(++n)}`,
  });
  session.onSignOut(() => outbox.clear());
  return {
    config,
    session,
    outbox,
    api: { greeting: () => Promise.resolve({ message: "Hello, Ada!" }), ...options.api },
    upgrade: { required: false, listeners: new Set() },
  };
}
