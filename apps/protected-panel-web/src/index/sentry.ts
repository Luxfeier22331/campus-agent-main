import type { CloudflareOptions } from "@sentry/cloudflare";

import type { Env } from "./types";
import { resolvePanelAppName } from "./types";

const SENSITIVE_EVENT_FIELDS = new Set([
  "authorization",
  "cf-access-jwt-assertion",
  "cookie",
  "operator_email",
  "x-app-internal-auth",
]);

function scrubSensitiveRecord(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (SENSITIVE_EVENT_FIELDS.has(key.toLowerCase())) {
      delete (value as Record<string, unknown>)[key];
    }
  }
}

export function createSentryOptions(env: Env): CloudflareOptions | undefined {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) {
    return undefined;
  }

  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || undefined,
    initialScope: {
      tags: {
        app: resolvePanelAppName(env),
        runtime: "cloudflare-worker",
        surface: "protected-panel-web",
      },
    },
    release: env.SENTRY_RELEASE?.trim() || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 1,
    beforeSend(event) {
      scrubSensitiveRecord(event.request?.headers);
      scrubSensitiveRecord(event.request?.data);
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
        delete event.user.username;
      }
      return event;
    },
  };
}
