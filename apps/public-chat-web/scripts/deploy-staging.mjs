import { spawnSync } from "node:child_process";
import { loadRepoEnvFile } from "../../../scripts/load-repo-env.mjs";
import { buildWranglerCommandEnv } from "../../../scripts/run-wrangler-command.mjs";
import { resolveStagingSentryRelease } from "../../../scripts/staging-release.mjs";

const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
loadRepoEnvFile(import.meta.url, "../../..");
const sentryRelease = resolveStagingSentryRelease("public-chat-web");
const turnstileSiteKey = process.env.STAGING_AUTH_TURNSTILE_SITE_KEY?.trim();

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!turnstileSiteKey) {
  fail(
    "STAGING_AUTH_TURNSTILE_SITE_KEY is required. Inject the real Turnstile sitekey admitted for campus-chat-staging.ayafeed.com before deploying.",
  );
}

if (turnstileSiteKey === TURNSTILE_TEST_SITE_KEY) {
  fail(
    "STAGING_AUTH_TURNSTILE_SITE_KEY must not use the Cloudflare Turnstile testing sitekey for staging deploys.",
  );
}

const result = spawnSync(
  "wrangler",
  [
    "deploy",
    "--config",
    "dist/public_chat_web/wrangler.json",
    "--var",
    `AUTH_TURNSTILE_SITE_KEY:${turnstileSiteKey}`,
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
