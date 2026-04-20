import * as Sentry from "@sentry/cloudflare";

import { createSentryOptions } from "./index/sentry";
import { worker } from "./index/worker";

export type { Env } from "./index/types";

export default Sentry.withSentry(createSentryOptions, worker);
