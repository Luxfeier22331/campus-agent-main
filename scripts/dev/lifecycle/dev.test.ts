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
import { ensureLocalInfrastructureSecrets } from "./infrastructure-secrets";
import { destroyLocalInstanceResources, diagnoseLocalDevInstances } from "./instance-resources";
import * as lifecycle from "./lifecycle";
import { assertLocalHindsightProviders, localHindsightEnvironment } from "./local-hindsight";
import { objectStoreCommand } from "./local-infrastructure";
import { captureCommandResult } from "./process";
import {
	allocateAvailableSlot,
	allocateLocalDevSlot,
	calculateLocalDevInfrastructurePorts,
	calculateLocalDevPorts,
	calculateLocalDevRuntimePorts,
	ensureLocalDevProfile,
	isMainWorktree,
	type LocalDevProfile,
	listLocalDevProfiles,
	loadLocalDevProfile,
	normalizeResourceLabel,
	releaseLocalDevProfile,
	resolveLegacyLocalDevProfilePath,
	resolveLocalDevProfilePath,
	resolveLocalDevRegistryPath,
} from "./profile";
import { LOCAL_DEV_TARGETS, resolveLocalDevTargetPlan } from "./targets";

const temporaryDirectories: string[] = [];
const qdrant = {
	apiKey: "fixture-qdrant-writer",
	readOnlyApiKey: "fixture-qdrant-read-only",
	url: "http://127.0.0.1:16333",
};

afterEach(() => {
	for (const path of temporaryDirectories.splice(0)) {
		rmSync(path, { force: true, recursive: true });
	}
});

describe("local development profiles", () => {
	it("grants anonymous GET only to derived floorplans when provisioning buckets", () => {
		const repoRoot = createRepositoryShape();
		const profile = createProfile(repoRoot);
		const secrets = ensureLocalInfrastructureSecrets(repoRoot, profile);
		for (const bucket of [profile.bucketName, profile.sourceBucketName]) {
			for (const action of ["create", "remove"] as const) {
				const command = objectStoreCommand(profile, bucket, action, secrets);
				// Execute the generated shell; capture the policy passed to the CLI without Docker.
				const output = execFileSync(
					"sh",
					["-ec", `rc() { if [ "$1" = anonymous ]; then cat "$3"; fi; }\n${command.at(-1)}`],
					{ encoding: "utf8", env: { ...process.env, BUCKET: bucket } },
				);
				if (bucket === profile.bucketName && action === "create") {
					assert.deepEqual(JSON.parse(output), {
						Version: "2012-10-17",
						Statement: [
							{
								Effect: "Allow",
								Principal: { AWS: ["*"] },
								Action: ["s3:GetObject"],
								Resource: [`arn:aws:s3:::${bucket}/dining/floorplans/*`],
							},
						],
					});
				} else {
					assert.equal(output, "");
				}
			}
		}
	});

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
			campusSearch: 27254,
			executionControl: 27251,
			executionWorker: 27252,
			modelConfig: 27253,
		});
	});

	it("keeps every host port unique across the full slot range", () => {
		const seen = new Map<number, string>();
		for (let slot = 0; slot <= 99; slot += 1) {
			const families = [
				calculateLocalDevPorts(slot),
				calculateLocalDevRuntimePorts(slot),
				calculateLocalDevInfrastructurePorts(slot),
			];
			for (const family of families) {
				for (const [name, port] of Object.entries(family)) {
					const owner = `${name}@${slot}`;
					const existing = seen.get(port);
					assert.equal(existing, undefined, `${owner} reuses ${port} reserved by ${existing}`);
					seen.set(port, owner);
				}
			}
		}
	});

	it("normalizes resource labels and allocates the first available slot", () => {
		assert.equal(
			normalizeResourceLabel("Dining Production_Readiness"),
			"dining-production-readiness",
		);
		assert.equal(allocateLocalDevSlot([{ slot: 1 }, { slot: 3 }], 1), 2);
		assert.equal(allocateLocalDevSlot([], 0), 0);
	});

	it("starts at the requested slot when its ports are available", async () => {
		for (const firstSlot of [0, 1]) {
			const checked: number[][] = [];
			const slot = await allocateAvailableSlot([], firstSlot, async (ports) => {
				checked.push([...ports]);
				return { occupied: [], unknown: [] };
			});
			assert.equal(slot, firstSlot);
			assert.deepEqual(checked, [
				[
					...Object.values(calculateLocalDevPorts(firstSlot)),
					...Object.values(calculateLocalDevRuntimePorts(firstSlot)),
					...Object.values(calculateLocalDevInfrastructurePorts(firstSlot)),
				],
			]);
		}
	});

	it("skips occupied ports and registered slots when allocating a profile", async () => {
		const checked: number[][] = [];
		const slot = await allocateAvailableSlot([{ slot: 1 }], 0, async (ports) => {
			checked.push([...ports]);
			return {
				occupied: ports.includes(27062) ? [27062] : [],
				unknown: [],
			};
		});
		assert.equal(slot, 2);
		assert.deepEqual(
			checked,
			[0, 2].map((value) => [
				...Object.values(calculateLocalDevPorts(value)),
				...Object.values(calculateLocalDevRuntimePorts(value)),
				...Object.values(calculateLocalDevInfrastructurePorts(value)),
			]),
		);
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
			assert.ok(main.slot >= 0);
			assert.ok(worktree.slot >= 1);
			assert.notEqual(main.slot, worktree.slot);
			assert.notEqual(main.databaseName, worktree.databaseName);
			assert.notEqual(main.bucketName, worktree.bucketName);
			assert.notDeepEqual(main.ports, worktree.ports);
			assert.equal(listLocalDevProfiles(repository).length, 2);
			assert.deepEqual(await ensureLocalDevProfile(repository), main);
			assert.deepEqual(await ensureLocalDevProfile(linked), worktree);
			assert.equal(listLocalDevProfiles(repository).length, 2);
		} finally {
			if (previousStateHome === undefined) {
				delete process.env.XDG_STATE_HOME;
			} else {
				process.env.XDG_STATE_HOME = previousStateHome;
			}
		}
	});

	it("adds the Hindsight port to an existing profile without replacing its identity", async () => {
		const repoRoot = createGitRepository();
		const original = await ensureLocalDevProfile(repoRoot);
		const path = resolveLocalDevProfilePath(repoRoot);
		const stored = JSON.parse(readFileSync(path, "utf8"));
		delete stored.infraPorts.hindsightApi;
		writeFileSync(path, JSON.stringify(stored));
		const current = await ensureLocalDevProfile(repoRoot);
		assert.equal(current.instanceId, original.instanceId);
		assert.equal(current.databaseName, original.databaseName);
		assert.deepEqual(current.ports, original.ports);
		assert.equal(
			current.infraPorts.hindsightApi,
			calculateLocalDevInfrastructurePorts(current.slot).hindsightApi,
		);
	});
	it("rejects legacy profiles and registry without rewriting them", async () => {
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

			await assert.rejects(
				ensureLocalDevProfile(repository),
				/Legacy local development registry found/u,
			);
			assert.equal(existsSync(currentProfilePath), false);
			assert.equal(existsSync(currentRegistryPath), false);
			assert.equal(existsSync(legacyProfilePath), true);
			assert.equal(existsSync(legacyRegistryPath), true);
		} finally {
			if (previousStateHome === undefined) {
				delete process.env.XDG_STATE_HOME;
			} else {
				process.env.XDG_STATE_HOME = previousStateHome;
			}
		}
	});

	it("rejects a legacy registry even when a v3 registry also exists", async () => {
		const repository = createGitRepository();
		const stateDirectory = resolve(repository, "state");
		const previousStateHome = process.env.XDG_STATE_HOME;
		process.env.XDG_STATE_HOME = stateDirectory;
		try {
			const profile = await ensureLocalDevProfile(repository);
			const registryPath = resolveLocalDevRegistryPath(repository);
			const legacyRegistryPath = resolve(
				stateDirectory,
				"campus-agent",
				profile.repoKey,
				"instances.v1.json",
			);
			writeFileSync(legacyRegistryPath, JSON.stringify({ schemaVersion: 1, instances: [] }));
			assert.throws(
				() => listLocalDevProfiles(repository),
				/Legacy local development registry found/u,
			);
			assert.throws(
				() => loadLocalDevProfile(repository),
				/Legacy local development registry found/u,
			);
			assert.equal(existsSync(registryPath), true);
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

	it("keeps the current worktree fail-closed when stored ports drift from the derivation", async () => {
		const repository = createGitRepository();
		const stateDirectory = resolve(repository, "state");
		const previousStateHome = process.env.XDG_STATE_HOME;
		process.env.XDG_STATE_HOME = stateDirectory;
		try {
			const profile = await ensureLocalDevProfile(repository);
			const drifted = {
				...JSON.parse(readFileSync(resolveLocalDevProfilePath(repository), "utf8")),
				infraPorts: { ...profile.infraPorts, qdrantHttp: profile.infraPorts.qdrantHttp - 10 },
			};
			writeFileSync(resolveLocalDevProfilePath(repository), `${JSON.stringify(drifted)}\n`);

			assert.throws(() => loadLocalDevProfile(repository), /do not match slot/u);
			await assert.rejects(ensureLocalDevProfile(repository), /do not match slot/u);
		} finally {
			if (previousStateHome === undefined) {
				delete process.env.XDG_STATE_HOME;
			} else {
				process.env.XDG_STATE_HOME = previousStateHome;
			}
		}
	});

	it("lists and releases instances whose stored ports drift from the derivation", async () => {
		const repository = createGitRepository();
		const stateDirectory = resolve(repository, "state");
		const previousStateHome = process.env.XDG_STATE_HOME;
		process.env.XDG_STATE_HOME = stateDirectory;
		try {
			await ensureLocalDevProfile(repository);
			const registryPath = resolveLocalDevRegistryPath(repository);
			const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
				instances: Array<LocalDevProfile & { infraPorts: Record<string, number> }>;
			};
			const [instance] = registry.instances;
			assert.ok(instance);
			const drifted = {
				...instance,
				infraPorts: { ...instance.infraPorts, qdrantHttp: instance.infraPorts.qdrantHttp - 10 },
			};
			writeFileSync(
				registryPath,
				`${JSON.stringify({ instances: [drifted], schemaVersion: 3 })}\n`,
			);

			assert.equal(listLocalDevProfiles(repository).length, 1);

			releaseLocalDevProfile(repository, drifted.instanceId);

			assert.equal(listLocalDevProfiles(repository).length, 0);
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

	it("cleans a compose project without infrastructure credentials", async () => {
		const repoRoot = createRepositoryShape();
		const profile = createProfile(repoRoot);
		assert.equal(existsSync(resolve(repoRoot, "var/dev/infrastructure")), false);

		await destroyLocalInstanceResources(repoRoot, profile);

		assert.equal(existsSync(resolve(repoRoot, "var/dev/infrastructure")), false);
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
				"UNRELATED_EXTERNAL_TOKEN=must-not-copy",
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
		assert.equal(imported.UNRELATED_EXTERNAL_TOKEN, undefined);
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
				"NOTICE_CLASSIFICATION_PROVIDER=openai",
				"NOTICE_CLASSIFICATION_API_PROTOCOL=openai.responses",
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
			NOTICE_CLASSIFICATION_PROVIDER: "openai",
			NOTICE_CLASSIFICATION_API_PROTOCOL: "openai.responses",
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
		assert.equal(commandEnvironment.NOTICE_CLASSIFICATION_PROVIDER, "openai");
		assert.equal(commandEnvironment.NOTICE_CLASSIFICATION_API_PROTOCOL, "openai.responses");
		assert.equal(commandEnvironment.LLM_API_KEY, undefined);
		assert.equal(commandEnvironment.LLM_BASE_URL, undefined);
		assert.equal(commandEnvironment.RERANK_API_KEY, undefined);
		assert.equal(
			commandEnvironment.MODEL_CONFIG_DATABASE_URL,
			`postgresql://model_config:campus-agent-local-model-config@127.0.0.1:${createProfile("/repo").infraPorts.postgres}/campus_agent_wt_1_deadbeef`,
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

	it("imports provider credentials for each index publisher target", () => {
		const mainCheckoutRoot = createRepositoryShape();
		writeFileSync(
			resolve(mainCheckoutRoot, ".env"),
			[
				"EMBEDDING_BASE_URL=https://embedding.example/v1",
				"EMBEDDING_API_KEY=embedding-key",
				"LLM_API_KEY=llm-key",
				"",
			].join("\n"),
		);

		for (const target of ["campus-docs-index-publisher", "notice-index-publisher"] as const) {
			const repoRoot = createRepositoryShape();
			importMainCheckoutExternalCredentials({
				mainCheckoutRoot,
				projections: resolveLocalDevTargetPlan(target).environmentProjections,
				repoRoot,
			});
			const imported = parseEnv(readFileSync(resolve(repoRoot, ".env"), "utf8"));
			assert.equal(imported.EMBEDDING_BASE_URL, "https://embedding.example/v1");
			assert.equal(imported.EMBEDDING_API_KEY, "embedding-key");
			assert.equal(imported.LLM_API_KEY, "llm-key");
		}
	});

	it("merges local direct-connect additions only into the two Go consumers", () => {
		const repoRoot = createRepositoryShape();
		const profile = createProfile(repoRoot);
		writeFileSync(
			resolve(repoRoot, ".env"),
			'NO_PROXY=" ai.gitee.com, localhost,, "\nno_proxy="ai.gitee.com,internal.example"\n',
		);
		const environment = {
			NO_PROXY: "127.0.0.1, localhost",
			no_proxy: "localhost,10.0.0.0/8",
			HTTPS_PROXY: "http://proxy.example:7897",
		};
		const beforeEnvironment = { ...environment };
		const render = () =>
			renderLocalEnvironmentFiles({ profile, qdrant, repoRoot, target: "core", environment });
		render();
		const paths = managedLocalEnvironmentPaths(repoRoot);
		const expected = "127.0.0.1,localhost,10.0.0.0/8,ai.gitee.com,internal.example";
		for (const path of [paths.executionControl, paths.modelConfig]) {
			const before = readFileSync(path, "utf8");
			const values = parseEnv(before);
			assert.equal(values.NO_PROXY, expected);
			assert.equal(values.no_proxy, expected);
			assert.equal(values.HTTPS_PROXY, undefined);
			render();
			assert.equal(readFileSync(path, "utf8"), before);
		}
		for (const path of [paths.agentRuntime, paths.appApi, paths.appApiVars, paths.campusWeb]) {
			const values = parseEnv(readFileSync(path, "utf8"));
			assert.equal(values.NO_PROXY, undefined);
			assert.equal(values.no_proxy, undefined);
		}
		assert.deepEqual(environment, beforeEnvironment);
		writeFileSync(resolve(repoRoot, ".env"), "");
		render();
		for (const path of [paths.executionControl, paths.modelConfig]) {
			const values = parseEnv(readFileSync(path, "utf8"));
			assert.equal(values.NO_PROXY, undefined);
			assert.equal(values.no_proxy, undefined);
		}
	});
	it("does not project inherited proxy exclusions without local additions", () => {
		const repoRoot = createRepositoryShape();
		const profile = createProfile(repoRoot);
		for (const contents of [undefined, 'NO_PROXY=" , "\nno_proxy=""\n']) {
			if (contents !== undefined) {
				writeFileSync(resolve(repoRoot, ".env"), contents);
			}
			renderLocalEnvironmentFiles({
				profile,
				qdrant,
				repoRoot,
				projections: ["model-config"],
				environment: { NO_PROXY: "inherited.example" },
			});
			const values = parseEnv(
				readFileSync(managedLocalEnvironmentPaths(repoRoot).modelConfig, "utf8"),
			);
			assert.equal(values.NO_PROXY, undefined);
			assert.equal(values.no_proxy, undefined);
		}
	});
	it("renders isolated endpoints and preserves generated secrets", () => {
		const repoRoot = createRepositoryShape();
		const profile = createProfile(repoRoot);
		renderLocalEnvironmentFiles({ profile, qdrant, repoRoot });
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
		renderLocalEnvironmentFiles({ profile, qdrant, repoRoot });
		const second = parseEnv(readFileSync(secretPath, "utf8"));

		assert.equal(first.BETTER_AUTH_SECRET, second.BETTER_AUTH_SECRET);
		assert.equal(first.OPS_WEB_INTERNAL_TOKEN, second.OPS_WEB_INTERNAL_TOKEN);
		assert.equal(second.AUTH_TURNSTILE_SECRET_KEY, "local-turnstile-disabled");
		assert.equal(second.AUTH_SHELL_ORIGIN, "http://127.0.0.1:27114");
		assert.equal(
			second.OBJECT_STORE_DERIVED_READ_ACCESS_KEY,
			second.OBJECT_STORE_DERIVED_ACCESS_KEY,
		);
		assert.equal(
			second.OBJECT_STORE_DERIVED_READ_SECRET_KEY,
			second.OBJECT_STORE_DERIVED_SECRET_KEY,
		);
		assert.equal(second.EXECUTION_CONTROL_BASE_URL, "http://127.0.0.1:27151");
		assert.equal(
			second.OBJECT_STORE_LOCAL_BASE_URL,
			`http://127.0.0.1:${profile.infraPorts.objectStore}/${profile.bucketName}/`,
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
		assert.equal(
			campusWebEnvironment.OBJECT_STORE_ENDPOINT,
			`http://127.0.0.1:${profile.infraPorts.objectStore}`,
		);
		assert.equal(
			campusWebEnvironment.OBJECT_STORE_DERIVED_READ_ACCESS_KEY,
			campusWebEnvironment.OBJECT_STORE_DERIVED_ACCESS_KEY,
		);
		assert.equal(
			campusWebEnvironment.OBJECT_STORE_DERIVED_READ_SECRET_KEY,
			campusWebEnvironment.OBJECT_STORE_DERIVED_SECRET_KEY,
		);
		assert.equal(
			campusWebEnvironment.OBJECT_STORE_DERIVED_ACCESS_KEY,
			campusWebEnvironment.OBJECT_STORE_DERIVED_READ_ACCESS_KEY,
		);
		assert.equal(
			campusWebEnvironment.OBJECT_STORE_DERIVED_SECRET_KEY,
			campusWebEnvironment.OBJECT_STORE_DERIVED_READ_SECRET_KEY,
		);
		assert.equal(campusWebEnvironment.OBJECT_STORE_BUCKET_DERIVED, profile.bucketName);
		assert.equal(executionControlEnvironment.CAMPUS_DOCS_SERVING_DATABASE_URL, undefined);
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
			profile.sourceBucketName,
		);
		assert.equal(
			internalPortalCollectionEnvironment.OBJECT_STORE_ENDPOINT,
			`http://127.0.0.1:${profile.infraPorts.objectStore}`,
		);
		assert.equal(
			internalPortalCollectionEnvironment.OBJECT_STORE_SOURCE_ACCESS_KEY,
			internalPortalCollectionEnvironment.OBJECT_STORE_DERIVED_ACCESS_KEY,
		);
		assert.equal(
			internalPortalCollectionEnvironment.OPS_WEB_INTERNAL_URL,
			`http://127.0.0.1:${profile.ports.opsWeb}`,
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
		assert.equal(
			noticePublisherEnvironment.OBJECT_STORE_SOURCE_ACCESS_KEY,
			noticePublisherEnvironment.OBJECT_STORE_DERIVED_ACCESS_KEY,
		);
		assert.equal(
			noticePublisherEnvironment.OBJECT_STORE_SOURCE_SECRET_KEY,
			noticePublisherEnvironment.OBJECT_STORE_DERIVED_SECRET_KEY,
		);
		assert.ok(noticePublisherEnvironment.OBJECT_STORE_DERIVED_ACCESS_KEY);
		assert.ok(noticePublisherEnvironment.OBJECT_STORE_DERIVED_SECRET_KEY);
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

	it("requires independent Hindsight provider credentials rather than using product model settings", () => {
		const repoRoot = createRepositoryShape();
		writeFileSync(
			resolve(repoRoot, ".env"),
			"LLM_API_KEY=product-only\nEMBEDDING_API_KEY=product-only\n",
		);
		assert.throws(
			() => assertLocalHindsightProviders(localHindsightEnvironment(repoRoot)),
			/Configure local Hindsight providers/u,
		);
		writeFileSync(
			resolve(repoRoot, ".env"),
			"HINDSIGHT_API_LLM_API_KEY=memory-llm\nHINDSIGHT_API_LLM_PROVIDER=openai-responses\nHINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY=memory-embedding\nHINDSIGHT_OWNER_SALT=must-not-import\n",
		);
		const environment = localHindsightEnvironment(repoRoot);
		assert.doesNotThrow(() => assertLocalHindsightProviders(environment));
		assert.equal(environment.HINDSIGHT_API_LLM_PROVIDER, "openai-responses");
		assert.equal(environment.HINDSIGHT_OWNER_SALT, undefined);
	});
	it("projects a stable isolated Hindsight connection across repeated initialization", () => {
		const repoRoot = createRepositoryShape();
		const profile = createProfile(repoRoot);
		renderLocalEnvironmentFiles({ repoRoot, profile, target: "core", qdrant });
		const path = resolve(repoRoot, "apps/execution-control/.env.local");
		const first = parseEnv(readFileSync(path, "utf8"));
		renderLocalEnvironmentFiles({ repoRoot, profile, target: "core", qdrant });
		const next = parseEnv(readFileSync(path, "utf8"));
		assert.equal(
			first.HINDSIGHT_API_BASE_URL,
			`http://127.0.0.1:${profile.infraPorts.hindsightApi}`,
		);
		assert.ok(first.HINDSIGHT_API_TENANT_API_KEY);
		assert.ok(first.HINDSIGHT_OWNER_SALT);
		assert.equal(next.HINDSIGHT_OWNER_SALT, first.HINDSIGHT_OWNER_SALT);
		assert.equal(next.HINDSIGHT_API_TENANT_API_KEY, first.HINDSIGHT_API_TENANT_API_KEY);
		assert.ok(!resolveLocalDevTargetPlan("core").capabilities.includes("hindsight"));
		assert.ok(!resolveLocalDevTargetPlan("ops-web").capabilities.includes("hindsight"));
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
		renderLocalEnvironmentFiles({ profile: createProfile(repoRoot), qdrant, repoRoot });
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
			qdrant,
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
		assert.equal(corePaths.length, 7);
		assert.equal(existsSync(resolve(repoRoot, "apps/ops-web/.env.local")), false);
	});

	it("prepares Ops without the question runtime or background jobs", () => {
		const repoRoot = createRepositoryShape();
		const profile = createProfile(repoRoot);
		const written = renderLocalEnvironmentFiles({ repoRoot, profile, target: "ops-web" });
		assert.equal(written.length, 4);
		assert(existsSync(resolve(repoRoot, "apps/ops-web/.env.local")));
		assert(existsSync(resolve(repoRoot, "apps/model-config/.env.local")));
		assert(!existsSync(resolve(repoRoot, "apps/execution-control/.env.local")));
		assert(!existsSync(resolve(repoRoot, "jobs/document-ocr/.env.local")));
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

	it("renders new notice workers against the current worktree infrastructure", () => {
		const repoRoot = createRepositoryShape();
		const profile = createProfile(repoRoot);
		for (const target of ["notice-pipeline-worker", "notice-artifacts-worker"] as const) {
			renderLocalEnvironmentFiles({ profile, qdrant, repoRoot, target });
			const values = parseEnv(
				readFileSync(resolve(repoRoot, "apps", target, ".env.local"), "utf8"),
			);
			assert.equal(
				values.OBJECT_STORE_ENDPOINT,
				`http://127.0.0.1:${profile.infraPorts.objectStore}`,
			);
			assert.equal(values.OBJECT_STORE_BUCKET_DERIVED, profile.bucketName);
			assert.equal(
				new URL(values.NOTICES_DATABASE_URL ?? "").port,
				String(profile.infraPorts.postgres),
			);
			assert.equal(values.TEMPORAL_ADDRESS, `127.0.0.1:${profile.infraPorts.temporal}`);
			assert.equal(values.TEMPORAL_NAMESPACE, `campus-agent-local-${profile.instanceId}`);
			assert.ok(values.OBJECT_STORE_DERIVED_ACCESS_KEY);
			if (target === "notice-artifacts-worker") {
				assert.equal(values.QDRANT_URL, qdrant.url);
				assert.equal(values.QDRANT_API_KEY, qdrant.apiKey);
			}
		}
	});

	it("renders index publisher environments with only their owned fields", () => {
		const repoRoot = createRepositoryShape();
		const profile = createProfile(repoRoot);

		const campusPaths = renderLocalEnvironmentFiles({
			profile,
			repoRoot,
			target: "campus-docs-index-publisher",
		});
		assert.deepEqual(campusPaths, [
			resolve(repoRoot, "jobs/campus-docs-index-publisher/.env.local"),
		]);
		assert.deepEqual(Object.keys(parseEnv(readFileSync(campusPaths[0] ?? "", "utf8"))).sort(), [
			"EXECUTION_CONTROL_DATABASE_URL",
			"OBJECT_STORE_BUCKET_DERIVED",
			"OBJECT_STORE_DERIVED_ACCESS_KEY",
			"OBJECT_STORE_DERIVED_READ_ACCESS_KEY",
			"OBJECT_STORE_DERIVED_READ_SECRET_KEY",
			"OBJECT_STORE_DERIVED_SECRET_KEY",
			"OBJECT_STORE_ENDPOINT",
			"OBJECT_STORE_SOURCE_ACCESS_KEY",
			"OBJECT_STORE_SOURCE_SECRET_KEY",
		]);
		assert.equal(
			parseEnv(readFileSync(campusPaths[0] ?? "", "utf8")).OBJECT_STORE_ENDPOINT,
			`http://127.0.0.1:${profile.infraPorts.objectStore}`,
		);

		const noticePaths = renderLocalEnvironmentFiles({
			profile,
			repoRoot,
			target: "notice-index-publisher",
		});
		assert.deepEqual(noticePaths, [resolve(repoRoot, "jobs/notice-index-publisher/.env.local")]);
		assert.deepEqual(Object.keys(parseEnv(readFileSync(noticePaths[0] ?? "", "utf8"))).sort(), [
			"DEPLOYMENT_ENVIRONMENT",
			"NOTICES_DATABASE_SSLMODE",
			"NOTICES_DATABASE_URL",
		]);
		assert.equal(
			parseEnv(readFileSync(noticePaths[0] ?? "", "utf8")).NOTICES_DATABASE_SSLMODE,
			"disable",
		);

		const ragPaths = renderLocalEnvironmentFiles({
			profile,
			qdrant,
			repoRoot,
			target: "campus-rag-index-publisher",
		});
		assert.deepEqual(ragPaths, [resolve(repoRoot, "jobs/campus-rag-index-publisher/.env.local")]);
		assert.deepEqual(Object.keys(parseEnv(readFileSync(ragPaths[0] ?? "", "utf8"))).sort(), [
			"EXECUTION_CONTROL_DATABASE_URL",
			"OBJECT_STORE_BUCKET_DERIVED",
			"OBJECT_STORE_DERIVED_ACCESS_KEY",
			"OBJECT_STORE_DERIVED_READ_ACCESS_KEY",
			"OBJECT_STORE_DERIVED_READ_SECRET_KEY",
			"OBJECT_STORE_DERIVED_SECRET_KEY",
			"OBJECT_STORE_ENDPOINT",
			"OBJECT_STORE_SOURCE_ACCESS_KEY",
			"OBJECT_STORE_SOURCE_SECRET_KEY",
			"QDRANT_API_KEY",
			"QDRANT_URL",
		]);
		const ragPath = ragPaths[0] ?? "";
		let ragEnvironment = parseEnv(readFileSync(ragPath, "utf8"));
		assert.equal(ragEnvironment.QDRANT_API_KEY, qdrant.apiKey);
		assert.equal(ragEnvironment.QDRANT_URL, qdrant.url);
		assert.equal(ragEnvironment.OBJECT_STORE_BUCKET_DERIVED, profile.bucketName);
		renderLocalEnvironmentFiles({
			profile,
			qdrant: { apiKey: "rotated-fixture-writer", url: "http://127.0.0.1:26333" },
			repoRoot,
			target: "campus-rag-index-publisher",
		});
		ragEnvironment = parseEnv(readFileSync(ragPath, "utf8"));
		assert.equal(ragEnvironment.QDRANT_API_KEY, "rotated-fixture-writer");
		assert.equal(ragEnvironment.QDRANT_URL, "http://127.0.0.1:26333");
	});

	it("does not generate a placeholder Qdrant key when its connection is missing", () => {
		const repoRoot = createRepositoryShape();
		assert.throws(
			() =>
				renderLocalEnvironmentFiles({
					profile: createProfile(repoRoot),
					repoRoot,
					target: "campus-rag-index-publisher",
				}),
			/requires a resolved local Qdrant connection/u,
		);
		assert.equal(existsSync(managedLocalEnvironmentPaths(repoRoot).campusRagIndexPublisher), false);
	});

	it("does not inspect unrelated developer-owned environments for an index target", () => {
		const repoRoot = createRepositoryShape();
		const opsWebPath = resolve(repoRoot, "apps/ops-web/.env.local");
		writeFileSync(opsWebPath, "USER_OWNED=1\n");

		const rendered = renderLocalEnvironmentFiles({
			profile: createProfile(repoRoot),
			repoRoot,
			target: "campus-docs-index-publisher",
		});

		assert.deepEqual(rendered, [resolve(repoRoot, "jobs/campus-docs-index-publisher/.env.local")]);
		assert.equal(readFileSync(opsWebPath, "utf8"), "USER_OWNED=1\n");
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
	it("composes consumer requirements without starting their runtime dependencies", () => {
		const ops = resolveLocalDevTargetPlan("ops-web");
		assert.deepEqual(ops.environmentProjections, ["app-api", "model-config", "ops-web"]);
		assert(!ops.capabilities.includes("qdrant"));
		assert(!ops.capabilities.includes("hindsight"));
		assert.deepEqual(ops.modelConfigNames, []);
		assert.deepEqual(resolveLocalDevTargetPlan("document-ocr").modelConfigNames, ["document_ocr"]);
		assert(
			resolveLocalDevTargetPlan("campus-rag-index-publisher").bootstrapSteps.includes(
				"campus-agent-schema",
			),
		);
		assert(
			!resolveLocalDevTargetPlan("notice-artifacts-worker").environmentProjections.includes(
				"notice-pipeline-worker",
			),
		);
		for (const target of LOCAL_DEV_TARGETS) {
			const plan = resolveLocalDevTargetPlan(target);
			assert(!plan.bootstrapSteps.includes("model-config-seed"));
			assert(!plan.bootstrapSteps.includes("model-config-check"));
		}
	});

	it("keeps the lifecycle facade limited to init, diagnosis, and destruction", () => {
		assert.deepEqual(Object.keys(lifecycle).sort(), [
			"destroyLocalDevelopment",
			"diagnoseLocalDevelopment",
			"initializeLocalDevelopmentTarget",
			"pruneLocalDevelopment",
		]);
	});

	it("runs application bootstrap in explicit dependency order", () => {
		const commands = localApplicationBootstrapCommands("/repo", createProfile("/repo"));
		assert.deepEqual(
			commands.map(({ step }) => step),
			["campus-agent-schema", "app-api-seed-local-test-user", "notice-publisher-seed-local"],
		);
		assert.match(commands[1]?.args.join(" ") ?? "", /seed-local-test-user\.ts/u);
		assert.deepEqual(commands[2]?.args, [
			"--dir",
			"jobs/notice-publisher",
			"exec",
			"tsx",
			"src/seed-local.ts",
		]);
		assert.equal(commands[2]?.options.env?.NOTICES_DATABASE_SSLMODE, "disable");

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
			["campus-agent-schema", "app-api-seed-local-test-user"],
		);
		assert.equal(
			coreCommands.some(({ step }) => step.startsWith("model-config-")),
			false,
		);

		const classifierPlan = resolveLocalDevTargetPlan("notice-classifier");
		const classifierCommands = localApplicationBootstrapCommands(
			"/repo",
			createProfile("/repo"),
			classifierPlan.bootstrapSteps,
			classifierPlan.modelConfigNames,
		);
		assert.equal(
			classifierCommands.some(({ step }) => step.startsWith("model-config-")),
			false,
		);
		const opsWebPlan = resolveLocalDevTargetPlan("ops-web");
		assert.deepEqual(
			localApplicationBootstrapCommands(
				"/repo",
				createProfile("/repo"),
				opsWebPlan.bootstrapSteps.filter((step) => step !== "temporal-namespace"),
				opsWebPlan.modelConfigNames,
			).map(({ step }) => step),
			["campus-agent-schema", "app-api-seed-local-test-user"],
		);
	});

	it("keeps the internal portal collection local loader inside its adapter", () => {
		const source = readFileSync(
			resolve(
				import.meta.dirname,
				"../../../jobs/internal-portal-collection/adapters/internal-portal/src/config.ts",
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
				resolve(import.meta.dirname, "../../../apps/execution-control/package.json"),
				"utf8",
			),
		) as { scripts?: { dev?: string } };
		const agentPackage = JSON.parse(
			readFileSync(
				resolve(import.meta.dirname, "../../../apps/agent-runtime/package.json"),
				"utf8",
			),
		) as { scripts?: { dev?: string } };
		const opsWebPackage = readPackageJson("apps/ops-web/package.json");
		const campusDocsIndexPublisherPackage = readPackageJson(
			"jobs/campus-docs-index-publisher/package.json",
		);
		const noticeIndexPublisherPackage = readPackageJson("jobs/notice-index-publisher/package.json");
		assert.match(schemaPackage.scripts?.status ?? "", /tsx src\/cli\.ts status/u);
		assert.equal(appApiPackage.scripts?.dev, "bash scripts/dev.sh");
		const appApiDev = readFileSync(
			resolve(import.meta.dirname, "../../../apps/app-api/scripts/dev.sh"),
			"utf8",
		);
		assert.match(appApiDev, /exec wrangler dev/u);
		assert.match(appApiDev, /\. \.\/\.dev\.vars\.local/u);
		assert.match(appApiDev, /--var "EXECUTION_CONTROL_BASE_URL:\$EXECUTION_CONTROL_BASE_URL"/u);
		assert.match(campusWebPackage.scripts?.dev ?? "", /\bvite\b/u);
		assert.equal(executionPackage.scripts?.dev, "bash scripts/dev.sh");
		assert.match(
			readFileSync(
				resolve(import.meta.dirname, "../../../apps/execution-control/scripts/dev.sh"),
				"utf8",
			),
			/go build -o .*execution-api \.\/cmd\/execution-api/u,
		);
		assert.match(agentPackage.scripts?.dev ?? "", /(?:^|\s)--experimental-strip-types(?:\s|$)/u);
		assert.match(agentPackage.scripts?.dev ?? "", /(?:^|\s)src\/server\.ts$/u);
		assert.equal(opsWebPackage.scripts?.dev, undefined);
		assert.match(opsWebPackage.scripts?.["dev:api"] ?? "", /--experimental-strip-types/u);
		assert.equal(campusDocsIndexPublisherPackage.scripts?.["dev:init"], undefined);
		assert.equal(noticeIndexPublisherPackage.scripts?.["dev:init"], undefined);
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
	return JSON.parse(
		readFileSync(resolve(import.meta.dirname, "../../..", relativePath), "utf8"),
	) as {
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
		"notice-pipeline-worker",
	]) {
		mkdirSync(resolve(repoRoot, "apps", app), { recursive: true });
	}
	mkdirSync(resolve(repoRoot, "jobs/internal-portal-collection/adapters/internal-portal"), {
		recursive: true,
	});
	for (const job of ["notice-classifier", "notice-publisher", "document-ocr"]) {
		mkdirSync(resolve(repoRoot, "jobs", job), { recursive: true });
	}
	for (const job of [
		"campus-docs-index-publisher",
		"campus-rag-index-publisher",
		"notice-index-publisher",
	]) {
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

function createProfile(worktreePath: string): LocalDevProfile {
	return {
		bucketName: "campus-agent-derived-wt-1-deadbeef",
		createdAt: "2026-07-20T00:00:00.000Z",
		databaseName: "campus_agent_wt_1_deadbeef",
		instanceId: "dining-production-deadbeef",
		infraPorts: calculateLocalDevInfrastructurePorts(1),
		infraProject: "campus-agent-wt-deadbeef",
		ports: calculateLocalDevPorts(1),
		repoKey: "repo-key",
		resourceKey: "deadbeef",
		schemaVersion: 3,
		slot: 1,
		sourceBucketName: "campus-agent-source-wt-1-deadbeef",
		worktreePath,
	};
}
