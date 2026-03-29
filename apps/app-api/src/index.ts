import type { CloudflareOptions } from "@sentry/cloudflare";
import * as Sentry from "@sentry/cloudflare";

import { createApp, type AppDependencies } from "./app";
import { resolveAppName, type Env } from "./config";
import { createOfficialWebHandoffPublisher } from "./modules/integration";
import {
  buildOfficialWebProjectionProjector,
  createPgOfficialWebProjectionStore,
  type OfficialWebProjectionProjector,
} from "./modules/official-web-projection";
import {
  buildRequestProjectionProjector,
  createPgProjectionStore,
  type RequestProjectionProjector,
} from "./modules/projection";
import { createAppTelemetry } from "./modules/telemetry";

export type { Env } from "./config";

export interface WorkerRuntimeDependencies extends AppDependencies {
  officialWebProjector?: OfficialWebProjectionProjector;
  requestProjector?: RequestProjectionProjector;
}

const SENSITIVE_EVENT_FIELDS = new Set([
  "answer",
  "authorization",
  "cf-access-jwt-assertion",
  "cookie",
  "operator_email",
  "prompt",
  "transcript",
  "x-app-internal-auth",
  "x-app-operator-email",
  "x-worker-origin-auth",
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

function createSentryOptions(env: Env): CloudflareOptions | undefined {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) {
    return undefined;
  }

  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || undefined,
    initialScope: {
      tags: {
        app: resolveAppName(env),
        runtime: "cloudflare-worker",
        surface: "app_api",
      },
    },
    release: env.SENTRY_RELEASE?.trim() || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 1,
    beforeSend(event) {
      scrubSensitiveRecord(event.request?.headers);
      scrubSensitiveRecord(event.request?.data);
      scrubSensitiveRecord(event.contexts?.trace);
      scrubSensitiveRecord(event.extra);
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
        delete event.user.username;
      }
      return event;
    },
  };
}

export function createWorkerRuntime(
  env: Env,
  dependencies: WorkerRuntimeDependencies = {},
) {
  const telemetry = dependencies.telemetry ?? createAppTelemetry(env);
  const requestProjector =
    dependencies.requestProjector ??
    buildRequestProjectionProjector({
      store: createPgProjectionStore(env),
    });
  const officialWebProjector =
    dependencies.officialWebProjector ??
    buildOfficialWebProjectionProjector({
      handoffPublisher: createOfficialWebHandoffPublisher(env),
      store: createPgOfficialWebProjectionStore(env),
    });

  return {
    fetch(request: Request): Promise<Response> | Response {
      return createApp(env, { ...dependencies, telemetry }).fetch(request, env);
    },
    async scheduled(): Promise<void> {
      const requestResult = await Sentry.startSpan(
        {
          name: "app-api.request-projection.drain",
          op: "cron",
        },
        () => requestProjector.drain(),
      );
      const officialWebResult = await Sentry.startSpan(
        {
          name: "app-api.official-web-projection.drain",
          op: "cron",
        },
        () => officialWebProjector.drain(),
      );
      if (requestResult.processed > 0 || requestResult.failed > 0) {
        await telemetry.recordProjectionDrain({
          failed: requestResult.failed,
          processed: requestResult.processed,
          projector: "request_projection",
          projectorLastErrorCode: requestResult.failed > 0 ? "projection_failed" : null,
          surface: "app_api",
        });
      }
      if (
        officialWebResult.processed > 0 ||
        officialWebResult.failed > 0 ||
        officialWebResult.abandoned > 0
      ) {
        await telemetry.recordProjectionDrain({
          abandoned: officialWebResult.abandoned,
          failed: officialWebResult.failed,
          processed: officialWebResult.processed,
          projector: "official_web_projection",
          projectorLastErrorCode: officialWebResult.failed > 0 ? "projection_failed" : null,
          surface: "official_web",
        });
      }
      if (requestResult.processed > 0) {
        console.info(
          JSON.stringify({
            failed: requestResult.failed,
            processed: requestResult.processed,
            source: "app-api.request-projection-projector",
          }),
        );
      }
      if (requestResult.failed > 0) {
        console.error(
          JSON.stringify({
            failed: requestResult.failed,
            processed: requestResult.processed,
            source: "app-api.request-projection-projector",
          }),
        );
      }
      if (officialWebResult.processed > 0 || officialWebResult.abandoned > 0) {
        console.info(
          JSON.stringify({
            abandoned: officialWebResult.abandoned,
            failed: officialWebResult.failed,
            processed: officialWebResult.processed,
            source: "app-api.official-web-projection-projector",
          }),
        );
      }
      if (officialWebResult.failed > 0) {
        console.error(
          JSON.stringify({
            abandoned: officialWebResult.abandoned,
            failed: officialWebResult.failed,
            processed: officialWebResult.processed,
            source: "app-api.official-web-projection-projector",
          }),
        );
      }
    },
  };
}

const worker = {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    return createWorkerRuntime(env).fetch(request);
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await createWorkerRuntime(env).scheduled();
  },
};

export default Sentry.withSentry(createSentryOptions, worker);
