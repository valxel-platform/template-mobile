/**
 * Calls to the product's API through the BFF's mobile route (`<origin>/mobile/api/...`), with the
 * person's access token.
 *
 * Every request carries:
 * - `Authorization: Bearer`: refreshed first if it expires soon; a 401 refreshes once and retries.
 * - `X-App-Version`, `X-App-Platform`: the BFF answers 426 to versions older than the oldest it
 *   still supports, and the app asks the person to update (UpgradeRequired).
 * - `traceparent`: a new trace per request, so the call is traced from the device on.
 * - `Idempotency-Key` on writes: retries (the outbox's) are applied once.
 */
import type { Session } from "../auth/session";

export interface ApiRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** From the API's root, e.g. /api/v1/greetings */
  path: string;
  body?: unknown;
  idempotencyKey?: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  /** The request's trace: the one the API named (traceresponse), else the one this app started. */
  traceId?: string;
}

/** An RFC 9457 problem from the API: show its title or detail, never a raw body. `endpoint` and
 * `traceId` tie a reported error to the backend's errors from the same request. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly endpoint = "",
    readonly traceId = "",
  ) {
    super(`API ${String(status)}: ${detail ?? title}`);
    this.name = "ApiError";
  }

  static from(response: ApiResponse, endpoint = ""): ApiError {
    const problem = (response.body ?? {}) as { title?: string; detail?: string };
    return new ApiError(
      response.status,
      problem.title ?? `HTTP ${String(response.status)}`,
      problem.detail,
      endpoint,
      response.traceId ?? "",
    );
  }
}

const TRACE = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

/** The trace id in a W3C traceparent or traceresponse value, or "". */
export function traceIdOf(value: string | null | undefined): string {
  return TRACE.exec(value?.trim() ?? "")?.[1] ?? "";
}

/** The device couldn't reach the API. */
export class Offline extends Error {
  constructor(cause?: unknown) {
    super("can't reach the server", { cause });
  }
}

/** This version of the app is no longer supported: the person must update from the store. */
export class UpgradeRequired extends Error {
  constructor() {
    super("this version of the app is no longer supported");
  }
}

export interface Http {
  send(request: ApiRequest): Promise<ApiResponse>;
}

export interface HttpOptions {
  /** `<origin>/mobile` */
  base: string;
  session: Pick<Session, "accessToken" | "refresh">;
  appVersion: string;
  platform: string;
  fetch?: typeof fetch;
  /** Random bytes for trace ids (expo-crypto in the app). */
  randomBytes: (count: number) => Uint8Array;
  /** Called when the BFF says this version is too old. */
  onUpgradeRequired?: () => void;
  /** Called when a call fails for the person: a 5xx or no answer (gradual releases, cohorts.ts). */
  onFailure?: () => void;
  timeoutMs?: number;
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export function traceparent(randomBytes: (count: number) => Uint8Array): string {
  return `00-${hex(randomBytes(16))}-${hex(randomBytes(8))}-01`;
}

export function createHttp(options: HttpOptions): Http {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  const once = async (request: ApiRequest, token: string): Promise<ApiResponse> => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "X-App-Version": options.appVersion,
      "X-App-Platform": options.platform,
      traceparent: traceparent(options.randomBytes),
    };
    const started = traceIdOf(headers.traceparent);
    if (request.body !== undefined) headers["Content-Type"] = "application/json";
    if (request.idempotencyKey) headers["Idempotency-Key"] = request.idempotencyKey;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${options.base}${request.path}`, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });
    } catch (e) {
      options.onFailure?.();
      throw new Offline(e);
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 500) options.onFailure?.();
    const type = res.headers.get("content-type") ?? "";
    const body: unknown = type.includes("json") ? await res.json().catch(() => null) : null;
    return { status: res.status, body, traceId: traceIdOf(res.headers.get("traceresponse")) || started };
  };

  return {
    async send(request) {
      let response = await once(request, await options.session.accessToken());
      if (response.status === 401) {
        // The token was revoked or expired early: refresh once (SignedOut if Keycloak refuses).
        const tokens = await options.session.refresh();
        response = await once(request, tokens.accessToken);
      }
      if (response.status === 426) {
        options.onUpgradeRequired?.();
        throw new UpgradeRequired();
      }
      return response;
    },
  };
}
