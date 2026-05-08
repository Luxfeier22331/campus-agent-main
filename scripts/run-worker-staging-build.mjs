import { spawn } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const PLACEHOLDER_PREFIX = "__campus_agent_runtime_secret_placeholder__";

function fail(message) {
	console.error(message);
	process.exit(1);
}

function parseArgs(argv) {
	const separatorIndex = argv.indexOf("--");
	if (separatorIndex < 0) {
		fail(
			"Usage: node ../../scripts/run-worker-staging-build.mjs <runtime-secret>... -- <command> [args...]",
		);
	}
	const requiredRuntimeSecrets = argv.slice(0, separatorIndex);
	const command = argv[separatorIndex + 1];
	const args = argv.slice(separatorIndex + 2);
	if (!command) {
		fail("staging build command is required after --.");
	}
	return { args, command, requiredRuntimeSecrets };
}

function buildEnv(requiredRuntimeSecrets) {
	const env = {
		...process.env,
		CLOUDFLARE_ENV: "staging",
		WRANGLER_DISABLE_EXPERIMENTAL_WARNING: "1",
		XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME?.trim() || "./.wrangler-home",
	};
	for (const name of requiredRuntimeSecrets) {
		if (!/^[A-Z0-9_]+$/.test(name)) {
			fail(`invalid runtime secret env name: ${name}`);
		}
		if (!env[name]?.trim()) {
			env[name] = `${PLACEHOLDER_PREFIX}${name}`;
		}
	}
	return env;
}

function assertNoPlaceholderLeak(root) {
	const distRoot = resolve(root, "dist");
	try {
		statSync(distRoot);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return;
		}
		throw error;
	}

	const stack = [distRoot];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}
		for (const entry of readdirSync(current)) {
			const path = join(current, entry);
			const stat = statSync(path);
			if (stat.isDirectory()) {
				stack.push(path);
				continue;
			}
			if (!stat.isFile() || stat.size > 5_000_000) {
				continue;
			}
			if (readFileSync(path, "utf8").includes(PLACEHOLDER_PREFIX)) {
				fail(`runtime secret placeholder leaked into build artifact: ${path}`);
			}
		}
	}
}

function removeGeneratedDevVarsFiles(root) {
	const distRoot = resolve(root, "dist");
	try {
		statSync(distRoot);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return;
		}
		throw error;
	}

	const stack = [distRoot];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}
		for (const entry of readdirSync(current)) {
			const path = join(current, entry);
			const stat = statSync(path);
			if (stat.isDirectory()) {
				stack.push(path);
				continue;
			}
			if (stat.isFile() && entry === ".dev.vars") {
				rmSync(path, { force: true });
			}
		}
	}
}

const { args, command, requiredRuntimeSecrets } = parseArgs(process.argv.slice(2));
const child = spawn(command, args, {
	cwd: process.cwd(),
	env: buildEnv(requiredRuntimeSecrets),
	shell: process.platform === "win32",
	stdio: "inherit",
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	if ((code ?? 1) !== 0) {
		process.exit(code ?? 1);
	}
	removeGeneratedDevVarsFiles(process.cwd());
	assertNoPlaceholderLeak(process.cwd());
});

child.on("error", (error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
