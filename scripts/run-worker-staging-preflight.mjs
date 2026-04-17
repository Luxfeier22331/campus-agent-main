import { spawnSync } from "node:child_process";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.error) {
    fail(`Failed to run ${command}: ${result.error.message}`);
  }
}

function parseArgs(argv) {
  let appPath = null;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--app") {
      appPath = argv[index + 1] ?? null;
      index += 1;
    }
  }

  if (!appPath) {
    fail("Usage: node scripts/run-worker-staging-preflight.mjs --app <apps/app-api|apps/public-chat-web|apps/protected-panel-web>");
  }

  return { appPath };
}

const APP_PREFLIGHTS = {
  "apps/app-api": {
    doctorSurface: "worker-staging-app-api",
    commands: [
      [
        "uv",
        [
          "run",
          "--all-packages",
          "python",
          "-m",
          "scripts.check_worker_secret_presence",
          "--app",
          "apps/app-api",
          "--env",
          "staging",
        ],
      ],
      ["node", ["apps/app-api/scripts/verify-staging-config.mjs"]],
      ["pnpm", ["--dir", "apps/app-api", "db:reconcile-shared-drift:staging", "--", "--json"]],
    ],
  },
  "apps/public-chat-web": {
    doctorSurface: "worker-staging-public-chat-web",
    commands: [
      [
        "uv",
        [
          "run",
          "--all-packages",
          "python",
          "-m",
          "scripts.check_worker_secret_presence",
          "--app",
          "apps/public-chat-web",
          "--env",
          "staging",
        ],
      ],
      ["pnpm", ["--dir", "apps/public-chat-web", "build:staging"]],
      ["pnpm", ["--dir", "apps/public-chat-web", "deploy:verify-config:staging"]],
    ],
  },
  "apps/protected-panel-web": {
    doctorSurface: "worker-staging-protected-panel-web",
    commands: [
      [
        "uv",
        [
          "run",
          "--all-packages",
          "python",
          "-m",
          "scripts.check_worker_secret_presence",
          "--app",
          "apps/protected-panel-web",
          "--env",
          "staging",
        ],
      ],
      ["pnpm", ["--dir", "apps/protected-panel-web", "build:staging"]],
      ["pnpm", ["--dir", "apps/protected-panel-web", "deploy:verify-config:staging"]],
    ],
  },
};

function main() {
  const { appPath } = parseArgs(process.argv.slice(2));
  const preflight = APP_PREFLIGHTS[appPath];
  if (!preflight) {
    fail(`Unsupported app path ${appPath}.`);
  }

  run("uv", [
    "run",
    "--all-packages",
    "python",
    "-m",
    "scripts.doctor_env",
    preflight.doctorSurface,
    "--json",
  ]);

  for (const [command, args] of preflight.commands) {
    run(command, args);
  }
}

main();
