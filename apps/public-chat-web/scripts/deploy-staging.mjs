import { spawnSync } from "node:child_process";
import { buildWranglerCommandEnv } from "../../../scripts/run-wrangler-command.mjs";
import { resolveStagingSentryRelease } from "../../../scripts/staging-release.mjs";

const sentryRelease = resolveStagingSentryRelease("public-chat-web");

const result = spawnSync(
  "wrangler",
  [
    "deploy",
    "--config",
    "dist/public_chat_web/wrangler.json",
    "--var",
    `SENTRY_RELEASE:${sentryRelease}`,
  ],
  {
    env: buildWranglerCommandEnv(process.env),
    stdio: "inherit",
  },
);

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(result.error ? 1 : 0);
