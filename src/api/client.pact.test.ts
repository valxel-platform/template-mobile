import { MatchersV3, PactV4 } from "@pact-foundation/pact";
import { createApiClient, saveGreeting } from "./client";
import { createHttp } from "./http";

// Rename the participants when you create a product repo from this template: consumer is this app,
// provider is the API repo whose CI verifies this pact (see its PactProviderTest). The BFF's
// mobile route only strips /mobile, so the pact is against the API's own paths.
const pact = new PactV4({
  consumer: "template-mobile",
  provider: "template-service",
  dir: "pacts", // relative to the repository root, where jest runs
});

function http(url: string) {
  return createHttp({
    base: url,
    session: {
      accessToken: () => Promise.resolve("token"),
      refresh: () => Promise.resolve({ accessToken: "token", expiresAt: 0 }),
    },
    appVersion: "1.0.0",
    platform: "ios",
    randomBytes: (n) => new Uint8Array(n).fill(1),
  });
}

describe("greetings API contract", () => {
  it("returns a greeting for a name", () =>
    pact
      .addInteraction()
      .given("greetings are available")
      .uponReceiving("a request for a greeting from the mobile app")
      .withRequest("GET", "/api/v1/greetings", (b) =>
        b.query({ name: "Ada" }).headers({ Accept: "application/json" }),
      )
      .willRespondWith(200, (b) =>
        b
          .jsonBody({ message: MatchersV3.string("Hello, Ada!") })
          .headers({ "Content-Type": "application/json" }),
      )
      .executeTest(async (server) => {
        expect((await createApiClient(http(server.url)).greeting("Ada")).message).toBe("Hello, Ada!");
      }));

  it("accepts a greeting saved with an idempotency key", () =>
    pact
      .addInteraction()
      .given("greetings are available")
      .uponReceiving("a greeting saved from the mobile app's outbox")
      .withRequest("PUT", "/api/v1/greetings/ada", (b) =>
        b
          .headers({
            "Content-Type": "application/json",
            "Idempotency-Key": MatchersV3.string("0b0f4a3e-6c8e-4a39-9d55-2f4b2c1d9e10"),
          })
          .jsonBody({ name: "Ada", message: "Hello" }),
      )
      .willRespondWith(202, (b) => b.jsonBody({ eventId: MatchersV3.string("e7c1"), status: "accepted" }))
      .executeTest(async (server) => {
        const command = saveGreeting("ada", { name: "Ada", message: "Hello" });
        const res = await http(server.url).send({
          ...command,
          idempotencyKey: "0b0f4a3e-6c8e-4a39-9d55-2f4b2c1d9e10",
        });
        expect(res.status).toBe(202);
      }));
});
