/**
 * A typed client for the product's API. The contract test (client.pact.test.ts) pins what this
 * client relies on, so the API cannot break it without its own pipeline failing first. Store
 * builds stay installed for months: the API must keep answering every version still supported.
 *
 * Reads go straight to the API. Changes go through the outbox (../outbox), which keeps them on
 * the device until the API accepts them, so they survive no signal, restarts and retries.
 */
import { ApiError, type Http } from "./http";

export interface Greeting {
  message: string;
}

export interface SaveGreeting {
  name: string;
  message: string;
}

export interface ApiClient {
  greeting(name: string): Promise<Greeting>;
}

export function createApiClient(http: Http): ApiClient {
  return {
    async greeting(name) {
      const response = await http.send({
        method: "GET",
        path: `/api/v1/greetings?name=${encodeURIComponent(name)}`,
      });
      if (response.status !== 200) throw ApiError.from(response);
      return response.body as Greeting;
    },
  };
}

/** The change, as an outbox command: one per record, applied in order. */
export function saveGreeting(id: string, greeting: SaveGreeting) {
  return {
    method: "PUT" as const,
    path: `/api/v1/greetings/${encodeURIComponent(id)}`,
    body: greeting,
    record: `greeting/${id}`,
    label: `Greeting for ${greeting.name}`,
  };
}
