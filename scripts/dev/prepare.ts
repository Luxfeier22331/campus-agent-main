import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const networkName =
	process.env.CAMPUS_AGENT_DATA_PLANE_NETWORK?.trim() || "campus-agent-data-plane";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

if (!commandSucceeds("docker", ["network", "inspect", networkName])) {
	run("docker", ["network", "create", networkName]);
}

run("docker", [
	"compose",
	"--project-name",
	"campus-agent-local",
	"-f",
	"infra/local/docker-compose.postgres.yml",
	"up",
	"-d",
	"--wait",
]);
run(pnpm, [
	"--dir",
	"apps/app-api",
	"exec",
	"tsx",
	"./scripts/run-with-local-env.ts",
	pnpm,
	"exec",
	"tsx",
	"./ops/db/prepare-local.ts",
]);
const diningDatabaseEnv = {
	PGDATABASE: process.env.LOCAL_POSTGRES_DB?.trim() || "campus_agent",
	PGHOST: "127.0.0.1",
	PGPASSWORD: process.env.LOCAL_POSTGRES_PASSWORD?.trim() || "postgres",
	PGPORT: process.env.LOCAL_POSTGRES_PORT?.trim() || "5432",
	PGSSLMODE: "disable",
	PGUSER: process.env.LOCAL_POSTGRES_USER?.trim() || "postgres",
};
run(pnpm, ["--dir", "jobs/dining-sync", "exec", "tsx", "src/cli.ts", "migrate"], diningDatabaseEnv);
run(
	pnpm,
	["--dir", "jobs/dining-sync", "exec", "tsx", "src/cli.ts", "import-dev-seed"],
	diningDatabaseEnv,
);

function commandSucceeds(command: string, args: string[]): boolean {
	return spawnSync(command, args, { cwd: repoRoot, stdio: "ignore" }).status === 0;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}): void {
	const result = spawnSync(command, args, {
		cwd: repoRoot,
		env: { ...process.env, ...env },
		stdio: "inherit",
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}
