import { spawnSync } from "node:child_process";

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

const result = spawnSync(
  "wrangler",
  [
    "deploy",
    "--env",
    "staging",
    "--var",
    `SUPERVISOR_API_BASE_URL:${normalizedUpstream}`,
  ],
  {
    env: process.env,
    stdio: "inherit",
  },
);

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(result.error ? 1 : 0);
