import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { parseEnv } from "node:util";

import { localApplicationBootstrapCommands } from "./application-bootstrap";
import {
	MANAGED_LOCAL_ENV_MARKER,
	managedLocalEnvironmentPaths,
	removeLocalEnvironmentFiles,
	renderLocalEnvironmentFiles,
} from "./environment";
import {
	assertDestroyConfirmation,
	classifyIsolatedResourceState,
	classifyLocalDevInstanceStatus,
	resolveIsolatedResourceAction,
} from "./instance-resources";
import * as lifecycle from "./lifecycle";
import {
	allocateLocalDevSlot,
	calculateLocalDevPorts,
	ensureLocalDevProfile,
	isMainWorktree,
	type LocalDevProfileV1,
	listLocalDevProfiles,
	normalizeResourceLabel,
} from "./profile";
import {
	classifySharedInfrastructureStatus,
	derivedBucketPublicReadPolicy,
	objectStoreCommand,
	resolveSharedInfrastructureAction,
	sharedComposeUpCommand,
} from "./shared-infrastructure";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const path of temporaryDirectories.splice(0)) {
		rmSync(path, { force: true, recursive: true });
	}
});

describe("local development profiles", () => {
	it("derives stable non-overlapping service ports from a slot", () => {
		assert.deepEqual(calculateLocalDevPorts(0), {
			appApi: 27_031,
			campusWeb: 27_014,
			opsWeb: 5_178,
			opsWebApi: 5_179,
		});
		assert.deepEqual(calculateLocalDevPorts(2), {
			appApi: 27_231,
			campusWeb: 27_214,
			opsWeb: 5_198,
			opsWebApi: 5_199,
		});
	});

	it("normalizes resource labels and allocates the first available slot", () => {
		assert.equal(
			normalizeResourceLabel("Dining Production_Readiness"),
			"dining-production-readiness",
		);
		assert.equal(allocateLocalDevSlot([{ slot: 1 }, { slot: 3 }], 1), 2);
		assert.equal(allocateLocalDevSlot([], 0), 0);
	});

	it("registers main and linked worktrees with isolated resource identities", () => {
		const repository = mkdtempSync(resolve(tmpdir(), "campus-agent-profile-test-"));
		temporaryDirectories.push(repository);
		writeFileSync(resolve(repository, "README.md"), "test\n");
		execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repository });
		execFileSync("git", ["add", "README.md"], { cwd: repository });
		execFileSync(
			"git",
			[
				"-c",
				"user.name=Local Dev Test",
				"-c",
				"user.email=local-dev@example.invalid",
				"commit",
				"-qm",
				"test",
			],
			{ cwd: repository },
		);
		const linked = resolve(repository, "linked");
		execFileSync("git", ["worktree", "add", "-qb", "linked-test", linked], { cwd: repository });
		const stateDirectory = resolve(repository, "state");
		const previousStateHome = process.env.XDG_STATE_HOME;
		process.env.XDG_STATE_HOME = stateDirectory;
		try {
			const main = ensureLocalDevProfile(repository);
			const worktree = ensureLocalDevProfile(linked);
			assert.equal(isMainWorktree(repository), true);
			assert.equal(isMainWorktree(linked), false);
			assert.equal(main.slot, 0);
			assert.equal(worktree.slot, 1);
			assert.notEqual(main.databaseName, worktree.databaseName);
			assert.notEqual(main.bucketName, worktree.bucketName);
			assert.notDeepEqual(main.ports, worktree.ports);
			assert.equal(listLocalDevProfiles(repository).length, 2);
			rmSync(resolve(stateDirectory, "campus-agent", main.repoKey, "instances.v1.json"));
			assert.equal(ensureLocalDevProfile(repository).instanceId, main.instanceId);
			assert.equal(ensureLocalDevProfile(linked).instanceId, worktree.instanceId);
			assert.equal(listLocalDevProfiles(repository).length, 2);
		} finally {
			if (previousStateHome === undefined) {
				delete process.env.XDG_STATE_HOME;
			} else {
				process.env.XDG_STATE_HOME = previousStateHome;
			}
		}
	});
});

describe("managed worktree environment", () => {
	it("renders isolated endpoints and preserves generated secrets", () => {
		const repoRoot = createRepositoryShape();
		const profile = createProfile(repoRoot);
		renderLocalEnvironmentFiles({ profile, repoRoot });
		const secretPath = resolve(repoRoot, "apps/app-api/.dev.vars.local");
		const sourceCollectorPath = resolve(
			repoRoot,
			"apps/source-collector/adapters/internal-portal/.env.local",
		);
		const first = parseEnv(readFileSync(secretPath, "utf8"));
		writeFileSync(
			sourceCollectorPath,
			`${readFileSync(sourceCollectorPath, "utf8").trimEnd()}\nINTERNAL_PORTAL_SSO_TGC="TGT-local"\n`,
		);
		renderLocalEnvironmentFiles({ profile, repoRoot });
		const second = parseEnv(readFileSync(secretPath, "utf8"));

		assert.equal(first.BETTER_AUTH_SECRET, second.BETTER_AUTH_SECRET);
		assert.equal(first.OPS_WEB_INTERNAL_TOKEN, second.OPS_WEB_INTERNAL_TOKEN);
		assert.equal(second.AUTH_TURNSTILE_SECRET_KEY, "local-turnstile-disabled");
		assert.equal(second.AUTH_SHELL_ORIGIN, "http://127.0.0.1:27114");
		assert.equal(second.OBJECT_STORE_DERIVED_READ_ACCESS_KEY, "minioadmin");
		assert.equal(second.OBJECT_STORE_DERIVED_READ_SECRET_KEY, "minioadmin");
		assert.equal(
			second.OBJECT_STORE_LOCAL_BASE_URL,
			"http://127.0.0.1:9000/campus-agent-derived-wt-1-deadbeef/",
		);
		assert.match(
			readFileSync(resolve(repoRoot, "apps/ops-web/.env.local"), "utf8"),
			/OPS_WEB_DATABASE_URL=.*campus_agent_wt_1_deadbeef/u,
		);
		const appApiEnvironment = parseEnv(
			readFileSync(resolve(repoRoot, "apps/app-api/.env.local"), "utf8"),
		);
		const opsWebEnvironment = parseEnv(
			readFileSync(resolve(repoRoot, "apps/ops-web/.env.local"), "utf8"),
		);
		const ingestionControlEnvironment = parseEnv(
			readFileSync(resolve(repoRoot, "apps/ingestion-control/.env.local"), "utf8"),
		);
		const campusWebEnvironment = parseEnv(
			readFileSync(resolve(repoRoot, "apps/campus-web/.dev.vars.local"), "utf8"),
		);
		const sourceCollectorEnvironment = parseEnv(
			readFileSync(
				resolve(repoRoot, "apps/source-collector/adapters/internal-portal/.env.local"),
				"utf8",
			),
		);
		const noticePublisherEnvironment = parseEnv(
			readFileSync(resolve(repoRoot, "jobs/notice-publisher/.env.local"), "utf8"),
		);
		const noticeClassifierEnvironment = parseEnv(
			readFileSync(resolve(repoRoot, "jobs/notice-classifier/.env.local"), "utf8"),
		);
		assert.equal(new URL(appApiEnvironment.APP_API_SCHEMA_DATABASE_URL ?? "").search, "");
		assert.equal(campusWebEnvironment.AUTH_TURNSTILE_SITE_KEY, "");
		assert.equal(campusWebEnvironment.OBJECT_STORE_ENDPOINT, "http://127.0.0.1:9000");
		assert.equal(campusWebEnvironment.OBJECT_STORE_DERIVED_READ_ACCESS_KEY, "minioadmin");
		assert.equal(campusWebEnvironment.OBJECT_STORE_DERIVED_READ_SECRET_KEY, "minioadmin");
		assert.equal(campusWebEnvironment.OBJECT_STORE_DERIVED_ACCESS_KEY, undefined);
		assert.equal(campusWebEnvironment.OBJECT_STORE_DERIVED_SECRET_KEY, undefined);
		assert.equal(new URL(opsWebEnvironment.OPS_WEB_DATABASE_URL ?? "").search, "");
		assert.equal(
			new URL(ingestionControlEnvironment.INGESTION_CONTROL_DATABASE_URL ?? "").username,
			"ingestion_control",
		);
		assert.equal(ingestionControlEnvironment.OBJECT_STORE_BUCKET_SOURCE, undefined);
		assert.equal(sourceCollectorEnvironment.OBJECT_STORE_BUCKET_SOURCE, "campus-agent-source");
		assert.equal(sourceCollectorEnvironment.OBJECT_STORE_ENDPOINT, "http://127.0.0.1:9000");
		assert.equal(sourceCollectorEnvironment.OBJECT_STORE_SOURCE_ACCESS_KEY, "minioadmin");
		assert.equal(sourceCollectorEnvironment.INTERNAL_PORTAL_SSO_TGC, "TGT-local");
		assert.equal(
			noticeClassifierEnvironment.OBJECT_STORE_BUCKET_DERIVED,
			"campus-agent-derived-wt-1-deadbeef",
		);
		assert.equal(noticeClassifierEnvironment.OBJECT_STORE_BUCKET_SOURCE, "campus-agent-source");
		assert.equal(noticeClassifierEnvironment.OBJECT_STORE_ENDPOINT, "http://127.0.0.1:9000");
		assert.equal(noticeClassifierEnvironment.OBJECT_STORE_REGION, "us-east-1");
		assert.equal(noticeClassifierEnvironment.OBJECT_STORE_SOURCE_ACCESS_KEY, "minioadmin");
		assert.equal(noticeClassifierEnvironment.OBJECT_STORE_DERIVED_ACCESS_KEY, "minioadmin");
		assert.equal(noticeClassifierEnvironment.INTERNAL_NOTICE_CLASSIFIER_OPENAI_API_KEY, undefined);
		assert.equal(noticePublisherEnvironment.OBJECT_STORE_SOURCE_ACCESS_KEY, "minioadmin");
		assert.equal(noticePublisherEnvironment.OBJECT_STORE_SOURCE_SECRET_KEY, "minioadmin");
		assert.equal(noticePublisherEnvironment.OBJECT_STORE_DERIVED_ACCESS_KEY, "minioadmin");
		assert.equal(noticePublisherEnvironment.OBJECT_STORE_DERIVED_SECRET_KEY, "minioadmin");
		assert.equal(noticePublisherEnvironment.OBJECT_STORE_ACCESS_KEY, undefined);
		assert.equal(noticePublisherEnvironment.OBJECT_STORE_SECRET_KEY, undefined);
		assert.equal(opsWebEnvironment.OPS_WEB_APP_API_URL, "http://127.0.0.1:27131");
		assert.equal(opsWebEnvironment.OPS_WEB_CAMPUS_WEB_URL, "http://127.0.0.1:27114");
		assert.equal(opsWebEnvironment.OPS_WEB_INTERNAL_TOKEN, second.OPS_WEB_INTERNAL_TOKEN);
		assert.equal(
			opsWebEnvironment.OPS_WEB_AUTOMATION_ORIGIN,
			`http://127.0.0.1:${profile.ports.opsWebApi}`,
		);
	});

	it("refuses to overwrite a developer-owned application environment file", () => {
		const repoRoot = createRepositoryShape();
		writeFileSync(resolve(repoRoot, "apps/ops-web/.env.local"), "USER_OWNED=1\n");
		assert.throws(
			() => renderLocalEnvironmentFiles({ profile: createProfile(repoRoot), repoRoot }),
			/Refusing to overwrite unmanaged local environment file/u,
		);
	});

	it("does not remove managed files when one target file is developer-owned", () => {
		const repoRoot = createRepositoryShape();
		renderLocalEnvironmentFiles({ profile: createProfile(repoRoot), repoRoot });
		const firstManagedPath = resolve(repoRoot, "apps/app-api/.env.local");
		writeFileSync(resolve(repoRoot, "apps/ops-web/.env.local"), "USER_OWNED=1\n");
		assert.throws(
			() => removeLocalEnvironmentFiles(repoRoot),
			/Refusing to overwrite unmanaged local environment file/u,
		);
		assert.ok(readFileSync(firstManagedPath, "utf8").startsWith(MANAGED_LOCAL_ENV_MARKER));
	});

	it("marks every generated file as lifecycle-managed", () => {
		const repoRoot = createRepositoryShape();
		const rendered = renderLocalEnvironmentFiles({
			profile: createProfile(repoRoot),
			repoRoot,
		});
		assert.deepEqual(rendered.sort(), Object.values(managedLocalEnvironmentPaths(repoRoot)).sort());
		for (const path of rendered) {
			assert.ok(readFileSync(path, "utf8").startsWith(MANAGED_LOCAL_ENV_MARKER));
		}
	});
});

describe("local development lifecycle guards", () => {
	it("keeps the lifecycle facade limited to init, diagnosis, and destruction", () => {
		assert.deepEqual(Object.keys(lifecycle).sort(), [
			"destroyLocalDevelopment",
			"diagnoseLocalDevelopment",
			"initializeLocalDevelopment",
		]);
	});

	it("only exposes immutable Dining floorplans from the derived bucket", () => {
		assert.deepEqual(
			JSON.parse(derivedBucketPublicReadPolicy("campus-agent-derived-wt-1-deadbeef")),
			{
				Statement: [
					{
						Action: ["s3:GetObject"],
						Effect: "Allow",
						Principal: { AWS: ["*"] },
						Resource: ["arn:aws:s3:::campus-agent-derived-wt-1-deadbeef/dining/floorplans/*"],
					},
				],
				Version: "2012-10-17",
			},
		);
		assert.throws(() => derivedBucketPublicReadPolicy("invalid/bucket"));
	});

	it("classifies only matching database and bucket state as complete", () => {
		assert.equal(
			classifyIsolatedResourceState({ bucketExists: false, databaseExists: false }),
			"absent",
		);
		assert.equal(
			classifyIsolatedResourceState({ bucketExists: true, databaseExists: true }),
			"complete",
		);
		assert.equal(
			classifyIsolatedResourceState({ bucketExists: false, databaseExists: true }),
			"partial",
		);
	});

	it("repairs a missing bucket without recreating its database", () => {
		assert.equal(
			resolveIsolatedResourceAction({ bucketExists: false, databaseExists: false }),
			"create",
		);
		assert.equal(
			resolveIsolatedResourceAction({ bucketExists: false, databaseExists: true }),
			"repair-bucket",
		);
		assert.equal(
			resolveIsolatedResourceAction({ bucketExists: true, databaseExists: true }),
			"ready",
		);
		assert.throws(
			() => resolveIsolatedResourceAction({ bucketExists: true, databaseExists: false }),
			/database is missing/u,
		);
	});

	it("reuses ready shared infrastructure and only lets main reconcile it", () => {
		assert.equal(
			resolveSharedInfrastructureAction({ isMainWorktree: true, status: "ready" }),
			"reuse",
		);
		assert.equal(
			resolveSharedInfrastructureAction({ isMainWorktree: false, status: "ready" }),
			"reuse",
		);
		assert.equal(
			resolveSharedInfrastructureAction({ isMainWorktree: true, status: "missing" }),
			"reconcile",
		);
		assert.equal(
			resolveSharedInfrastructureAction({ isMainWorktree: false, status: "missing" }),
			"reject",
		);
		assert.equal(
			resolveSharedInfrastructureAction({ isMainWorktree: true, status: "unhealthy" }),
			"reconcile",
		);
		assert.equal(
			resolveSharedInfrastructureAction({ isMainWorktree: false, status: "drifted" }),
			"reject",
		);
		assert.equal(
			resolveSharedInfrastructureAction({ isMainWorktree: true, status: "unknown" }),
			"reject",
		);
		assert.deepEqual(sharedComposeUpCommand().slice(-3), ["up", "-d", "--wait"]);
		assert.doesNotMatch(sharedComposeUpCommand().join(" "), /remove-orphans/u);
	});

	it("requires healthy containers, matching Compose labels and hashes", () => {
		const healthy = createSharedStatusInput();
		assert.equal(classifySharedInfrastructureStatus(healthy), "ready");
		assert.equal(
			classifySharedInfrastructureStatus({
				...healthy,
				containers: {
					...healthy.containers,
					postgres: { ...healthy.containers.postgres, healthy: false },
				},
			}),
			"unhealthy",
		);
		assert.equal(
			classifySharedInfrastructureStatus({
				...healthy,
				containers: {
					...healthy.containers,
					objectStore: { ...healthy.containers.objectStore, configHash: "changed" },
				},
			}),
			"drifted",
		);
		assert.equal(
			classifySharedInfrastructureStatus({
				...healthy,
				containers: {
					...healthy.containers,
					postgres: { ...healthy.containers.postgres, service: undefined },
				},
			}),
			"drifted",
		);
		assert.equal(
			classifySharedInfrastructureStatus({
				...healthy,
				containers: {
					...healthy.containers,
					postgres: { ...healthy.containers.postgres, probe: "unknown" },
				},
			}),
			"unknown",
		);
		assert.equal(
			classifySharedInfrastructureStatus({
				...healthy,
				containers: {
					...healthy.containers,
					postgres: { ...healthy.containers.postgres, probe: "missing" },
				},
			}),
			"missing",
		);
		assert.equal(
			classifySharedInfrastructureStatus({
				...healthy,
				buckets: { docs: "missing", source: "present" },
			}),
			"missing",
		);
	});

	it("classifies instance records without hiding stale or partial resources", () => {
		assert.equal(
			classifyLocalDevInstanceStatus({
				bucket: "present",
				database: "present",
				worktree: "present",
			}),
			"ready",
		);
		assert.equal(
			classifyLocalDevInstanceStatus({
				bucket: "present",
				database: "present",
				worktree: "missing",
			}),
			"stale",
		);
		assert.equal(
			classifyLocalDevInstanceStatus({
				bucket: "present",
				database: "missing",
				worktree: "present",
			}),
			"partial",
		);
		assert.equal(
			classifyLocalDevInstanceStatus({
				bucket: "missing",
				database: "missing",
				worktree: "present",
			}),
			"unprovisioned",
		);
		assert.equal(
			classifyLocalDevInstanceStatus({
				bucket: "unknown",
				database: "unknown",
				worktree: "missing",
			}),
			"unknown",
		);
	});

	it("checks bucket existence with the rc bucket listing operation", () => {
		const command = objectStoreCommand("campus-agent-source", "inspect");
		assert.match(command.at(-1) ?? "", /rc ls "local\/\$BUCKET"/u);
		assert.doesNotMatch(command.at(-1) ?? "", /rc stat/u);
	});

	it("requires exact instance confirmation before destruction", () => {
		assert.doesNotThrow(() => assertDestroyConfirmation("dining-a1b2", "dining-a1b2"));
		assert.throws(() => assertDestroyConfirmation("dining-a1b2", "dining-other"));
	});

	it("keeps the app-api local loader outside the root environment", () => {
		const source = readFileSync(
			resolve(import.meta.dirname, "../../apps/app-api/scripts/run-with-local-env.ts"),
			"utf8",
		);
		assert.doesNotMatch(source, /repoEnvPath|resolve\(repoRoot, "\.env"\)/u);
		assert.match(source, /\.env\.local/u);
		assert.match(source, /\.dev\.vars\.local/u);
	});

	it("runs application bootstrap in explicit dependency order", () => {
		const commands = localApplicationBootstrapCommands("/repo", createProfile("/repo"));
		assert.deepEqual(
			commands.map(({ step }) => step),
			[
				"campus-web-docs",
				"app-api-schema",
				"app-api-seed-local-test-user",
				"ops-web-dining-schema",
				"ops-web-dining-bootstrap",
				"ingestion-control-schema",
				"ingestion-control-migrate",
				"notice-publisher-migrate",
			],
		);
		assert.deepEqual(commands[5]?.args, ["--dir", "apps/ingestion-control", "schema:bootstrap"]);
		assert.deepEqual(commands[6]?.args, ["--dir", "apps/ingestion-control", "migrate"]);
	});

	it("keeps the source collector local loader inside its adapter", () => {
		const source = readFileSync(
			resolve(
				import.meta.dirname,
				"../../apps/source-collector/adapters/internal-portal/src/config.ts",
			),
			"utf8",
		);
		assert.doesNotMatch(source, /repoRoot/u);
		assert.match(source, /path\.join\(adapterRoot, "\.env\.local"\)/u);
		assert.match(source, /path\.join\(adapterRoot, "\.env"\)/u);
	});
});

function createRepositoryShape(): string {
	const repoRoot = mkdtempSync(resolve(tmpdir(), "campus-agent-dev-test-"));
	temporaryDirectories.push(repoRoot);
	for (const app of ["app-api", "campus-web", "ingestion-control", "ops-web"]) {
		mkdirSync(resolve(repoRoot, "apps", app), { recursive: true });
	}
	mkdirSync(resolve(repoRoot, "apps/source-collector/adapters/internal-portal"), {
		recursive: true,
	});
	for (const job of ["notice-classifier", "notice-publisher"]) {
		mkdirSync(resolve(repoRoot, "jobs", job), { recursive: true });
	}
	return repoRoot;
}

function createProfile(worktreePath: string): LocalDevProfileV1 {
	return {
		bucketName: "campus-agent-derived-wt-1-deadbeef",
		createdAt: "2026-07-20T00:00:00.000Z",
		databaseName: "campus_agent_wt_1_deadbeef",
		instanceId: "dining-production-deadbeef",
		ports: calculateLocalDevPorts(1),
		repoKey: "repo-key",
		schemaVersion: 1,
		slot: 1,
		worktreePath,
	};
}

function createSharedStatusInput(): Parameters<typeof classifySharedInfrastructureStatus>[0] {
	const container = {
		configHash: "hash",
		healthy: true,
		probe: "present" as const,
		project: "campus-agent-local",
		running: true,
		service: "postgres",
	};
	return {
		buckets: { docs: "present", source: "present" },
		containers: {
			objectStore: { ...container, service: "object-store" },
			postgres: container,
		},
		expectedHashes: { objectStore: "hash", postgres: "hash" },
		network: "present",
		volumes: { objectStore: "present", postgres: "present" },
	};
}
