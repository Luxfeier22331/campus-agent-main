import { spawnSync } from "node:child_process";

const PLACEHOLDER_ACCESS_POLICY_AUD = "panel-audience";
const PLACEHOLDER_ACCESS_TEAM_DOMAIN = "https://team.cloudflareaccess.com";

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

const accessTeamDomain = normalizeAccessTeamDomain(process.env.STAGING_ACCESS_TEAM_DOMAIN);
const accessPolicyAud = normalizeAccessPolicyAud(process.env.STAGING_ACCESS_POLICY_AUD);

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
