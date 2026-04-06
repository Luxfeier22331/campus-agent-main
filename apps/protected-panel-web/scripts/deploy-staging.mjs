import { spawnSync } from "node:child_process";

const PLACEHOLDER_ACCESS_POLICY_AUD = "panel-audience";
const PLACEHOLDER_ACCESS_TEAM_DOMAIN = "https://team.cloudflareaccess.com";
const STAGING_RELEASE_PREFIX = "protected-panel-web@staging-";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizeAccessTeamDomain(value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    fail(
      "STAGING_ACCESS_TEAM_DOMAIN is required. Inject the real Cloudflare Access team domain for panel staging before deploy.",
    );
  }

  let normalized;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      fail("STAGING_ACCESS_TEAM_DOMAIN must start with http:// or https://");
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    normalized = parsed.toString().replace(/\/$/, "");
  } catch {
    fail("STAGING_ACCESS_TEAM_DOMAIN must be a valid absolute URL.");
  }

  if (normalized === PLACEHOLDER_ACCESS_TEAM_DOMAIN) {
    fail("STAGING_ACCESS_TEAM_DOMAIN must not use the placeholder Cloudflare Access team domain.");
  }

  return normalized;
}

function normalizeAccessPolicyAud(value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    fail(
      "STAGING_ACCESS_POLICY_AUD is required. Inject the real Cloudflare Access application audience for panel staging before deploy.",
    );
  }
  if (trimmed === PLACEHOLDER_ACCESS_POLICY_AUD) {
    fail("STAGING_ACCESS_POLICY_AUD must not use the placeholder Access audience.");
  }

  return trimmed;
}

function resolveSentryRelease(override) {
  const trimmedOverride = override?.trim();
  if (trimmedOverride) {
    return trimmedOverride;
  }

  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  if (result.status !== 0) {
    fail("Unable to derive SENTRY_RELEASE from git rev-parse --short HEAD.");
  }

  const commitSha = result.stdout?.trim();
  if (!commitSha) {
    fail("Unable to derive SENTRY_RELEASE because git returned an empty commit SHA.");
  }

  return `${STAGING_RELEASE_PREFIX}${commitSha}`;
}

const accessTeamDomain = normalizeAccessTeamDomain(process.env.STAGING_ACCESS_TEAM_DOMAIN);
const accessPolicyAud = normalizeAccessPolicyAud(process.env.STAGING_ACCESS_POLICY_AUD);
const sentryRelease = resolveSentryRelease(process.env.STAGING_SENTRY_RELEASE);

const result = spawnSync(
  "wrangler",
  [
    "deploy",
    "--config",
    "dist/protected_panel_web/wrangler.json",
    "--var",
    `ACCESS_TEAM_DOMAIN:${accessTeamDomain}`,
    "--var",
    `ACCESS_POLICY_AUD:${accessPolicyAud}`,
    "--var",
    `SENTRY_RELEASE:${sentryRelease}`,
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
