import { HttpError } from "react-admin";

interface HttpRequestOptions {
  method?: string;
  signal?: AbortSignal;
}

function parseMessage(payload: unknown, statusText: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  return statusText || "Request failed.";
}

export async function fetchJson<T>(
  path: string,
  options: HttpRequestOptions = {},
): Promise<T> {
  const response = await fetch(path, {
    headers: {
      accept: "application/json",
    },
    method: options.method ?? "GET",
    signal: options.signal,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new HttpError(parseMessage(payload, response.statusText), response.status, payload);
  }

  return payload as T;
}
