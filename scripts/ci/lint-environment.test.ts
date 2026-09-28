import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

const root = path.resolve(import.meta.dirname, "../..");
const config = parse(readFileSync(path.join(root, ".config/.pre-commit-config.yaml"), "utf8"));
const hooks = config.repos.flatMap((repo: { hooks: Hook[] }) => repo.hooks) as Hook[];
interface Hook {
	id: string;
	entry: string;
	exclude?: string;
}

test("Nix hooks reuse prepared environments and preserve the local flake command and filenames", (t) => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "lint-environment-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const selected = [
		["ruff-check", "ci-light", "uv", ["run", "--no-sync", "ruff", "check"]],
		["ruff-format", "ci-light", "uv", ["run", "--no-sync", "ruff", "format", "--check"]],
		["sqlfluff", "ci-light", "uv", ["run", "--no-sync", "sqlfluff", "lint"]],
		["yamllint", "ci-light", "uv", ["run", "--no-sync", "yamllint", "-c", ".config/.yamllint.yml"]],
		["shellcheck", "ci-light", "shellcheck", ["-x", "-s", "bash"]],
		["go-format", "ci-format", "golangci-lint", ["fmt", "--diff"]],
		["staged-secrets", "ci-light", "gitleaks", ["git", "--pre-commit", "--redact", "--staged"]],
	] as const;
	for (const tool of new Set(["nix", ...selected.map(([, , command]) => command)])) {
		writeFileSync(
			path.join(directory, tool),
			`#!${process.execPath}
console.log(JSON.stringify({tool: ${JSON.stringify(tool)}, args: process.argv.slice(2)}));
`,
			{ mode: 0o755 },
		);
	}
	const environment = path.join(directory, "prepared environment.sh");
	writeFileSync(environment, `export PATH='${directory}':"$PATH"\n`);
	const env = { ...process.env };
	delete env.CI_NIX_LIGHT_ENV;
	delete env.CI_NIX_FORMAT_ENV;
	const filenames = ["space name.sql", "literal$(value).sql", "quote'name.sql"];
	for (const [id, shell, command, args] of selected) {
		const hook = hooks.find((hook) => hook.id === id);
		assert(hook);
		const variable = shell === "ci-light" ? "CI_NIX_LIGHT_ENV" : "CI_NIX_FORMAT_ENV";
		const invoke = (context: NodeJS.ProcessEnv) =>
			JSON.parse(
				execFileSync("bash", ["-c", `${hook.entry} "$@"`, "--", ...filenames], {
					cwd: root,
					env: context,
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
				}),
			);
		assert.deepEqual(invoke({ ...env, PATH: `${directory}:${env.PATH}` }), {
			tool: "nix",
			args: [
				"develop",
				`.#${shell}`,
				"--command",
				command,
				...(command === "uv" ? ["run", "--locked", "--only-dev", ...args.slice(2)] : args),
				...filenames,
			],
		});
		assert.deepEqual(invoke({ ...env, [variable]: environment }), {
			tool: command,
			args: [...args, ...filenames],
		});
		assert.throws(() => invoke({ ...env, [variable]: path.join(directory, "missing.sh") }));
	}
});

test("CI prepares Nix environments before exposing them to hooks and repository checks", (t) => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "lint-prepare-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const workflow = parse(readFileSync(path.join(root, ".github/workflows/pr.yml"), "utf8"));
	const prepare = workflow.jobs["repository-validation"].steps.find(
		(step: { name: string }) => step.name === "Install static-check dependencies",
	);
	assert.equal(prepare.shell, "bash -e {0}");
	writeFileSync(
		path.join(directory, "nix"),
		`#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
if (args[0] !== 'print-dev-env') process.exit(9);
if (args[1] === process.env.FAIL_ENV) process.exit(17);
console.log('export PATH=' + JSON.stringify(process.env.FAKE_BIN) + ':"$PATH"');
`,
		{ mode: 0o755 },
	);
	writeFileSync(
		path.join(directory, "uv"),
		`#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.CALLS, JSON.stringify(['uv', ...process.argv.slice(2)]) + '\\n');
if (process.env.FAIL_ENV === 'uv') process.exit(18);
`,
		{ mode: 0o755 },
	);
	for (const fail of ["", ".#ci-light", ".#ci-format", ".#ci-go", "uv"]) {
		const calls = path.join(directory, "calls.jsonl");
		const githubEnv = path.join(directory, "github-env");
		writeFileSync(calls, "");
		writeFileSync(githubEnv, "");
		const invoke = () =>
			execFileSync("bash", ["-e", "-c", prepare.run], {
				cwd: root,
				env: {
					...process.env,
					PATH: `${directory}:${process.env.PATH}`,
					RUNNER_TEMP: directory,
					GITHUB_ENV: githubEnv,
					CALLS: calls,
					FAKE_BIN: directory,
					FAIL_ENV: fail,
				},
				stdio: ["ignore", "pipe", "pipe"],
			});
		if (fail) {
			assert.throws(invoke);
			assert.equal(readFileSync(githubEnv, "utf8"), "");
		} else {
			invoke();
			assert.deepEqual(
				readFileSync(calls, "utf8")
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line)),
				[
					["print-dev-env", ".#ci-light"],
					["print-dev-env", ".#ci-format"],
					["print-dev-env", ".#ci-go"],
					["uv", "sync", "--only-dev", "--no-install-workspace"],
				],
			);
			assert.equal(
				readFileSync(githubEnv, "utf8"),
				`CI_NIX_LIGHT_ENV=${directory}/ci-nix-light.sh\nCI_NIX_FORMAT_ENV=${directory}/ci-nix-format.sh\nCI_NIX_GO_ENV=${directory}/ci-nix-go.sh\n`,
			);
		}
	}
});

test("CI contracts step and registry use the Go environment while lint stays file-based", () => {
	const workflow = parse(readFileSync(path.join(root, ".github/workflows/pr.yml"), "utf8"));
	const step = workflow.jobs["repository-validation"].steps.find(
		(item: { id: string }) => item.id === "contracts",
	);
	assert.equal(step.shell, undefined);
	assert.match(step.run, /evidence\.mts --check contracts/u);
	const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
	assert.equal(
		manifest.scripts.lint,
		"pnpm exec prek run --config .config/.pre-commit-config.yaml --all-files --stage pre-commit --skip staged-secrets --no-group validation",
	);
	const biome = hooks.find((hook) => hook.id === "biome");
	assert(biome);
	assert.equal(
		biome.entry,
		"pnpm --config.verify-deps-before-run=false exec biome check --no-errors-on-unmatched",
	);
});

test("SQL hook relies on .sqlfluffignore while handwritten migrations remain selected", () => {
	const sql = hooks.find((hook) => hook.id === "sqlfluff");
	assert(sql);
	assert.equal(sql.exclude, undefined);
	const ignored = readFileSync(path.join(root, ".sqlfluffignore"), "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
	assert.deepEqual(ignored, [
		"jobs/campus-agent-schema/migrations/20260827151741_0000_campus_agent_baseline/migration.sql",
		"jobs/campus-agent-schema/migrations/20260914000000_0016_dining_submissions/migration.sql",
	]);
	const files = execFileSync("git", ["ls-files", "*.sql"], { cwd: root, encoding: "utf8" })
		.trim()
		.split("\n");
	assert(
		files.includes(
			"jobs/campus-agent-schema/migrations/20260830104000_0001_model_config_optional_validation/migration.sql",
		),
	);
});
