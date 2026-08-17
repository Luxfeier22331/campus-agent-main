import * as Sentry from "@sentry/cloudflare";

import { createCampusEdgeSentryOptions } from "./platform/telemetry/sentry-edge";
import { campusWorker } from "./platform/worker/router";

export { applyUpstreamCorrelationTags } from "./platform/worker/app-api-proxy";
export type { CampusWorkerEnv as Env } from "./platform/worker/env";
export { CAMPUS_ALLOWED_APP_API_PATHS } from "./platform/worker-proxy/allowlist";

export default Sentry.withSentry(createCampusEdgeSentryOptions, campusWorker);
