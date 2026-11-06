/**
 * Sign-in with the product's Keycloak realm, as a public client: authorization code with PKCE in
 * the system browser (never a web view the app could read), so the app never sees the password
 * and a stolen redirect is useless without the code verifier.
 */
import {
  AuthRequest,
  ResponseType,
  TokenError,
  TokenTypeHint,
  exchangeCodeAsync,
  makeRedirectUri,
  refreshAsync,
  resolveDiscoveryAsync,
  revokeAsync,
  type DiscoveryDocument,
  type TokenResponse,
} from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import type { AppConfig } from "../config";
import { RefreshRefused, type Oidc, type Tokens } from "./session";

WebBrowser.maybeCompleteAuthSession();

export function toTokens(
  response: Pick<TokenResponse, "accessToken" | "refreshToken" | "idToken" | "expiresIn" | "issuedAt">,
): Tokens {
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    idToken: response.idToken,
    // Keycloak always says; if not, assume a short life so the token is refreshed soon.
    expiresAt: response.issuedAt + (response.expiresIn ?? 60),
  };
}

export function keycloak(
  config: AppConfig,
  discover: (issuer: string) => Promise<DiscoveryDocument> = resolveDiscoveryAsync,
): Oidc {
  const redirectUri = makeRedirectUri({ scheme: config.scheme, path: "callback" });
  let discovery: Promise<DiscoveryDocument> | null = null;
  const doc = (): Promise<DiscoveryDocument> => {
    discovery ??= discover(config.issuer).catch((e: unknown) => {
      discovery = null; // try again next time (offline at launch)
      throw e;
    });
    return discovery;
  };

  return {
    async signIn() {
      const d = await doc();
      const request = new AuthRequest({
        clientId: config.clientId,
        scopes: config.scopes,
        redirectUri,
        responseType: ResponseType.Code,
        usePKCE: true,
      });
      // Ephemeral (iOS): no shared browser cookies, so a shared device doesn't keep a sign-in.
      const result = await request.promptAsync(d, { preferEphemeralSession: true });
      if (result.type === "cancel" || result.type === "dismiss") return null;
      if (result.type !== "success") {
        throw new Error(
          result.type === "error"
            ? `sign-in failed: ${result.error?.code ?? "unknown"}`
            : `sign-in ${result.type}`,
        );
      }
      const response = await exchangeCodeAsync(
        {
          clientId: config.clientId,
          code: result.params.code ?? "",
          redirectUri,
          extraParams: { code_verifier: request.codeVerifier ?? "" },
        },
        d,
      );
      return toTokens(response);
    },

    async refresh(refreshToken) {
      const d = await doc();
      try {
        return toTokens(await refreshAsync({ clientId: config.clientId, refreshToken }, d));
      } catch (e) {
        if (
          e instanceof TokenError &&
          (e.code === "invalid_grant" || e.code === "invalid_client" || e.code === "unauthorized_client")
        ) {
          throw new RefreshRefused(e.code);
        }
        throw e;
      }
    },

    async signOut(tokens) {
      const d = await doc();
      // Revoking the refresh token ends this app's session at Keycloak.
      if (tokens.refreshToken && d.revocationEndpoint) {
        await revokeAsync(
          {
            clientId: config.clientId,
            token: tokens.refreshToken,
            tokenTypeHint: TokenTypeHint.RefreshToken,
          },
          d,
        );
      }
      // End the browser's Keycloak session too (Android's custom tabs share cookies).
      if (d.endSessionEndpoint && tokens.idToken) {
        const url =
          `${d.endSessionEndpoint}?client_id=${encodeURIComponent(config.clientId)}` +
          `&id_token_hint=${encodeURIComponent(tokens.idToken)}` +
          `&post_logout_redirect_uri=${encodeURIComponent(redirectUri)}`;
        await WebBrowser.openAuthSessionAsync(url, redirectUri, { preferEphemeralSession: true });
      }
    },
  };
}
