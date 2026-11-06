import { scriptedHttp } from "../test/fakes";
import { createApiClient, saveGreeting } from "./client";
import { ApiError } from "./http";

describe("ApiClient", () => {
  it("reads a greeting", async () => {
    const http = scriptedHttp({ status: 200, body: { message: "Hello, Ada Lovelace!" } });
    expect(await createApiClient(http).greeting("Ada Lovelace")).toEqual({ message: "Hello, Ada Lovelace!" });
    expect(http.requests[0]).toEqual({ method: "GET", path: "/api/v1/greetings?name=Ada%20Lovelace" });
  });

  it("raises the API's problem", async () => {
    const http = scriptedHttp({ status: 403, body: { title: "Forbidden" } });
    await expect(createApiClient(http).greeting("Ada")).rejects.toBeInstanceOf(ApiError);
  });

  it("makes saving a greeting an outbox command for its record", () => {
    expect(saveGreeting("ada", { name: "Ada", message: "Hi" })).toEqual({
      method: "PUT",
      path: "/api/v1/greetings/ada",
      body: { name: "Ada", message: "Hi" },
      record: "greeting/ada",
      label: "Greeting for Ada",
    });
  });
});
