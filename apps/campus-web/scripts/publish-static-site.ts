/**
 * Publish the built Campus Web client to the GitHub Pages user site.
 *
 * The site must be served from the Pages *root* (the `Luxfeier22331.github.io`
 * repository) because the app requests its assets from absolute paths such as
 * `/assets/…` and `/campus-map/…`. Publishing to a project sub-path would 404
 * every one of them.
 *
 * Usage:
 *   tsx scripts/publish-static-site.ts --repo <owner/owner.github.io> [--dry-run]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(APP_ROOT, "../..");
const CLIENT_ROOT = resolve(APP_ROOT, "dist/client");

interface PublishArgs {
	dryRun: boolean;
	repo: string;
}

export function parsePublishArgs(argv: string[]): PublishArgs {
	let repo: string | undefined;
	let dryRun = false;
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (token === "--repo") {
			repo = argv[index + 1];
			index += 1;
			continue;
		}
		throw new Error(`unknown publish argument: ${token}`);
	}
	const normalized = repo?.trim();
	if (!(normalized && /^[\w.-]+\/[\w.-]+$/u.test(normalized))) {
		throw new Error("Usage: publish-static-site.ts --repo <owner/repository> [--dry-run]");
	}
	return { dryRun, repo: normalized };
}

export function publishStaticSite(input: PublishArgs): { commit: string; fileCount: number } {
	const indexPath = resolve(CLIENT_ROOT, "index.html");
	if (!existsSync(indexPath)) {
		throw new Error(`Static site output is missing: ${indexPath}. Run the build first.`);
	}
	const indexHtml = readFileSync(indexPath, "utf8");
	if (!indexHtml.includes("__CAMPUS_RUNTIME_CONFIG__")) {
		throw new Error(
			"Static site output has no injected runtime config. Run prepare-static-site.ts first.",
		);
	}

	// Build the tree in a scratch index so the working tree and its branch stay
	// untouched; only the generated files are ever committed.
	const temporaryIndex = resolve(REPO_ROOT, "var/dev/publish-index");
	writeFileSync(temporaryIndex, "", "utf8");
	const git = (args: string[], allowFailure = false) => {
		const result = spawnSync("git", args, {
			cwd: REPO_ROOT,
			encoding: "utf8",
			env: { ...process.env, GIT_INDEX_FILE: temporaryIndex },
		});
		if (result.error) {
			throw result.error;
		}
		if (!allowFailure && result.status !== 0) {
			throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
		}
		return result.stdout.trim();
	};

	git(["--work-tree", CLIENT_ROOT, "read-tree", "--empty"]);
	git(["--work-tree", CLIENT_ROOT, "add", "-A", "-f", "--", "."]);
	const tree = git(["write-tree"]);
	const mainSha = git(["rev-parse", "--short", "main"]);
	const message = [
		"chore: publish Campus Web static preview",
		"",
		`Generated from campus-agent-main main at ${mainSha} with vite build plus`,
		"apps/campus-web/scripts/prepare-static-site.ts.",
	].join("\n");
	const commit = spawnSync("git", ["commit-tree", tree, "-m", message], {
		cwd: REPO_ROOT,
		encoding: "utf8",
		env: { ...process.env, GIT_INDEX_FILE: temporaryIndex },
	});
	if (commit.status !== 0) {
		throw new Error(`git commit-tree failed: ${commit.stderr.trim()}`);
	}
	const commitSha = commit.stdout.trim();
	const fileCount = Number(git(["ls-tree", "-r", "--name-only", commitSha]).split("\n").length);

	if (!input.dryRun) {
		// Publish with a lease against the branch tip we read, so a concurrent
		// publish is rejected instead of silently overwritten.
		const remoteUrl = `https://github.com/${input.repo}.git`;
		const remoteHead = spawnSync("git", ["ls-remote", remoteUrl, "refs/heads/main"], {
			cwd: REPO_ROOT,
			encoding: "utf8",
		});
		const remoteSha = remoteHead.stdout.trim().split(/\s+/u)[0];
		const forceFlag = remoteSha ? `--force-with-lease=refs/heads/main:${remoteSha}` : "--force";
		const push = spawnSync("git", ["push", forceFlag, remoteUrl, `${commitSha}:refs/heads/main`], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			stdio: "inherit",
		});
		if (push.status !== 0) {
			throw new Error("git push failed.");
		}
	}

	return { commit: commitSha, fileCount };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const result = publishStaticSite(parsePublishArgs(process.argv.slice(2)));
	console.log(JSON.stringify(result));
}
