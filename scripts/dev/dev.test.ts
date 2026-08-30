import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { parseEnv } from "node:util";

import { localApplicationBootstrapCommands } from "./application-bootstrap";
import {
	ensureLocalModelConfigEncryptionKey,
	importMainCheckoutExternalCredentials,
	localModelConfigCommandEnvironment,
	localModelConfigEnvironment,
	MANAGED_LOCAL_ENV_MARKER,
	managedLocalEnvironmentPaths,
	managedLocalEnvironmentPathsForProjections,
	removeLocalEnvironmentFiles,
	renderLocalEnvironmentFiles,
	resolveLocalModelConfigEncryptionKeyPath,
	resolveMainCheckoutRoot,
} from "./environment";
import {
	assertDestroyConfirmation,
	classifyIsolatedResourceState,
	classifyLocalDevInstanceStatus,
	diagnoseLocalDevInstances,
	resolveIsolatedResourceAction,
	resolveLocalInstanceResourceCleanup,
} from "./instance-resources";
import * as lifecycle from "./lifecycle";
import { captureCommandResult } from "./process";
import {
	allocateLocalDevSlot,
	calculateLocalDevPorts,
	calculateLocalDevRuntimePorts,
	ensureLocalDevProfile,
	isMainWorktree,
	type LocalDevProfileV2,
	listLocalDevProfiles,
	normalizeResourceLabel,
	releaseLocalDevProfile,
	resolveLegacyLocalDevProfilePath,
	resolveLocalDevProfilePath,
	resolveLocalDevRegistryPath,
} from "./profile";
import {
	classifySharedInfrastructureStatus,
	derivedBucketPublicReadPolicy,
	isSharedDataInfrastructureReady,
	objectStoreCommand,
	resolveSharedInfrastructureAction,
	sharedComposeUpCommand,
} from "./shared-infrastructure";
import { resolveLocalDevTargetPlan } from "./targets";

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
		assert.deepEqual(calculateLocalDevRuntimePorts(2), {
			agentRuntime: 27262,
			executionControl: 27251,
			modelConfig: 27253,
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

	it("registers main and linked worktrees with isolated resource identities", async () => {
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
			const main = await ensureLocalDevProfile(repository);
			const worktree = await ensureLocalDevProfile(linked);
			assert.equal(isMainWorktree(repository), true);
			assert.equal(isMainWorktree(linked), false);
			assert.equal(resolveMainCheckoutRoot(linked), realpathSync(repository));
			assert.equal(main.slot, 0);
			assert.ok(worktree.slot >= 1);
			assert.notEqual(main.databaseName, worktree.databaseName);
			assert.notEqual(main.bucketName, worktree.bucketName);
			assert.notDeepEqual(main.ports, worktree.ports);
			assert.equal(listLocalDevProfiles(repository).length, 2);
			assert.equal((await ensureLocalDevProfile(repository)).instanceId, main.instanceId);
			assert.equal((await ensureLocalDevProfile(linked)).instanceId, worktree.instanceId);
			assert.equal(listLocalDevProfiles(repository).length, 2);
		} finally {
			if (previousStateHome === undefined) {
				delete process.env.XDG_STATE_HOME;
			} else {
				process.env.XDG_STATE_HOME = previousStateHome;
			}
		}
	});

	it("adopts a v1 profile and registry into the canonical v2 files", async () => {
		const repository = createGitRepository();
		const stateDirectory = resolve(repository, "state");
		const previousStateHome = process.env.XDG_STATE_HOME;
		process.env.XDG_STATE_HOME = stateDirectory;
		try {
			const original = await ensureLocalDevProfile(repository);
			const currentProfilePath = resolveLocalDevProfilePath(repository);
			const currentRegistryPath = resolveLocalDevRegistryPath(repository);
			const legacyProfilePath = resolveLegacyLocalDevProfilePath(repository);
			const legacyRegistryPath = resolve(
				stateDirectory,
				"campus-agent",
				original.repoKey,
				"instances.v1.json",
			);
			const legacyProfile = {
				...JSON.parse(readFileSync(currentProfilePath, "utf8")),
				schemaVersion: 1,
			};
			const legacyRegistry = {
				instances: [legacyProfile],
				schemaVersion: 1,
			};
			rmSync(currentProfilePath);
			rmSync(currentRegistryPath);
			writeFileSync(legacyProfilePath, `${JSON.stringify(legacyProfile)}\n`);
			writeFileSync(legacyRegistryPath, `${JSON.stringify(legacyRegistry)}\n`);

			const adopted = await ensureLocalDevProfile(repository);
			assert.equal(adopted.schemaVersion, 2);
			assert.equal(adopted.resourceKey, original.resourceKey);
			assert.equal(adopted.databaseName, original.databaseName);
			assert.equal(existsSync(currentProfilePath), true);
			assert.equal(existsSync(currentRegistryPath), true);
			assert.equal(existsSync(legacyProfilePath), false);
			assert.equal(existsSync(legacyRegistryPath), false);
		} finally {
			if (previousStateHome === undefined) {
				delete process.env.XDG_STATE_HOME;
			} else {
				process.env.XDG_STATE_HOME = previousStateHome;
			}
		}
	});

	it("does not remove a replacement profile when releasing an older registration", async () => {
		const repository = createGitRepository();
		const stateDirectory = resolve(repository, "state");
		const previousStateHome = process.env.XDG_STATE_HOME;
		process.env.XDG_STATE_HOME = stateDirectory;
		try {
			const original = await ensureLocalDevProfile(repository);
			const replacement = {
				...original,
				bucketName: `campus-agent-derived-wt-${original.slot}-cafebabe`,
				databaseName: `campus_agent_wt_${original.slot}_cafebabe`,
				instanceId: "replacement-cafebabe",
				resourceKey: "cafebabe",
			};
			writeFileSync(resolveLocalDevProfilePath(repository), `${JSON.stringify(replacement)}\n`);

			releaseLocalDevProfile(repository, original.instanceId);

			assert.equal(existsSync(resolveLocalDevProfilePath(repository)), true);
			assert.equal(
				JSON.parse(readFileSync(resolveLocalDevProfilePath(repository), "utf8")).instanceId,
				"replacement-cafebabe",
			);
		} finally {
			if (previousStateHome === undefined) {
				delete process.env.XDG_STATE_HOME;
			} else {
				process.env.XDG_STATE_HOME = previousStateHome;
			}
		}
	});

	it("lists registered instances without probing mutable resources by default", async () => {
		const repository = createGitRepository();
		const previousStateHome = process.env.XDG_STATE_HOME;
		process.env.XDG_STATE_HOME = resolve(repository, "state");
		try {
			const profile = await ensureLocalDevProfile(repository);
			const [diagnosis] = await diagnoseLocalDevInstances(repository);
			assert.equal(diagnosis?.profile.instanceId, profile.instanceId);
			assert.equal(diagnosis?.status, "registered");
			assert.equal(diagnosis?.database, "unknown");
			assert.equal(diagnosis?.bucket, "unknown");
			assert.equal(diagnosis?.namespace, "unknown");
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
	it("imports only missing external credentials from the main checkout", () => {
		const mainCheckoutRoot = createRepositoryShape();
		const repoRoot = createRepositoryShape();
		writeFileSync(
			resolve(mainCheckoutRoot, ".env"),
			[
				"LLM_BASE_URL=https://provider.example/v1",
				"LLM_API_KEY=main-key",
				"EMBEDDING_API_KEY=embedding-key",
				"CAMPUS_SHARED_POSTGRES_URL=postgresql://must-not-copy",
				"SENTRY_API_TOKEN=must-not-copy",
				"",
			].join("\n"),
		);
		writeFileSync(
			resolve(repoRoot, ".env"),
			"LLM_API_KEY=worktree-key\nWORKTREE_ONLY=preserved\n",
			{ mode: 0o644 },
		);
		const mainPortalEnvironment = resolve(
			mainCheckoutRoot,
			"jobs/internal-portal-collection/adapters/internal-portal/.env.local",
		);
		writeFileSync(
			mainPortalEnvironment,
			`${MANAGED_LOCAL_ENV_MARKER}\nINTERNAL_PORTAL_SSO_TGC="TGT-main"\n`,
		);

		importMainCheckoutExternalCredentials({
			mainCheckoutRoot,
			projections: ["core", "internal-portal-collection"],
			repoRoot,
		});

		const imported = parseEnv(readFileSync(resolve(repoRoot, ".env"), "utf8"));
		assert.equal(imported.LLM_BASE_URL, "https://provider.example/v1");
		assert.equal(imported.LLM_API_KEY, "worktree-key");
		assert.equal(imported.EMBEDDING_API_KEY, "embedding-key");
		assert.equal(imported.WORKTREE_ONLY, "preserved");
		assert.equal(imported.CAMPUS_SHARED_POSTGRES_URL, undefined);
		assert.equal(imported.SENTRY_API_TOKEN, undefined);
		assert.equal(statSync(resolve(repoRoot, ".env")).mode & 0o777, 0o600);
		const portalEnvironment = parseEnv(
			readFileSync(
				resolve(repoRoot, "jobs/internal-portal-collection/adapters/internal-portal/.env.local"),
				"utf8",
			),
		);
		assert.equal(portalEnvironment.INTERNAL_PORTAL_SSO_TGC, "TGT-main");
	});

	it("uses process provider values before root env fallback and scopes command input", () => {
		const repoRoot = createRepositoryShape();
		writeFileSync(
			resolve(repoRoot, ".env"),
			[
				"LLM_BASE_URL=https://primary.example/v1",
				"LLM_API_KEY=primary-key",
				"LLM_MODEL=primary-model",
				"NOTICE_CLASSIFICATION_BASE_URL=https://notice.example/v1",
				"NOTICE_CLASSIFICATION_API_KEY=notice-key",
				"NOTICE_CLASSIFICATION_MODEL=deepseek-v4-flash-0731",
				"RERANK_API_KEY=must-not-reach-classifier",
				"",
			].join("\n"),
		);
		const environment = localModelConfigEnvironment({
			environment: {
				NOTICE_CLASSIFICATION_API_KEY: "process-notice-key",
				RERANK_API_KEY: "process-rerank-key",
			},
			names: ["notice_classification"],
			repoRoot,
		});
		assert.deepEqual(environment, {
			NOTICE_CLASSIFICATION_BASE_URL: "https://notice.example/v1",
			NOTICE_CLASSIFICATION_API_KEY: "process-notice-key",
			NOTICE_CLASSIFICATION_MODEL: "deepseek-v4-flash-0731",
		});

		const commandEnvironment = localModelConfigCommandEnvironment({
			environment: {
				NOTICE_CLASSIFICATION_API_KEY: "process-notice-key",
				RERANK_API_KEY: "process-rerank-key",
			},
			names: ["notice_classification"],
			profile: createProfile(repoRoot),
			repoRoot,
		});
		assert.equal(commandEnvironment.NOTICE_CLASSIFICATION_API_KEY, "process-notice-key");
		assert.equal(commandEnvironment.NOTICE_CLASSIFICATION_BASE_URL, "https://notice.example/v1");
		assert.equal(commandEnvironment.NOTICE_CLASSIFICATION_MODEL, "deepseek-v4-flash-0731");
		assert.equal(commandEnvironment.LLM_API_KEY, undefined);
		assert.equal(commandEnvironment.LLM_BASE_URL, undefined);
		assert.equal(commandEnvironment.RERANK_API_KEY, undefined);
		assert.equal(
			commandEnvironment.MODEL_CONFIG_DATABASE_URL,
			"postgresql://model_config:campus-agent-local-model-config@127.0.0.1:5432/campus_agent_wt_1_deadbeef",
		);
	});

	it("preserves an existing worktree portal credential", () => {
		const mainCheckoutRoot = createRepositoryShape();
		const repoRoot = createRepositoryShape();
		const mainPortalEnvironment = resolve(
			mainCheckoutRoot,
			"jobs/internal-portal-collection/adapters/internal-portal/.env.local",
		);
		writeFileSync(
			mainPortalEnvironment,
			`${MANAGED_LOCAL_ENV_MARKER}\nINTERNAL_PORTAL_SSO_TGC="TGT-main"\n`,
		);
		const targetPortalEnvironment = resolve(
			repoRoot,
			"jobs/internal-portal-collection/adapters/internal-portal/.env.local",
		);
		writeFileSync(
			targetPortalEnvironment,
			`${MANAGED_LOCAL_ENV_MARKER}\nINTERNAL_PORTAL_SSO_TGC="TGT-worktree"\n`,
		);

		importMainCheckoutExternalCredentials({
			mainCheckoutRoot,
			projections: ["internal-portal-collection"],
			repoRoot,
		});

		assert.equal(
			parseEnv(readFileSync(targetPortalEnvironment, "utf8")).INTERNAL_PORTAL_SSO_TGC,
			"TGT-worktree",
		);
		assert.equal(existsSync(resolve(repoRoot, ".env")), false);
	});

	it("does not import unrelated external credentials for a target projection", () => {
		const mainCheckoutRoot = createRepositoryShape();
		const repoRoot = createRepositoryShape();
		writeFileSync(resolve(mainCheckoutRoot, ".env"), "LLM_API_KEY=main-key\n");
		writeFileSync(
			resolve(
				mainCheckoutRoot,
				"jobs/internal-portal-collection/adapters/internal-portal/.env.local",
			),
			`${MANAGED_LOCAL_ENV_MARKER}\nINTERNAL_PORTAL_SSO_TGC="TGT-main"\n`,
		);

		importMainCheckoutExternalCredentials({
			mainCheckoutRoot,
			projections: ["notice-publisher"],
			repoRoot,
		});

		assert.equal(existsSync(resolve(repoRoot, ".env")), false);
		assert.equal(
			existsSync(
				resolve(repoRoot, "jobs/internal-portal-collection/adapters/internal-portal/.env.local"),
			),
			false,
		);
	});

	it("renders isolated endpoints and preserves generated secrets", () => {
		const repoRoot = createRepositoryShape();
		const profile = createProfile(repoRoot);
		renderLocalEnvironmentFiles({ profile, repoRoot });
		const secretPath = resolve(repoRoot, "apps/app-api/.dev.vars.local");
		const internalPortalCollectionPath = resolve(
			repoRoot,
			"jobs/internal-portal-collection/adapters/internal-portal/.env.local",
		);
		const first = parseEnv(readFileSync(secretPath, "utf8"));
		writeFileSync(
			internalPortalCollectionPath,
			`${readFileSync(internalPortalCollectionPath, "utf8").trimEnd()}\nINTERNAL_PORTAL_SSO_TGC="TGT-local"\n`,
		);
		renderLocalEnvironmentFiles({ profile, repoRoot });
		const second = parseEnv(readFileSync(secretPath, "utf8"));

		assert.equal(first.BETTER_AUTH_SECRET, second.BETTER_AUTH_SECRET);
		assert.equal(first.OPS_WEB_INTERNAL_TOKEN, second.OPS_WEB_INTERNAL_TOKEN);
		assert.equal(second.AUTH_TURNSTILE_SECRET_KEY, "local-turnstile-disabled");
		assert.equal(second.AUTH_SHELL_ORIGIN, "http://127.0.0.1:27114");
		assert.equal(second.OBJECT_STORE_DERIVED_READ_ACCESS_KEY, "minioadmin");
		assert.equal(second.OBJECT_STORE_DERIVED_READ_SECRET_KEY, "minioadmin");
		assert.equal(second.EXECUTION_CONTROL_BASE_URL, "http://127.0.0.1:27151");
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
		const agentRuntimeEnvironment = parseEnv(
			readFileSync(resolve(repoRoot, "apps/agent-runtime/.env.local"), "utf8"),
		);
		const executionControlEnvironment = parseEnv(
			readFileSync(resolve(repoRoot, "apps/execution-control/.env.local"), "utf8"),
		);
		const modelConfigEnvironment = parseEnv(
			readFileSync(resolve(repoRoot, "apps/model-config/.env.local"), "utf8"),
		);
		const campusWebEnvironment = parseEnv(
			readFileSync(resolve(repoRoot, "apps/campus-web/.dev.vars.local"), "utf8"),
		);
		const internalPortalCollectionEnvironment = parseEnv(
			readFileSync(
				resolve(repoRoot, "jobs/internal-portal-collection/adapters/internal-portal/.env.local"),
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
		assert.equal(appApiEnvironment.PORT, String(profile.ports.appApi));
		assert.equal(campusWebEnvironment.CAMPUS_WEB_DEV_PORT, String(profile.ports.campusWeb));
		assert.equal(campusWebEnvironment.AUTH_TURNSTILE_SITE_KEY, "");
		assert.equal(campusWebEnvironment.OBJECT_STORE_ENDPOINT, "http://127.0.0.1:9000");
		assert.equal(campusWebEnvironment.OBJECT_STORE_DERIVED_READ_ACCESS_KEY, "minioadmin");
		assert.equal(campusWebEnvironment.OBJECT_STORE_DERIVED_READ_SECRET_KEY, "minioadmin");
		assert.equal(campusWebEnvironment.OBJECT_STORE_DERIVED_ACCESS_KEY, undefined);
		assert.equal(campusWebEnvironment.OBJECT_STORE_DERIVED_SECRET_KEY, undefined);
		assert.equal(new URL(opsWebEnvironment.OPS_WEB_DATABASE_URL ?? "").search, "");
		assert.equal(modelConfigEnvironment.MODEL_CONFIG_HOST, "127.0.0.1");
		assert.equal(
			modelConfigEnvironment.MODEL_CONFIG_PORT,
			String(calculateLocalDevRuntimePorts(profile.slot).modelConfig),
		);
		assert.deepEqual(Object.keys(modelConfigEnvironment).sort(), [
			"MODEL_CONFIG_DATABASE_URL",
			"MODEL_CONFIG_ENCRYPTION_KEY_FILE",
			"MODEL_CONFIG_HOST",
			"MODEL_CONFIG_PORT",
		]);
		assert.equal(
			internalPortalCollectionEnvironment.OBJECT_STORE_BUCKET_SOURCE,
			"campus-agent-source",
		);
		assert.equal(
			internalPortalCollectionEnvironment.OBJECT_STORE_ENDPOINT,
			"http://127.0.0.1:9000",
		);
		assert.equal(internalPortalCollectionEnvironment.OBJECT_STORE_SOURCE_ACCESS_KEY, "minioadmin");
		assert.equal(
			internalPortalCollectionEnvironment.OPS_WEB_INTERNAL_URL,
			`http://127.0.0.1:${profile.ports.opsWebApi}`,
		);
		assert.equal(internalPortalCollectionEnvironment.INTERNAL_PORTAL_SSO_TGC, "TGT-local");
		assert.equal(internalPortalCollectionEnvironment.NOTICES_DATABASE_SSLMODE, "disable");
		assert.equal(internalPortalCollectionEnvironment.DEPLOYMENT_ENVIRONMENT, "local");
		assert.equal(noticeClassifierEnvironment.DEPLOYMENT_ENVIRONMENT, "local");
		assert.equal(noticeClassifierEnvironment.NOTICES_DATABASE_SSLMODE, "disable");
		assert.equal(noticeClassifierEnvironment.OBJECT_STORE_ENDPOINT, undefined);
		assert.equal(noticeClassifierEnvironment.INTERNAL_NOTICE_CLASSIFIER_OPENAI_API_KEY, undefined);
		const modelConfigUrl = `http://127.0.0.1:${calculateLocalDevRuntimePorts(profile.slot).modelConfig}`;
		assert.equal(executionControlEnvironment.MODEL_CONFIG_URL, modelConfigUrl);
		assert.equal(agentRuntimeEnvironment.MODEL_CONFIG_URL, modelConfigUrl);
		assert.equal(noticeClassifierEnvironment.MODEL_CONFIG_URL, modelConfigUrl);
		assert.equal(
			noticeClassifierEnvironment.NOTICES_DATABASE_URL,
			noticePublisherEnvironment.NOTICES_DATABASE_URL,
		);
		assert.equal(
			internalPortalCollectionEnvironment.NOTICES_DATABASE_URL,
			noticePublisherEnvironment.NOTICES_DATABASE_URL,
		);
		assert.equal(noticePublisherEnvironment.OBJECT_STORE_SOURCE_ACCESS_KEY, "minioadmin");
		assert.equal(noticePublisherEnvironment.OBJECT_STORE_SOURCE_SECRET_KEY, "minioadmin");
		assert.equal(noticePublisherEnvironment.OBJECT_STORE_DERIVED_ACCESS_KEY, "minioadmin");
		assert.equal(noticePublisherEnvironment.OBJECT_STORE_DERIVED_SECRET_KEY, "minioadmin");
		assert.equal(noticePublisherEnvironment.OBJECT_STORE_ACCESS_KEY, undefined);
		assert.equal(noticePublisherEnvironment.OBJECT_STORE_SECRET_KEY, undefined);
		assert.equal(noticePublisherEnvironment.DEPLOYMENT_ENVIRONMENT, "local");
		assert.equal(noticePublisherEnvironment.NOTICES_DATABASE_SSLMODE, "disable");
		assert.equal(noticePublisherEnvironment.INTERNAL_PORTAL_BASE_URL, undefined);
		assert.equal(opsWebEnvironment.OPS_WEB_APP_API_URL, "http://127.0.0.1:27131");
		assert.equal(opsWebEnvironment.OPS_WEB_CAMPUS_WEB_URL, "http://127.0.0.1:27114");
		assert.equal(opsWebEnvironment.OPS_WEB_INTERNAL_TOKEN, second.OPS_WEB_INTERNAL_TOKEN);
		assert.equal(opsWebEnvironment.MODEL_CONFIG_URL, modelConfigUrl);
		assert.equal(
			opsWebEnvironment.OPS_WEB_AUTOMATION_ORIGIN,
			`http://127.0.0.1:${profile.ports.opsWebApi}`,
		);
		assert.equal(opsWebEnvironment.OPS_WEB_WEB_PORT, String(profile.ports.opsWeb));
	});

	it("creates a stable per-worktree Model Config encryption key with private permissions", () => {
		const repoRoot = createRepositoryShape();
		const first = ensureLocalModelConfigEncryptionKey(repoRoot);
		const second = ensureLocalModelConfigEncryptionKey(repoRoot);
		assert.equal(first, resolveLocalModelConfigEncryptionKeyPath(repoRoot));
		assert.equal(second, first);
		assert.equal(Buffer.from(readFileSync(first, "utf8").trim(), "base64").length, 32);
		assert.equal(statSync(first).mode & 0o777, 0o600);
	});

	it("does not create the retired provider encryption key during standard setup", () => {
		const repoRoot = createRepositoryShape();
		ensureLocalModelConfigEncryptionKey(repoRoot);
		assert.equal(existsSync(resolve(repoRoot, "var/dev/provider-config-encryption.key")), false);
	});

	it("refuses to overwrite a developer-owned application environment file", () => {
		const repoRoot = createRepositoryShape();
		writeFileSync(resolve(repoRoot, "apps/ops-web/.env.local"), "USER_OWNED=1\n");
		assert.throws(
			() => renderLocalEnvironmentFiles({ profile: createProfile(repoRoot), repoRoot }),
			/Refusing to overwrite unmanaged local environment file/u,
		);
	});

	it("removes managed files while preserving a developer-owned file", () => {
		const repoRoot = createRepositoryShape();
		renderLocalEnvironmentFiles({ profile: createProfile(repoRoot), repoRoot });
		const firstManagedPath = resolve(repoRoot, "apps/app-api/.env.local");
		writeFileSync(resolve(repoRoot, "apps/ops-web/.env.local"), "USER_OWNED=1\n");
		const cleanup = removeLocalEnvironmentFiles(repoRoot);
		assert.deepEqual(cleanup.skippedUnmanaged, [resolve(repoRoot, "apps/ops-web/.env.local")]);
		assert.ok(cleanup.removed.length > 0);
		assert.equal(existsSync(firstManagedPath), false);
		assert.equal(
			readFileSync(resolve(repoRoot, "apps/ops-web/.env.local"), "utf8"),
			"USER_OWNED=1\n",
		);
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

	it("renders only the requested optional target", () => {
		const repoRoot = createRepositoryShape();
		const profile = createProfile(repoRoot);
		const corePaths = renderLocalEnvironmentFiles({ profile, repoRoot, target: "core" });
		assert.equal(corePaths.length, 6);
		assert.equal(existsSync(resolve(repoRoot, "apps/ops-web/.env.local")), false);
	});

	it("does not create core secrets for a target without a core projection", () => {
		const repoRoot = createRepositoryShape();
		renderLocalEnvironmentFiles({
			profile: createProfile(repoRoot),
			repoRoot,
			target: "notice-publisher",
		});
		assert.equal(existsSync(resolve(repoRoot, "var/dev/local-secrets.json")), false);
		assert.equal(existsSync(resolve(repoRoot, "apps/app-api/.dev.vars.local")), false);
		assert.equal(existsSync(resolve(repoRoot, "jobs/notice-publisher/.env.local")), true);
	});

	it("renders each one-shot job environment independently", () => {
		const repoRoot = createRepositoryShape();
		const profile = createProfile(repoRoot);
		const collectionPaths = renderLocalEnvironmentFiles({
			profile,
			repoRoot,
			target: "internal-portal-collection",
		});
		assert.deepEqual(
			collectionPaths,
			managedLocalEnvironmentPathsForProjections(
				repoRoot,
				resolveLocalDevTargetPlan("internal-portal-collection").environmentProjections,
			),
		);
		assert.equal(existsSync(resolve(repoRoot, "jobs/notice-classifier/.env.local")), false);
		assert.equal(existsSync(resolve(repoRoot, "jobs/notice-publisher/.env.local")), false);
		assert.equal(existsSync(resolve(repoRoot, "apps/app-api/.env.local")), false);

		const classifierPaths = renderLocalEnvironmentFiles({
			profile,
			repoRoot,
			target: "notice-classifier",
		});
		assert.deepEqual(
			classifierPaths,
			managedLocalEnvironmentPathsForProjections(
				repoRoot,
				resolveLocalDevTargetPlan("notice-classifier").environmentProjections,
			),
		);
		assert.equal(existsSync(resolve(repoRoot, "apps/model-config/.env.local")), true);
		assert.equal(existsSync(resolve(repoRoot, "apps/app-api/.env.local")), false);
	});
});

describe("local development lifecycle guards", () => {
	it("preserves timeout evidence for command probes", () => {
		const result = captureCommandResult(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], {
			timeout: 20,
		});
		assert.equal(result.timedOut, true);
		assert.notEqual(result.error, undefined);
	});
	it("computes target projections and bootstrap owners", () => {
		assert.deepEqual(resolveLocalDevTargetPlan("ops-web").environmentProjections, [
			"core",
			"ops-web",
		]);
		assert.deepEqual(resolveLocalDevTargetPlan("notice-classifier").environmentProjections, [
			"model-config",
			"notice-classifier",
		]);
		assert.deepEqual(
			resolveLocalDevTargetPlan("internal-portal-collection").environmentProjections,
			["ops-web", "internal-portal-collection"],
		);
		assert.deepEqual(resolveLocalDevTargetPlan("internal-portal-collection").bootstrapSteps, [
			"campus-agent-schema",
			"notice-publisher-seed-local",
		]);
		assert.deepEqual(resolveLocalDevTargetPlan("core").modelConfigNames, [
			"primary_agent",
			"campus_docs_embedding",
			"campus_docs_reranker",
		]);
		assert.deepEqual(resolveLocalDevTargetPlan("core").bootstrapSteps, [
			"campus-agent-schema",
			"model-config-seed",
			"campus-web-docs",
			"app-api-seed-local-campus-groups",
			"app-api-seed-local-test-user",
			"model-config-check",
			"temporal-namespace",
		]);
		assert.deepEqual(resolveLocalDevTargetPlan("notice-classifier").modelConfigNames, [
			"notice_classification",
		]);
		assert.deepEqual(resolveLocalDevTargetPlan("notice-classifier").bootstrapSteps, [
			"campus-agent-schema",
			"model-config-seed",
			"notice-publisher-seed-local",
			"model-config-check",
		]);
		for (const target of ["ops-web", "notice-publisher", "internal-portal-collection"] as const) {
			const plan = resolveLocalDevTargetPlan(target);
			assert.deepEqual(plan.modelConfigNames, []);
			assert.equal(plan.bootstrapSteps.includes("model-config-seed"), false);
			assert.equal(plan.bootstrapSteps.includes("model-config-check"), false);
		}
		assert.deepEqual(resolveLocalDevTargetPlan("notice-classifier").runtimeDependencies, [
			"model-config",
		]);
	});
	it("keeps the lifecycle facade limited to init, diagnosis, and destruction", () => {
		assert.deepEqual(Object.keys(lifecycle).sort(), [
			"destroyLocalDevelopment",
			"diagnoseLocalDevelopment",
			"initializeLocalDevelopmentTarget",
			"pruneLocalDevelopment",
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

	it("repairs either side of a partial isolated instance", () => {
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
		assert.equal(
			resolveIsolatedResourceAction({ bucketExists: true, databaseExists: false }),
			"repair-database",
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
		assert.equal(
			isSharedDataInfrastructureReady({
				...healthy,
				status: "ready",
				capabilities: {
					derivedBucket: "present",
					docsBucket: "present",
					docsSource: "present",
					objectStore: "present",
					postgres: "present",
					required: [],
					sourceBucket: "present",
					temporal: "present",
				},
				containers: {
					...healthy.containers,
					temporal: { ...healthy.containers.temporal, healthy: false },
				},
			}),
			true,
		);
	});

	it("classifies instance records without hiding stale or partial resources", () => {
		assert.equal(
			classifyLocalDevInstanceStatus({
				bucket: "present",
				database: "present",
				namespace: "present",
				worktree: "present",
			}),
			"ready",
		);
		assert.equal(
			classifyLocalDevInstanceStatus({
				bucket: "present",
				database: "present",
				namespace: "present",
				worktree: "missing",
			}),
			"stale",
		);
		assert.equal(
			classifyLocalDevInstanceStatus({
				bucket: "present",
				database: "missing",
				namespace: "missing",
				worktree: "present",
			}),
			"partial",
		);
		assert.equal(
			classifyLocalDevInstanceStatus({
				bucket: "missing",
				database: "missing",
				namespace: "missing",
				worktree: "present",
			}),
			"unprovisioned",
		);
		assert.equal(
			classifyLocalDevInstanceStatus({
				bucket: "unknown",
				database: "unknown",
				namespace: "unknown",
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

	it("deletes confirmed resources while retaining unresolved cleanup state", () => {
		assert.deepEqual(
			resolveLocalInstanceResourceCleanup({
				bucket: "present",
				database: "present",
				namespace: "unknown",
			}),
			{
				deleteBucket: true,
				deleteDatabase: true,
				deleteNamespace: false,
				unresolved: ["namespace"],
			},
		);
	});

	it("runs application bootstrap in explicit dependency order", () => {
		const commands = localApplicationBootstrapCommands("/repo", createProfile("/repo"));
		assert.deepEqual(
			commands.map(({ step }) => step),
			[
				"campus-web-docs",
				"campus-agent-schema",
				"app-api-seed-local-campus-groups",
				"app-api-seed-local-test-user",
				"notice-publisher-seed-local",
				"ops-web-dining-bootstrap",
			],
		);
		assert.doesNotMatch(commands[0]?.args.join(" ") ?? "", /\.dev\.vars/u);
		assert.match(commands[2]?.args.join(" ") ?? "", /seed-local-campus-groups\.ts/u);
		assert.match(commands[3]?.args.join(" ") ?? "", /seed-local-test-user\.ts/u);
		assert.deepEqual(commands[4]?.args, ["--dir", "jobs/notice-publisher", "seed-local"]);
		assert.equal(commands[4]?.options.env?.DEPLOYMENT_ENVIRONMENT, "local");
		assert.equal(commands[4]?.options.env?.NOTICES_DATABASE_SSLMODE, "disable");
		assert.equal(
			commands.some(({ step }) => step === "model-config-seed"),
			false,
		);
		assert.equal(
			commands.some(({ step }) => step === "model-config-check"),
			false,
		);

		const corePlan = resolveLocalDevTargetPlan("core");
		const coreCommands = localApplicationBootstrapCommands(
			"/repo",
			createProfile("/repo"),
			corePlan.bootstrapSteps.filter(
				(step): step is Exclude<typeof step, "temporal-namespace"> => step !== "temporal-namespace",
			),
			corePlan.modelConfigNames,
		);
		assert.deepEqual(
			coreCommands.map(({ step }) => step),
			[
				"campus-agent-schema",
				"model-config-seed",
				"campus-web-docs",
				"app-api-seed-local-campus-groups",
				"app-api-seed-local-test-user",
				"model-config-check",
			],
		);
		assert.deepEqual(coreCommands[1]?.args, [
			"--silent",
			"--dir",
			"apps/model-config",
			"local:seed",
			"--name",
			"primary_agent",
			"--name",
			"campus_docs_embedding",
			"--name",
			"campus_docs_reranker",
		]);
		assert.equal(
			coreCommands[1]?.options.env?.MODEL_CONFIG_DATABASE_URL,
			"postgresql://model_config:campus-agent-local-model-config@127.0.0.1:5432/campus_agent_wt_1_deadbeef",
		);
		assert.match(
			coreCommands[1]?.options.env?.MODEL_CONFIG_ENCRYPTION_KEY_FILE ?? "",
			/model-config-encryption\.key$/u,
		);

		const classifierPlan = resolveLocalDevTargetPlan("notice-classifier");
		const classifierCommands = localApplicationBootstrapCommands(
			"/repo",
			createProfile("/repo"),
			classifierPlan.bootstrapSteps,
			classifierPlan.modelConfigNames,
		);
		assert.deepEqual(classifierCommands[1]?.args, [
			"--silent",
			"--dir",
			"apps/model-config",
			"local:seed",
			"--name",
			"notice_classification",
		]);
		assert.deepEqual(classifierCommands[3]?.args, [
			"--silent",
			"--dir",
			"apps/model-config",
			"local:check",
			"--name",
			"notice_classification",
		]);
		assert.deepEqual(
			localApplicationBootstrapCommands(
				"/repo",
				createProfile("/repo"),
				resolveLocalDevTargetPlan("ops-web").bootstrapSteps.filter(
					(step) => step !== "temporal-namespace",
				),
			).map(({ step }) => step),
			["campus-agent-schema", "notice-publisher-seed-local", "ops-web-dining-bootstrap"],
		);
		const steps = commands.map(({ step }) => String(step));
		assert.equal(steps.includes("notice-publisher-migrate"), false);
		assert.equal(steps.includes("ops-web-schema"), false);
	});

	it("keeps the internal portal collection local loader inside its adapter", () => {
		const source = readFileSync(
			resolve(
				import.meta.dirname,
				"../../jobs/internal-portal-collection/adapters/internal-portal/src/config.ts",
			),
			"utf8",
		);
		assert.doesNotMatch(source, /repoRoot/u);
		assert.match(source, /path\.join\(adapterRoot, "\.env\.local"\)/u);
	});

	it("keeps core and Ops Web dev commands package-native", () => {
		const appApiPackage = readPackageJson("apps/app-api/package.json");
		const campusWebPackage = readPackageJson("apps/campus-web/package.json");
		const schemaPackage = readPackageJson("jobs/campus-agent-schema/package.json");
		const executionPackage = JSON.parse(
			readFileSync(
				resolve(import.meta.dirname, "../../apps/execution-control/package.json"),
				"utf8",
			),
		) as { scripts?: { dev?: string } };
		const agentPackage = JSON.parse(
			readFileSync(resolve(import.meta.dirname, "../../apps/agent-runtime/package.json"), "utf8"),
		) as { scripts?: { dev?: string } };
		const opsWebPackage = readPackageJson("apps/ops-web/package.json");
		assert.match(schemaPackage.scripts?.status ?? "", /tsx src\/cli\.ts status/u);
		assert.match(appApiPackage.scripts?.dev ?? "", /exec wrangler dev/u);
		assert.match(appApiPackage.scripts?.dev ?? "", /\. \.\/\.dev\.vars\.local/u);
		assert.match(
			appApiPackage.scripts?.dev ?? "",
			/--var "EXECUTION_CONTROL_BASE_URL:\$EXECUTION_CONTROL_BASE_URL"/u,
		);
		assert.match(campusWebPackage.scripts?.dev ?? "", /\bvite\b/u);
		assert.match(executionPackage.scripts?.dev ?? "", /exec go run/u);
		assert.match(agentPackage.scripts?.dev ?? "", /--experimental-strip-types src\/server\.ts/u);
		assert.equal(opsWebPackage.scripts?.dev, undefined);
		assert.match(opsWebPackage.scripts?.["dev:api"] ?? "", /--experimental-strip-types/u);
		for (const command of [
			appApiPackage.scripts?.dev,
			campusWebPackage.scripts?.dev,
			executionPackage.scripts?.dev,
			agentPackage.scripts?.dev,
		]) {
			assert.doesNotMatch(command ?? "", /tsx|scripts\/dev\.ts/u);
		}
	});
});

function readPackageJson(relativePath: string): { scripts?: Record<string, string> } {
	return JSON.parse(readFileSync(resolve(import.meta.dirname, "../..", relativePath), "utf8")) as {
		scripts?: Record<string, string>;
	};
}

function createRepositoryShape(): string {
	const repoRoot = mkdtempSync(resolve(tmpdir(), "campus-agent-dev-test-"));
	temporaryDirectories.push(repoRoot);
	for (const app of [
		"app-api",
		"campus-web",
		"execution-control",
		"model-config",
		"agent-runtime",
		"ops-web",
	]) {
		mkdirSync(resolve(repoRoot, "apps", app), { recursive: true });
	}
	mkdirSync(resolve(repoRoot, "jobs/internal-portal-collection/adapters/internal-portal"), {
		recursive: true,
	});
	for (const job of ["notice-classifier", "notice-publisher"]) {
		mkdirSync(resolve(repoRoot, "jobs", job), { recursive: true });
	}
	return repoRoot;
}

function createGitRepository(): string {
	const repository = mkdtempSync(resolve(tmpdir(), "campus-agent-git-test-"));
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
	return repository;
}

function createProfile(worktreePath: string): LocalDevProfileV2 {
	return {
		bucketName: "campus-agent-derived-wt-1-deadbeef",
		createdAt: "2026-07-20T00:00:00.000Z",
		databaseName: "campus_agent_wt_1_deadbeef",
		instanceId: "dining-production-deadbeef",
		ports: calculateLocalDevPorts(1),
		repoKey: "repo-key",
		resourceKey: "deadbeef",
		schemaVersion: 2,
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
			temporalPostgres: { ...container, service: "temporal-postgres" },
			temporal: { ...container, service: "temporal" },
		},
		expectedHashes: {
			objectStore: "hash",
			postgres: "hash",
			temporalPostgres: "hash",
			temporal: "hash",
		},
		network: "present",
		volumes: { objectStore: "present", postgres: "present", temporal: "present" },
	};
}
