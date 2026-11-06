/**
 * A person's sign-in on this device.
 *
 * The app is a public client of the product's Keycloak realm: it signs people in through the
 * system browser with PKCE (oidc.ts) and keeps their tokens in the Keychain or Keystore
 * (vault.ts), never in plain storage. Access tokens are short-lived; the session refreshes them
 * shortly before they expire, one refresh at a time however many calls want a token, and Keycloak
 * rotates the refresh token each time.
 *
 * Offline is normal: a refresh that can't reach Keycloak keeps the tokens (queued changes wait).
 * A refresh Keycloak refuses (the session ended, the person was disabled) signs the person out
 * here too, and sign-out wipes what the app keeps about them (listeners, e.g. the outbox).
 */

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** Seconds since the epoch */
  expiresAt: number;
}

/** Where tokens are kept between launches. */
export interface Vault {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

/** The identity provider. */
export interface Oidc {
  /** Sign in through the system browser; null if the person cancelled. */
  signIn(): Promise<Tokens | null>;
  /** @throws RefreshRefused if Keycloak won't refresh (the session is over), anything else if unreachable */
  refresh(refreshToken: string): Promise<Tokens>;
  /** End the session at Keycloak (best effort: sign-out here happens regardless). */
  signOut(tokens: Tokens): Promise<void>;
}

/** Keycloak refused to refresh: the session is over and the person must sign in again. */
export class RefreshRefused extends Error {}

/** No one is signed in (or the session just ended). */
export class SignedOut extends Error {
  constructor() {
    super("not signed in");
  }
}

export type SessionState = "unknown" | "signedOut" | "signedIn";

export interface Claims {
  sub?: string;
  name?: string;
  preferred_username?: string;
  [claim: string]: unknown;
}

export class Session {
  private tokens: Tokens | null = null;
  private status: SessionState = "unknown";
  private refreshing: Promise<Tokens> | null = null;
  private readonly listeners = new Set<(state: SessionState) => void>();
  private readonly signOutHooks: (() => Promise<void>)[] = [];

  constructor(
    private readonly vault: Vault,
    private readonly oidc: Oidc,
    private readonly now: () => number = () => Date.now() / 1000,
    /** Refresh this many seconds before the access token expires. */
    private readonly early = 30,
  ) {}

  get state(): SessionState {
    return this.status;
  }

  /** Who is signed in, from the ID token (display only: the API checks the access token). */
  get claims(): Claims | null {
    const token = this.tokens?.idToken;
    return token ? decodePayload(token) : null;
  }

  subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Run on every sign-out, before it completes: wipe what the app keeps about this person. */
  onSignOut(hook: () => Promise<void>): void {
    this.signOutHooks.push(hook);
  }

  /** At launch: pick up a saved sign-in. */
  async restore(): Promise<SessionState> {
    try {
      this.tokens = await this.vault.load();
    } catch {
      // Unreadable (the device's lock changed, biometrics cancelled): sign in again.
      this.tokens = null;
    }
    this.set(this.tokens ? "signedIn" : "signedOut");
    return this.status;
  }

  /** @returns false if the person cancelled */
  async signIn(): Promise<boolean> {
    const tokens = await this.oidc.signIn();
    if (!tokens) return false;
    await this.keep(tokens);
    this.set("signedIn");
    return true;
  }

  /**
   * A current access token, refreshed first if it expires soon.
   * @throws SignedOut if no one is signed in or Keycloak ended the session
   */
  async accessToken(): Promise<string> {
    const tokens = this.tokens;
    if (!tokens) throw new SignedOut();
    if (tokens.expiresAt - this.early > this.now()) return tokens.accessToken;
    return (await this.refresh()).accessToken;
  }

  /** Refresh now (the API said the token is no longer good). */
  async refresh(): Promise<Tokens> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async signOut(): Promise<void> {
    const tokens = this.tokens;
    this.tokens = null;
    // Wipe first: whatever happens next, nothing about this person stays on the device.
    await Promise.allSettled([this.vault.clear(), ...this.signOutHooks.map((hook) => hook())]);
    this.set("signedOut");
    if (tokens) await this.oidc.signOut(tokens).catch(() => undefined);
  }

  private async doRefresh(): Promise<Tokens> {
    const current = this.tokens;
    if (!current?.refreshToken) {
      await this.signOut();
      throw new SignedOut();
    }
    let next: Tokens;
    try {
      next = await this.oidc.refresh(current.refreshToken);
    } catch (e) {
      if (e instanceof RefreshRefused) {
        await this.signOut();
        throw new SignedOut();
      }
      throw e; // unreachable: keep the tokens and try again later
    }
    // Keycloak may not return a new refresh token; keep the one we have then.
    await this.keep({
      ...next,
      refreshToken: next.refreshToken ?? current.refreshToken,
      idToken: next.idToken ?? current.idToken,
    });
    return this.tokens as Tokens;
  }

  private async keep(tokens: Tokens): Promise<void> {
    this.tokens = tokens;
    await this.vault.save(tokens);
  }

  private set(state: SessionState): void {
    if (state === this.status) return;
    this.status = state;
    this.listeners.forEach((listener) => listener(state));
  }
}

/** A JWT's payload, unverified: for display, never for decisions. */
export function decodePayload(jwt: string): Claims | null {
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    const base64 = part
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(part.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Claims;
  } catch {
    return null;
  }
}
