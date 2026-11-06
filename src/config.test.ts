import { apiBase, ConfigError, readConfig } from "./config";

const app = {
  env: "production",
  origin: "https://example.vrixel.com/",
  issuer: "https://id.vrixel.com/realms/example",
  clientId: "example-mobile",
  scopes: "profile offline_access",
  phi: true,
  scheme: "com.vrixel.example",
};

describe("readConfig", () => {
  it("reads the build's settings", () => {
    const config = readConfig({ app });
    expect(config.origin).toBe("https://example.vrixel.com");
    expect(config.scopes).toEqual(["openid", "profile", "offline_access"]);
    expect(config.phi).toBe(true);
    expect(apiBase(config)).toBe("https://example.vrixel.com/mobile");
  });

  it("allows plain http only on a developer's machine", () => {
    expect(readConfig({ app: { ...app, env: "development", origin: "http://10.0.2.2:8080" } }).origin).toBe(
      "http://10.0.2.2:8080",
    );
    expect(() => readConfig({ app: { ...app, origin: "http://example.vrixel.com" } })).toThrow(
      /must be https/,
    );
  });

  it("refuses a production build that points at a local server", () => {
    expect(() => readConfig({ app: { ...app, issuer: "http://localhost:8180/realms/x" } })).toThrow(
      ConfigError,
    );
  });

  it("says what is missing", () => {
    expect(() => readConfig({})).toThrow(/no extra.app/);
    expect(() => readConfig({ app: { ...app, clientId: " " } })).toThrow(/clientId is missing/);
    expect(readConfig({ app: { ...app, phi: "yes" } }).phi).toBe(false);
  });

  it("takes a Sentry DSN only in its usual shape", () => {
    expect(readConfig({ app }).sentryDsn).toBe("");
    const dsn = "https://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/42";
    expect(readConfig({ app: { ...app, sentryDsn: ` ${dsn} ` } }).sentryDsn).toBe(dsn);
    expect(() => readConfig({ app: { ...app, sentryDsn: "https://evil.example/x" } })).toThrow(/sentryDsn/);
  });
});
