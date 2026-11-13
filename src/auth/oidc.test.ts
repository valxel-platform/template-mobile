import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { config } from "../test/fakes";
import { keycloak, toTokens } from "./oidc";
import { RefreshRefused } from "./session";

jest.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(() => Promise.resolve({ type: "success" })),
}));

const mockPrompt = jest.fn();
jest.mock("expo-auth-session", () => {
  const actual = jest.requireActual<typeof AuthSession>("expo-auth-session");
  return {
    ...actual,
    makeRedirectUri: jest.fn(() => "com.valxel.example://callback"),
    AuthRequest: jest.fn().mockImplementation(() => ({ codeVerifier: "verifier", promptAsync: mockPrompt })),
    exchangeCodeAsync: jest.fn(),
    refreshAsync: jest.fn(),
    revokeAsync: jest.fn(() => Promise.resolve(true)),
  };
});

const auth = jest.mocked(AuthSession);
const discovery = {
  authorizationEndpoint: "https://id/auth",
  tokenEndpoint: "https://id/token",
  revocationEndpoint: "https://id/revoke",
  endSessionEndpoint: "https://id/logout",
};
const response = { accessToken: "a", refreshToken: "r", idToken: "i", expiresIn: 300, issuedAt: 1000 };

beforeEach(() => jest.clearAllMocks());

describe("keycloak", () => {
  it("signs in with PKCE in an ephemeral browser session and exchanges the code", async () => {
    const discover = jest.fn(() => Promise.resolve(discovery));
    mockPrompt.mockResolvedValue({ type: "success", params: { code: "the-code" } });
    auth.exchangeCodeAsync.mockResolvedValue(response as never);
    const oidc = keycloak(config, discover);

    expect(await oidc.signIn()).toEqual({
      accessToken: "a",
      refreshToken: "r",
      idToken: "i",
      expiresAt: 1300,
    });
    expect(auth.AuthRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "example-mobile",
        usePKCE: true,
        responseType: "code",
        redirectUri: "com.valxel.example://callback",
      }),
    );
    expect(mockPrompt).toHaveBeenCalledWith(discovery, { preferEphemeralSession: true });
    expect(auth.exchangeCodeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ code: "the-code", extraParams: { code_verifier: "verifier" } }),
      discovery,
    );

    await oidc.signIn();
    expect(discover).toHaveBeenCalledTimes(1); // discovery is kept
  });

  it("treats a cancelled sign-in as nothing, and an error as a failure", async () => {
    const oidc = keycloak(config, () => Promise.resolve(discovery));
    mockPrompt.mockResolvedValueOnce({ type: "cancel" });
    expect(await oidc.signIn()).toBeNull();
    mockPrompt.mockResolvedValueOnce({ type: "error", error: { code: "access_denied" } });
    await expect(oidc.signIn()).rejects.toThrow("sign-in failed: access_denied");
    mockPrompt.mockResolvedValueOnce({ type: "locked" });
    await expect(oidc.signIn()).rejects.toThrow("sign-in locked");
  });

  it("looks up discovery again after failing offline", async () => {
    const discover = jest.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(discovery);
    const oidc = keycloak(config, discover);
    await expect(oidc.signIn()).rejects.toThrow("offline");
    mockPrompt.mockResolvedValue({ type: "dismiss" });
    expect(await oidc.signIn()).toBeNull();
  });

  it("refreshes, and says when Keycloak refuses", async () => {
    const oidc = keycloak(config, () => Promise.resolve(discovery));
    auth.refreshAsync.mockResolvedValueOnce(response as never);
    expect((await oidc.refresh("r")).accessToken).toBe("a");
    auth.refreshAsync.mockRejectedValueOnce(new AuthSession.TokenError({ error: "invalid_grant" }));
    await expect(oidc.refresh("r")).rejects.toBeInstanceOf(RefreshRefused);
    auth.refreshAsync.mockRejectedValueOnce(new TypeError("Network request failed"));
    await expect(oidc.refresh("r")).rejects.toBeInstanceOf(TypeError);
  });

  it("revokes the refresh token and ends the browser session on sign-out", async () => {
    const oidc = keycloak(config, () => Promise.resolve(discovery));
    await oidc.signOut({ accessToken: "a", refreshToken: "r", idToken: "id token", expiresAt: 0 });
    expect(auth.revokeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ token: "r", tokenTypeHint: "refresh_token" }),
      discovery,
    );
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      "https://id/logout?client_id=example-mobile&id_token_hint=id%20token&post_logout_redirect_uri=com.valxel.example%3A%2F%2Fcallback",
      "com.valxel.example://callback",
      { preferEphemeralSession: true },
    );

    jest.clearAllMocks();
    await keycloak(config, () => Promise.resolve({ authorizationEndpoint: "x" })).signOut({
      accessToken: "a",
      expiresAt: 0,
    });
    expect(auth.revokeAsync).not.toHaveBeenCalled();
    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });
});

describe("toTokens", () => {
  it("assumes a short life when Keycloak doesn't say", () => {
    expect(toTokens({ accessToken: "a", issuedAt: 100 }).expiresAt).toBe(160);
  });
});
