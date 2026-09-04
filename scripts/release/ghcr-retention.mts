import { execFile as execFileCallback } from "node:child_process";
import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { ACTIVE_IMAGE_TARGETS } from "./image-targets.mts";

const execFile = promisify(execFileCallback);

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RELEASE_TAG_PATTERN = /^[0-9a-f]{40}$/u;
const PACKAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const GIT_REF_PATTERN = /^[A-Za-z0-9._/-]+$/u;
const CACHE_TAG = "buildcache-arm64";
const PACKAGE_PREFIX = "campus-agent/";
const DEFAULT_OWNER = "MUC-WIKI";
const DEFAULT_REPOSITORY = "MUC-WIKI/campus-agent";
const DEFAULT_KEEP_RELEASES = 5;
const DEFAULT_UNTAGGED_GRACE_DAYS = 7;
const GITOPS_SCAN_ROOT = "clusters";

export const RETIRED_IMAGE_NAMES = [
	"app-api-schema",
	"dining-sync",
	"docs-publish",
	"ingestion-control",
	"ingestion-control-worker",
	"source-collector",
] as const;

export const ACTIVE_PACKAGE_NAMES = ACTIVE_IMAGE_TARGETS.map(
	(image) => `${PACKAGE_PREFIX}${image}`,
);

export const RETIRED_PACKAGE_NAMES = RETIRED_IMAGE_NAMES.map(
	(image) => `${PACKAGE_PREFIX}${image}`,
);

export interface PackageVersion {
	id: number;
	name: string;
	createdAt: string;
	updatedAt: string;
	tags: string[];
}

export interface PackageInventory {
	name: string;
	versions: PackageVersion[];
}

export interface ManifestChild {
	digest: string;
	mediaType?: string;
}

export interface ManifestInspection {
	mediaType?: string;
	manifests: ManifestChild[];
}

export type ImagePackageKind = "active" | "retired" | "unmanaged";
export type VersionAction = "keep" | "delete";

export interface VersionDecision {
	action: VersionAction;
	createdAt: string;
	digest: string;
	id: number;
	reason: string;
	tags: string[];
	updatedAt: string;
}

export interface PackageRetentionPlan {
	classification: ImagePackageKind;
	name: string;
	packageAction: "absent" | "hold" | "retain" | "delete";
	protectedManifestDigests: string[];
	protectedRootDigests: string[];
	versionCount: number;
	versions: VersionDecision[];
}

export interface RetentionPlan {
	generatedAt: string;
	mode: "apply" | "report";
	packages: PackageRetentionPlan[];
	policy: {
		cacheTag: string;
		keepLatestReleases: number;
		untaggedGraceDays: number;
	};
	protectedDigests: Record<string, string[]>;
	schemaVersion: 1;
	totals: {
		deletePackages: number;
		deleteVersions: number;
		keepVersions: number;
		packages: number;
		versions: number;
	};
	errors: string[];
}

interface CommandResult {
	code: number;
	stderr: string;
	stdout: string;
}

export type CommandRunner = (
	command: string,
	args: string[],
	options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

interface ProtectedRootSelection {
	byPackage: Record<string, string[]>;
	latestByPackage: Record<string, string[]>;
	gitopsByPackage: Record<string, string[]>;
	cacheByPackage: Record<string, string[]>;
	errors: string[];
}

interface RetentionPlanningInput {
	manifestClosure?: Record<string, readonly string[]>;
	mode?: "apply" | "report";
	now?: Date;
	packages: readonly PackageInventory[];
	gitopsDigests?: Record<string, readonly string[]>;
	keepLatestReleases?: number;
	untaggedGraceDays?: number;
}

function commandError(command: string, args: string[], result: CommandResult): Error {
	const detail =
		[result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n") ||
		`exit code ${result.code}`;
	return new Error(`${command} ${args.join(" ")} failed: ${detail}`);
}

async function runCommand(
	command: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
	try {
		const result = await execFile(command, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			maxBuffer: 32 * 1024 * 1024,
		});
		return { code: 0, stderr: result.stderr, stdout: result.stdout };
	} catch (error) {
		const value = error as { code?: number | string; stderr?: string; stdout?: string };
		return {
			code: typeof value.code === "number" ? value.code : 1,
			stderr: value.stderr ?? "",
			stdout: value.stdout ?? "",
		};
	}
}

function parsePagedJson(source: string, context: string): unknown[] {
	let value: unknown;
	try {
		value = JSON.parse(source) as unknown;
	} catch (error) {
		throw new Error(`Invalid JSON from ${context}`, { cause: error });
	}
	if (!Array.isArray(value)) {
		throw new Error(`${context} must return an array`);
	}
	if (value.every((entry) => Array.isArray(entry))) {
		return value.flat();
	}
	return value;
}

function parseObject(source: string, context: string): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(source) as unknown;
	} catch (error) {
		throw new Error(`Invalid JSON from ${context}`, { cause: error });
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${context} must return an object`);
	}
	return value as Record<string, unknown>;
}

function versionFromApi(value: unknown, context: string): PackageVersion {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${context} must be an object`);
	}
	const record = value as Record<string, unknown>;
	const metadata = record.metadata;
	const container =
		typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
			? (metadata as Record<string, unknown>).container
			: undefined;
	const rawTags =
		typeof container === "object" && container !== null && !Array.isArray(container)
			? (container as Record<string, unknown>).tags
			: [];
	if (
		typeof record.id !== "number" ||
		!Number.isSafeInteger(record.id) ||
		typeof record.name !== "string" ||
		typeof record.created_at !== "string" ||
		typeof record.updated_at !== "string" ||
		!Array.isArray(rawTags) ||
		!rawTags.every((tag) => typeof tag === "string")
	) {
		throw new Error(`${context} has an invalid package version shape`);
	}
	return {
		id: record.id,
		name: record.name,
		createdAt: record.created_at,
		updatedAt: record.updated_at,
		tags: [...new Set(rawTags as string[])].sort(),
	};
}

function packageNameFromApi(value: unknown, context: string): string | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${context} must be an object`);
	}
	const name = (value as Record<string, unknown>).name;
	if (typeof name !== "string") {
		throw new Error(`${context} has an invalid package name`);
	}
	if (!name.startsWith(PACKAGE_PREFIX)) {
		return undefined;
	}
	const image = name.slice(PACKAGE_PREFIX.length);
	if (!PACKAGE_NAME_PATTERN.test(image)) {
		throw new Error(`${context} has an invalid image package name`);
	}
	return name;
}

async function ghJson(args: string[], runner: CommandRunner): Promise<unknown> {
	const result = await runner("gh", ["api", "--paginate", "--slurp", ...args]);
	if (result.code !== 0) {
		throw commandError("gh", ["api", "--paginate", "--slurp", ...args], result);
	}
	return JSON.parse(result.stdout) as unknown;
}

export async function readPackageInventory(
	owner = DEFAULT_OWNER,
	runner: CommandRunner = runCommand,
): Promise<PackageInventory[]> {
	const packageResponse = await ghJson(
		[`orgs/${owner}/packages?package_type=container&per_page=100`],
		runner,
	);
	const packageValues = parsePagedJson(JSON.stringify(packageResponse), "GitHub package list");
	const packageNames = packageValues
		.map((value, index) => packageNameFromApi(value, `GitHub package list[${index}]`))
		.filter((name): name is string => name !== undefined)
		.sort();
	const inventories: PackageInventory[] = [];
	for (const packageName of packageNames) {
		const encoded = encodeURIComponent(packageName);
		const versionResponse = await ghJson(
			[`orgs/${owner}/packages/container/${encoded}/versions?per_page=100`],
			runner,
		);
		const versionValues = parsePagedJson(
			JSON.stringify(versionResponse),
			`GitHub versions for ${packageName}`,
		);
		inventories.push({
			name: packageName,
			versions: versionValues.map((value, index) =>
				versionFromApi(value, `${packageName} versions[${index}]`),
			),
		});
	}
	return inventories;
}

function addDigest(result: Map<string, Set<string>>, image: string, digest: string): void {
	if (!(PACKAGE_NAME_PATTERN.test(image) && DIGEST_PATTERN.test(digest))) {
		return;
	}
	const packageName = `${PACKAGE_PREFIX}${image}`;
	const digests = result.get(packageName) ?? new Set<string>();
	digests.add(digest);
	result.set(packageName, digests);
}

export function extractGitopsImageDigests(source: string): Record<string, string[]> {
	const result = new Map<string, Set<string>>();
	const inlinePattern =
		/ghcr\.io\/muc-wiki\/campus-agent\/([a-z0-9][a-z0-9-]*)@(sha256:[0-9a-f]{64})/gu;
	for (const match of source.matchAll(inlinePattern)) {
		const image = match[1];
		const digest = match[2];
		if (image && digest) {
			addDigest(result, image, digest);
		}
	}
	const kustomizePattern =
		/(?:^|\n)\s*-\s+name:\s+ghcr\.io\/muc-wiki\/campus-agent\/([a-z0-9][a-z0-9-]*)\s*\r?\n\s+digest:\s+(sha256:[0-9a-f]{64})(?=\s|$)/gmu;
	for (const match of source.matchAll(kustomizePattern)) {
		const image = match[1];
		const digest = match[2];
		if (image && digest) {
			addDigest(result, image, digest);
		}
	}
	return Object.fromEntries(
		[...result.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([name, digests]) => [name, [...digests].sort()]),
	);
}

function validateGitRef(ref: string): void {
	if (!GIT_REF_PATTERN.test(ref) || ref.includes("..")) {
		throw new Error(`Invalid GitOps ref: ${ref}`);
	}
}

function mergeDigestMaps(
	target: Map<string, Set<string>>,
	source: Record<string, readonly string[]>,
): void {
	for (const [packageName, digests] of Object.entries(source)) {
		const current = target.get(packageName) ?? new Set<string>();
		for (const digest of digests) {
			if (DIGEST_PATTERN.test(digest)) {
				current.add(digest);
			}
		}
		target.set(packageName, current);
	}
}

export async function readGitopsImageDigests(
	root: string,
	refs: readonly string[],
	runner: CommandRunner = runCommand,
): Promise<Record<string, string[]>> {
	const result = new Map<string, Set<string>>();
	for (const ref of refs) {
		validateGitRef(ref);
		const filesResult = await runner(
			"git",
			["ls-tree", "-r", "--name-only", ref, "--", GITOPS_SCAN_ROOT],
			{ cwd: root },
		);
		if (filesResult.code !== 0) {
			throw commandError("git", ["ls-tree", "-r", "--name-only", ref], filesResult);
		}
		const files = filesResult.stdout
			.split("\n")
			.map((file) => file.trim())
			.filter((file) => /\.(?:json|ya?ml)$/u.test(file));
		for (const file of files) {
			const sourceResult = await runner("git", ["show", `${ref}:${file}`], { cwd: root });
			if (sourceResult.code !== 0) {
				throw commandError("git", ["show", `${ref}:${file}`], sourceResult);
			}
			mergeDigestMaps(result, extractGitopsImageDigests(sourceResult.stdout));
		}
	}
	return Object.fromEntries(
		[...result.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([name, digests]) => [name, [...digests].sort()]),
	);
}

function packageKind(name: string): ImagePackageKind {
	if (ACTIVE_PACKAGE_NAMES.includes(name)) {
		return "active";
	}
	if (RETIRED_PACKAGE_NAMES.includes(name)) {
		return "retired";
	}
	return "unmanaged";
}

function sortedReleaseVersions(versions: readonly PackageVersion[]): PackageVersion[] {
	return versions
		.filter((version) => version.tags.some((tag) => RELEASE_TAG_PATTERN.test(tag)))
		.sort((left, right) => {
			const rightTime = Date.parse(right.updatedAt);
			const leftTime = Date.parse(left.updatedAt);
			return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
		});
}

function packageDigests(packages: readonly PackageInventory[], packageName: string): Set<string> {
	const inventory = packages.find((candidate) => candidate.name === packageName);
	return new Set(inventory?.versions.map((version) => version.name) ?? []);
}

export function protectedRootsForInventory(input: {
	gitopsDigests?: Record<string, readonly string[]>;
	keepLatestReleases?: number;
	packages: readonly PackageInventory[];
}): ProtectedRootSelection {
	const keepLatestReleases = input.keepLatestReleases ?? DEFAULT_KEEP_RELEASES;
	if (!Number.isSafeInteger(keepLatestReleases) || keepLatestReleases < 0) {
		throw new Error("keepLatestReleases must be a non-negative integer");
	}
	const gitops = input.gitopsDigests ?? {};
	const byPackage = new Map<string, Set<string>>();
	const latestByPackage = new Map<string, Set<string>>();
	const gitopsByPackage = new Map<string, Set<string>>();
	const cacheByPackage = new Map<string, Set<string>>();
	const errors: string[] = [];

	for (const inventory of input.packages) {
		if (packageKind(inventory.name) !== "active") {
			continue;
		}
		const latest = new Set(
			sortedReleaseVersions(inventory.versions)
				.slice(0, keepLatestReleases)
				.map((version) => version.name),
		);
		latestByPackage.set(inventory.name, latest);
		const cache = new Set(
			inventory.versions
				.filter((version) => version.tags.includes(CACHE_TAG))
				.map((version) => version.name),
		);
		cacheByPackage.set(inventory.name, cache);
		const selectedGitops = new Set(gitops[inventory.name] ?? []);
		gitopsByPackage.set(inventory.name, selectedGitops);
		byPackage.set(inventory.name, new Set([...latest, ...cache, ...selectedGitops]));
	}

	for (const [name, digests] of Object.entries(gitops)) {
		const kind = packageKind(name);
		if (kind === "unmanaged") {
			errors.push(`GitOps references unmanaged package ${name}`);
			continue;
		}
		if (kind === "retired" && digests.length > 0) {
			errors.push(`GitOps still references retired package ${name}`);
			continue;
		}
		if (!input.packages.some((inventory) => inventory.name === name)) {
			errors.push(`GitOps references package absent from GHCR inventory ${name}`);
		}
	}

	for (const [name, roots] of byPackage) {
		const knownDigests = packageDigests(input.packages, name);
		for (const digest of roots) {
			if (!DIGEST_PATTERN.test(digest)) {
				errors.push(`Protected root for ${name} is not a digest: ${digest}`);
			} else if (!knownDigests.has(digest)) {
				errors.push(`Protected root for ${name} is absent from GHCR inventory: ${digest}`);
			}
		}
	}

	return {
		byPackage: Object.fromEntries(
			[...byPackage.entries()].map(([name, digests]) => [name, [...digests].sort()]),
		),
		cacheByPackage: Object.fromEntries(
			[...cacheByPackage.entries()].map(([name, digests]) => [name, [...digests].sort()]),
		),
		errors,
		gitopsByPackage: Object.fromEntries(
			[...gitopsByPackage.entries()].map(([name, digests]) => [name, [...digests].sort()]),
		),
		latestByPackage: Object.fromEntries(
			[...latestByPackage.entries()].map(([name, digests]) => [name, [...digests].sort()]),
		),
	};
}

function isIndexMediaType(mediaType: string | undefined): boolean {
	return (
		mediaType === "application/vnd.oci.image.index.v1+json" ||
		mediaType === "application/vnd.docker.distribution.manifest.list.v2+json"
	);
}

export function parseManifestInspection(source: string, context: string): ManifestInspection {
	const value = parseObject(source, context);
	const rawManifest = value.manifest;
	if (typeof rawManifest !== "object" || rawManifest === null || Array.isArray(rawManifest)) {
		throw new Error(`${context} does not contain a manifest`);
	}
	const manifest = rawManifest as Record<string, unknown>;
	const rawChildren = manifest.manifests;
	if (rawChildren === undefined) {
		return {
			mediaType: typeof manifest.mediaType === "string" ? manifest.mediaType : undefined,
			manifests: [],
		};
	}
	if (!Array.isArray(rawChildren)) {
		throw new Error(`${context}.manifest.manifests must be an array`);
	}
	const manifests: ManifestChild[] = [];
	for (const [index, rawChild] of rawChildren.entries()) {
		if (typeof rawChild !== "object" || rawChild === null || Array.isArray(rawChild)) {
			throw new Error(`${context}.manifest.manifests[${index}] must be an object`);
		}
		const child = rawChild as Record<string, unknown>;
		if (typeof child.digest !== "string" || !DIGEST_PATTERN.test(child.digest)) {
			throw new Error(`${context}.manifest.manifests[${index}] has an invalid digest`);
		}
		manifests.push({
			digest: child.digest,
			mediaType: typeof child.mediaType === "string" ? child.mediaType : undefined,
		});
	}
	return {
		mediaType: typeof manifest.mediaType === "string" ? manifest.mediaType : undefined,
		manifests,
	};
}

export async function fetchManifestClosure(
	rootDigests: Record<string, readonly string[]>,
	repository = DEFAULT_REPOSITORY,
	runner: CommandRunner = runCommand,
): Promise<Record<string, string[]>> {
	if (!REPOSITORY_PATTERN.test(repository)) {
		throw new Error(`Invalid repository: ${repository}`);
	}
	const closure = new Map<string, Set<string>>();
	for (const [packageName, roots] of Object.entries(rootDigests)) {
		const image = packageName.startsWith(PACKAGE_PREFIX)
			? packageName.slice(PACKAGE_PREFIX.length)
			: packageName;
		if (!PACKAGE_NAME_PATTERN.test(image)) {
			throw new Error(`Invalid image package name: ${packageName}`);
		}
		const queue = [...new Set(roots)];
		const seen = new Set<string>();
		while (queue.length > 0) {
			const digest = queue.shift();
			if (!digest || seen.has(digest)) {
				continue;
			}
			if (!DIGEST_PATTERN.test(digest)) {
				throw new Error(`Invalid manifest digest for ${packageName}: ${digest}`);
			}
			seen.add(digest);
			const reference = `ghcr.io/${repository.toLowerCase()}/${image}@${digest}`;
			const args = ["buildx", "imagetools", "inspect", reference, "--format", "{{json .}}"];
			const inspected = await runner("docker", args);
			if (inspected.code !== 0) {
				throw commandError("docker", args, inspected);
			}
			const manifest = parseManifestInspection(
				inspected.stdout,
				`Docker manifest inspection for ${reference}`,
			);
			const packageClosure = closure.get(packageName) ?? new Set<string>();
			packageClosure.add(digest);
			for (const child of manifest.manifests) {
				packageClosure.add(child.digest);
				if (child.mediaType === undefined || isIndexMediaType(child.mediaType)) {
					queue.push(child.digest);
				}
			}
			closure.set(packageName, packageClosure);
		}
	}
	return Object.fromEntries(
		[...closure.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([name, digests]) => [name, [...digests].sort()]),
	);
}

function decision(version: PackageVersion, action: VersionAction, reason: string): VersionDecision {
	return {
		action,
		createdAt: version.createdAt,
		digest: version.name,
		id: version.id,
		reason,
		tags: version.tags,
		updatedAt: version.updatedAt,
	};
}

function isRecent(version: PackageVersion, cutoff: number): boolean {
	const updatedAt = Date.parse(version.updatedAt);
	return !Number.isNaN(updatedAt) && updatedAt >= cutoff;
}

function expectedPackageErrors(packages: readonly PackageInventory[]): string[] {
	const observed = new Set(packages.map((inventory) => inventory.name));
	const errors: string[] = [];
	for (const name of ACTIVE_PACKAGE_NAMES) {
		if (!observed.has(name)) {
			errors.push(`Active package is absent from GHCR inventory: ${name}`);
		}
	}
	for (const name of observed) {
		if (packageKind(name) === "unmanaged") {
			errors.push(`GHCR package is not registered in the retention policy: ${name}`);
		}
	}
	return errors;
}

export function planRetention(input: RetentionPlanningInput): RetentionPlan {
	const keepLatestReleases = input.keepLatestReleases ?? DEFAULT_KEEP_RELEASES;
	const untaggedGraceDays = input.untaggedGraceDays ?? DEFAULT_UNTAGGED_GRACE_DAYS;
	const mode = input.mode ?? "report";
	const now = input.now ?? new Date();
	if (!Number.isSafeInteger(keepLatestReleases) || keepLatestReleases < 0) {
		throw new Error("keepLatestReleases must be a non-negative integer");
	}
	if (!Number.isSafeInteger(untaggedGraceDays) || untaggedGraceDays < 0) {
		throw new Error("untaggedGraceDays must be a non-negative integer");
	}
	const roots = protectedRootsForInventory({
		gitopsDigests: input.gitopsDigests,
		keepLatestReleases,
		packages: input.packages,
	});
	const cutoff = now.getTime() - untaggedGraceDays * 24 * 60 * 60 * 1_000;
	const errors = [...expectedPackageErrors(input.packages), ...roots.errors];
	const packages = [...input.packages]
		.sort((left, right) => left.name.localeCompare(right.name))
		.map<PackageRetentionPlan>((inventory) => {
			const classification = packageKind(inventory.name);
			const rootDigests = new Set(roots.byPackage[inventory.name] ?? []);
			const manifestDigests = new Set(input.manifestClosure?.[inventory.name] ?? []);
			for (const digest of rootDigests) {
				manifestDigests.add(digest);
			}
			const gitopsDigests = new Set(roots.gitopsByPackage[inventory.name] ?? []);
			const latestDigests = new Set(roots.latestByPackage[inventory.name] ?? []);
			const cacheDigests = new Set(roots.cacheByPackage[inventory.name] ?? []);
			const versions = inventory.versions
				.slice()
				.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
				.map((version) => {
					if (classification === "retired") {
						return decision(version, "keep", "retired-package-will-be-deleted-as-a-whole");
					}
					if (classification === "unmanaged") {
						return decision(version, "keep", "unmanaged-package-policy-error");
					}
					if (!DIGEST_PATTERN.test(version.name)) {
						errors.push(
							`Active package version has an invalid digest: ${inventory.name}/${version.id}`,
						);
						return decision(version, "keep", "invalid-digest-policy-error");
					}
					if (gitopsDigests.has(version.name)) {
						return decision(version, "keep", "gitops-desired-state");
					}
					if (cacheDigests.has(version.name)) {
						return decision(version, "keep", "current-build-cache");
					}
					if (latestDigests.has(version.name)) {
						return decision(version, "keep", "latest-release-window");
					}
					if (manifestDigests.has(version.name)) {
						return decision(version, "keep", "child-of-protected-manifest");
					}
					const unknownTags = version.tags.filter(
						(tag) => tag !== CACHE_TAG && !RELEASE_TAG_PATTERN.test(tag),
					);
					if (unknownTags.length > 0) {
						return decision(version, "keep", `unknown-tag:${unknownTags.join(",")}`);
					}
					if (version.tags.some((tag) => RELEASE_TAG_PATTERN.test(tag))) {
						return decision(version, "delete", "outside-release-window");
					}
					if (isRecent(version, cutoff)) {
						return decision(version, "keep", "untagged-grace-period");
					}
					return decision(version, "delete", "expired-untagged-version");
				});
			const packageAction =
				classification === "retired"
					? "delete"
					: classification === "unmanaged"
						? "hold"
						: "retain";
			return {
				classification,
				name: inventory.name,
				packageAction,
				protectedManifestDigests: [...manifestDigests].sort(),
				protectedRootDigests: [...rootDigests].sort(),
				versionCount: inventory.versions.length,
				versions,
			};
		});

	for (const name of RETIRED_PACKAGE_NAMES) {
		if (!packages.some((inventory) => inventory.name === name)) {
			packages.push({
				classification: "retired",
				name,
				packageAction: "absent",
				protectedManifestDigests: [],
				protectedRootDigests: [],
				versionCount: 0,
				versions: [],
			});
		}
	}
	packages.sort((left, right) => left.name.localeCompare(right.name));
	const deletePackages = packages.filter((plan) => plan.packageAction === "delete").length;
	const allVersions = packages.flatMap((plan) => plan.versions);
	const deleteVersions = allVersions.filter((version) => version.action === "delete").length;
	const keepVersions = allVersions.length - deleteVersions;
	return {
		generatedAt: now.toISOString(),
		mode,
		packages,
		policy: {
			cacheTag: CACHE_TAG,
			keepLatestReleases,
			untaggedGraceDays,
		},
		protectedDigests: Object.fromEntries(
			Object.entries(input.manifestClosure ?? {})
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([name, digests]) => [name, [...new Set(digests)].sort()]),
		),
		schemaVersion: 1,
		totals: {
			deletePackages,
			deleteVersions,
			keepVersions,
			packages: packages.length,
			versions: allVersions.length,
		},
		errors: [...new Set(errors)].sort(),
	};
}

function planDeletions(plan: RetentionPlan): {
	packages: string[];
	versions: Array<{ id: number; packageName: string; digest: string }>;
} {
	return {
		packages: plan.packages
			.filter((candidate) => candidate.packageAction === "delete")
			.map((candidate) => candidate.name),
		versions: plan.packages.flatMap((candidate) =>
			candidate.versions
				.filter((version) => version.action === "delete")
				.map((version) => ({
					digest: version.digest,
					id: version.id,
					packageName: candidate.name,
				})),
		),
	};
}

export async function applyRetentionPlan(
	plan: RetentionPlan,
	owner: string,
	runner: CommandRunner = runCommand,
): Promise<void> {
	if (plan.mode !== "apply") {
		throw new Error("Refusing to apply a report plan; generate the plan with --mode apply");
	}
	if (plan.errors.length > 0) {
		throw new Error(`Refusing to apply a plan with policy errors:\n${plan.errors.join("\n")}`);
	}
	const deletions = planDeletions(plan);
	for (const packageName of deletions.packages) {
		const args = [
			"api",
			"--method",
			"DELETE",
			`orgs/${owner}/packages/container/${encodeURIComponent(packageName)}`,
		];
		const result = await runner("gh", args);
		if (result.code !== 0) {
			throw commandError("gh", args, result);
		}
	}
	for (const version of deletions.versions) {
		const args = [
			"api",
			"--method",
			"DELETE",
			`orgs/${owner}/packages/container/${encodeURIComponent(version.packageName)}/versions/${version.id}`,
		];
		const result = await runner("gh", args);
		if (result.code !== 0) {
			throw commandError("gh", args, result);
		}
	}
}

function markdownSummary(plan: RetentionPlan): string {
	const lines = [
		"### GHCR retention",
		"",
		`- Mode: ${plan.mode}`,
		`- Packages: ${plan.totals.packages}; versions: ${plan.totals.versions}`,
		`- Planned package deletes: ${plan.totals.deletePackages}`,
		`- Planned version deletes: ${plan.totals.deleteVersions}`,
		`- Protected release window: latest ${plan.policy.keepLatestReleases} per active package plus GitOps digests and OCI children`,
		`- Untagged grace period: ${plan.policy.untaggedGraceDays} days`,
		"- Retired packages: explicit allowlist; apply deletes each package as a whole",
		"",
		"| Package | Class | Versions | Action | Delete versions | Protected roots |",
		"| --- | --- | ---: | --- | ---: | ---: |",
	];
	for (const candidate of plan.packages) {
		lines.push(
			`| \`${candidate.name}\` | ${candidate.classification} | ${candidate.versionCount} | ${candidate.packageAction} | ${candidate.versions.filter((version) => version.action === "delete").length} | ${candidate.protectedRootDigests.length} |`,
		);
	}
	if (plan.errors.length > 0) {
		lines.push("", "#### Policy errors", "", ...plan.errors.map((error) => `- ${error}`));
	}
	return `${lines.join("\n")}\n`;
}

function valueAfter(args: string[], index: number, flag: string): string {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`Missing value for ${flag}`);
	}
	return value;
}

function positiveInteger(value: string, flag: string, allowZero = true): number {
	if (!/^[0-9]+$/u.test(value)) {
		throw new Error(`${flag} must be an integer`);
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || (!allowZero && parsed < 1)) {
		throw new Error(`${flag} is out of range`);
	}
	return parsed;
}

interface CliOptions {
	gitopsRefs: string[];
	gitopsRoot: string;
	keepLatestReleases: number;
	mode: "apply" | "report";
	output: string;
	owner: string;
	repository: string;
	summary?: string;
	untaggedGraceDays: number;
}

function parseArgs(args: string[]): CliOptions {
	const options: CliOptions = {
		gitopsRefs: [],
		gitopsRoot: "gitops",
		keepLatestReleases: DEFAULT_KEEP_RELEASES,
		mode: "report",
		output: "ghcr-retention.json",
		owner: DEFAULT_OWNER,
		repository: DEFAULT_REPOSITORY,
		untaggedGraceDays: DEFAULT_UNTAGGED_GRACE_DAYS,
	};
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		switch (argument) {
			case "--gitops-ref":
				options.gitopsRefs.push(valueAfter(args, index, argument));
				index += 1;
				break;
			case "--gitops-root":
				options.gitopsRoot = valueAfter(args, index, argument);
				index += 1;
				break;
			case "--keep-releases":
				options.keepLatestReleases = positiveInteger(valueAfter(args, index, argument), argument);
				index += 1;
				break;
			case "--mode": {
				const value = valueAfter(args, index, argument);
				if (value !== "report" && value !== "apply") {
					throw new Error("--mode must be report or apply");
				}
				options.mode = value;
				index += 1;
				break;
			}
			case "--output":
				options.output = valueAfter(args, index, argument);
				index += 1;
				break;
			case "--owner":
				options.owner = valueAfter(args, index, argument);
				index += 1;
				break;
			case "--repository":
				options.repository = valueAfter(args, index, argument);
				index += 1;
				break;
			case "--summary":
				options.summary = valueAfter(args, index, argument);
				index += 1;
				break;
			case "--untagged-grace-days":
				options.untaggedGraceDays = positiveInteger(valueAfter(args, index, argument), argument);
				index += 1;
				break;
			default:
				throw new Error(`Unsupported argument: ${argument}`);
		}
	}
	if (!REPOSITORY_PATTERN.test(options.repository)) {
		throw new Error(`Invalid repository: ${options.repository}`);
	}
	if (!options.owner || options.owner.includes("/")) {
		throw new Error(`Invalid owner: ${options.owner}`);
	}
	for (const ref of options.gitopsRefs) {
		validateGitRef(ref);
	}
	if (options.gitopsRefs.length === 0) {
		options.gitopsRefs.push("main");
	}
	return options;
}

async function main(args: string[]): Promise<void> {
	const options = parseArgs(args);
	const gitopsDigests = await readGitopsImageDigests(options.gitopsRoot, options.gitopsRefs);
	const inventory = await readPackageInventory(options.owner);
	const roots = protectedRootsForInventory({
		gitopsDigests,
		keepLatestReleases: options.keepLatestReleases,
		packages: inventory,
	});
	const manifestClosure = await fetchManifestClosure(roots.byPackage, options.repository);
	const plan = planRetention({
		manifestClosure,
		mode: options.mode,
		now: new Date(),
		packages: inventory,
		gitopsDigests,
		keepLatestReleases: options.keepLatestReleases,
		untaggedGraceDays: options.untaggedGraceDays,
	});
	await writeFile(path.resolve(options.output), `${JSON.stringify(plan, null, 2)}\n`);
	if (options.summary) {
		await appendFile(path.resolve(options.summary), markdownSummary(plan));
	}
	if (plan.errors.length > 0) {
		throw new Error(`GHCR retention plan has policy errors:\n${plan.errors.join("\n")}`);
	}
	if (options.mode === "apply") {
		await applyRetentionPlan(plan, options.owner, runCommand);
		const after = await readPackageInventory(options.owner);
		const afterByName = new Map(after.map((candidate) => [candidate.name, candidate]));
		const deletions = planDeletions(plan);
		for (const packageName of deletions.packages) {
			if (afterByName.has(packageName)) {
				throw new Error(`Package deletion did not complete: ${packageName}`);
			}
		}
		for (const deletion of deletions.versions) {
			const version = afterByName
				.get(deletion.packageName)
				?.versions.find((candidate) => candidate.id === deletion.id);
			if (version) {
				throw new Error(
					`Package version deletion did not complete: ${deletion.packageName}/${deletion.id}`,
				);
			}
		}
		for (const candidate of plan.packages) {
			if (candidate.packageAction !== "retain") {
				continue;
			}
			const versions = afterByName.get(candidate.name)?.versions ?? [];
			const digests = new Set(versions.map((version) => version.name));
			for (const digest of candidate.protectedManifestDigests) {
				if (!digests.has(digest)) {
					throw new Error(`Protected digest disappeared after apply: ${candidate.name}@${digest}`);
				}
			}
		}
		const afterManifestClosure = await fetchManifestClosure(roots.byPackage, options.repository);
		for (const [packageName, protectedDigests] of Object.entries(manifestClosure)) {
			const observed = new Set(afterManifestClosure[packageName] ?? []);
			for (const digest of protectedDigests) {
				if (!observed.has(digest)) {
					throw new Error(`Protected manifest disappeared after apply: ${packageName}@${digest}`);
				}
			}
		}
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
