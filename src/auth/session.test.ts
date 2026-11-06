import { fakeOidc, jwt, tokens } from "../test/fakes";
import { decodePayload, RefreshRefused, Session, SignedOut } from "./session";
import { memoryVault } from "./vault";

const at = (seconds: number) => () => seconds;

describe("Session", () => {
  it("restores a saved sign-in and hands out the token while it is fresh", async () => {
    const session = new Session(memoryVault(tokens({ expiresAt: 1000 })), fakeOidc(), at(900));
    expect(await session.restore()).toBe("signedIn");
    expect(await session.accessToken()).toBe("access-1");
    expect(session.claims?.name).toBe("Ada Lovelace");
  });

  it("refreshes shortly before expiry, once for concurrent callers, and keeps the rotated token", async () => {
    const vault = memoryVault(tokens({ expiresAt: 1000 }));
    const oidc = fakeOidc();
    const session = new Session(vault, oidc, at(980));
    await session.restore();
    const [a, b] = await Promise.all([session.accessToken(), session.accessToken()]);
    expect([a, b]).toEqual(["access-2", "access-2"]);
    expect(oidc.calls).toEqual(["refresh:refresh-1"]);
    expect(vault.tokens?.refreshToken).toBe("refresh-2");
  });

  it("keeps the refresh and ID tokens when Keycloak doesn't send new ones", async () => {
    const vault = memoryVault(tokens({ expiresAt: 0 }));
    const oidc = fakeOidc({ refresh: () => Promise.resolve({ accessToken: "access-3", expiresAt: 2000 }) });
    const session = new Session(vault, oidc, at(10));
    await session.restore();
    expect(await session.accessToken()).toBe("access-3");
    expect(vault.tokens?.refreshToken).toBe("refresh-1");
    expect(vault.tokens?.idToken).toBeDefined();
  });

  it("keeps the tokens when Keycloak can't be reached", async () => {
    const vault = memoryVault(tokens({ expiresAt: 0 }));
    const session = new Session(
      vault,
      fakeOidc({ refresh: () => Promise.reject(new TypeError("Network request failed")) }),
      at(10),
    );
    await session.restore();
    await expect(session.accessToken()).rejects.toThrow(TypeError);
    expect(session.state).toBe("signedIn");
    expect(vault.tokens).not.toBeNull();
  });

  it("signs out and wipes when Keycloak refuses the refresh", async () => {
    const vault = memoryVault(tokens({ expiresAt: 0 }));
    const session = new Session(
      vault,
      fakeOidc({ refresh: () => Promise.reject(new RefreshRefused("invalid_grant")) }),
      at(10),
    );
    const wiped = jest.fn(() => Promise.resolve());
    session.onSignOut(wiped);
    const states: string[] = [];
    session.subscribe((s) => states.push(s));
    await session.restore();
    await expect(session.accessToken()).rejects.toThrow(SignedOut);
    expect(vault.tokens).toBeNull();
    expect(wiped).toHaveBeenCalled();
    expect(states).toEqual(["signedIn", "signedOut"]);
  });

  it("signs out without a refresh token to use", async () => {
    const session = new Session(
      memoryVault(tokens({ expiresAt: 0, refreshToken: undefined })),
      fakeOidc(),
      at(10),
    );
    await session.restore();
    await expect(session.refresh()).rejects.toThrow(SignedOut);
    expect(session.state).toBe("signedOut");
  });

  it("signs in, and treats a cancelled sign-in as nothing", async () => {
    const vault = memoryVault();
    let cancel = true;
    const oidc = fakeOidc({ signIn: () => Promise.resolve(cancel ? null : tokens()) });
    const session = new Session(vault, oidc);
    expect(await session.restore()).toBe("signedOut");
    await expect(session.accessToken()).rejects.toThrow(SignedOut);
    expect(await session.signIn()).toBe(false);
    cancel = false;
    expect(await session.signIn()).toBe(true);
    expect(session.state).toBe("signedIn");
    expect(vault.tokens).not.toBeNull();
  });

  it("signs out here even when Keycloak can't be reached", async () => {
    const vault = memoryVault(tokens());
    const session = new Session(vault, fakeOidc({ signOut: () => Promise.reject(new Error("offline")) }));
    await session.restore();
    await session.signOut();
    expect(session.state).toBe("signedOut");
    expect(vault.tokens).toBeNull();
  });

  it("starts signed out when the saved sign-in can't be read", async () => {
    const vault = { ...memoryVault(), load: () => Promise.reject(new Error("biometrics cancelled")) };
    const session = new Session(vault, fakeOidc());
    expect(await session.restore()).toBe("signedOut");
    expect(session.claims).toBeNull();
  });
});

describe("decodePayload", () => {
  it("decodes a JWT's claims and rejects anything else", () => {
    expect(decodePayload(jwt({ sub: "u1", name: "Zoë" }))?.name).toBe("Zoë");
    expect(decodePayload("not-a-jwt")).toBeNull();
    expect(decodePayload("a.%%%.c")).toBeNull();
  });
});
