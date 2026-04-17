import { spawnSync } from "node:child_process";
import { buildWranglerCommandEnv } from "../../../scripts/run-wrangler-command.mjs";
import { resolveStagingSentryRelease } from "../../../scripts/staging-release.mjs";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const upstream = process.env.STAGING_SUPERVISOR_API_BASE_URL?.trim();
if (!upstream) {
  fail(
    "STAGING_SUPERVISOR_API_BASE_URL is required. Point it at the current dev-backed supervisor origin before deploying staging.",
  );
}

let normalizedUpstream;
try {
  const parsed = new URL(upstream);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail("STAGING_SUPERVISOR_API_BASE_URL must start with http:// or https://");
  }
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  normalizedUpstream = parsed.toString().replace(/\/$/, "");
} catch {
  fail("STAGING_SUPERVISOR_API_BASE_URL must be a valid absolute URL.");
}

const sentryRelease = resolveStagingSentryRelease("app-api");

const result = spawnSync(
  "wrangler",
  [
    "deploy",
    "--env",
    "staging",
    "--var",
    `SUPERVISOR_API_BASE_URL:${normalizedUpstream}`,
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
