import { execFile as execFileCallback } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { ACTIVE_IMAGE_TARGETS } from "./image-targets.mts";

const execFile = promisify(execFileCallback);

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CANDIDATE_TAG_PATTERN = /^[0-9a-f]{40}$/u;
const PACKAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const GIT_REF_PATTERN = /^[A-Za-z0-9._/-]+$/u;
const CACHE_TAG = "buildcache-arm64";
const PACKAGE_PREFIX = "campus-agent/";
const DEFAULT_OWNER = "MUC-WIKI";
const DEFAULT_REPOSITORY = "MUC-WIKI/campus-agent";
const DEFAULT_UNTAGGED_GRACE_DAYS = 0;
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

export type ImagePackageKind = "active" | "retired" | "unmanaged" | "pr-cache";

export interface SourcePullRequest {
	state: "open" | "closed";
	closedAt: string | null;
}
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
	gitopsByPackage: Record<string, string[]>;
	cacheByPackage: Record<string, string[]>;
	errors: string[];
}

interface RetentionPlanningInput {
	pullRequests?: Record<string, SourcePullRequest>;
	manifestClosure?: Record<string, readonly string[]>;
	mode?: "apply" | "report";
	now?: Date;
	packages: readonly PackageInventory[];
	gitopsDigests?: Record<string, readonly string[]>;
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

export class GitHubApiError extends Error {
	readonly status: number | undefined;
	constructor(args: string[], result: CommandResult) {
		super(commandError("gh", args, result).message);
		const match = /\(HTTP (\d{3})\)/u.exec(result.stderr);
		this.status = match ? Number(match[1]) : undefined;
	}
}

async function ghJson(args: string[], runner: CommandRunner): Promise<unknown> {
	const result = await runner("gh", ["api", "--paginate", "--slurp", ...args]);
	if (result.code !== 0) {
		throw new GitHubApiError(["api", "--paginate", "--slurp", ...args], result);
	}
	return JSON.parse(result.stdout) as unknown;
}

export async function readPackageInventory(
	owner = DEFAULT_OWNER,
	runner: CommandRunner = runCommand,
	prNumber?: string,
): Promise<PackageInventory[]> {
	if (!(prNumber && /^[1-9][0-9]*$/u.test(prNumber))) {
		throw new Error(
			"PR cache cleanup requires a positive PR number; full inventory requires the registered-package reader.",
		);
	}
	const packageNames = ACTIVE_IMAGE_TARGETS.map(
		(image) => `${PACKAGE_PREFIX}pr-cache-${prNumber}/${image}`,
	).sort();
	const inventories: PackageInventory[] = [];
	for (const packageName of packageNames) {
		const encoded = encodeURIComponent(packageName);
		let metadata: unknown;
		try {
			const pages = await ghJson([`orgs/${owner}/packages/container/${encoded}`], runner);
			metadata = Array.isArray(pages) ? pages[0] : pages;
		} catch (error) {
			if (error instanceof GitHubApiError && error.status === 404) {
				continue;
			}
			throw error;
		}
		if (
			!metadata ||
			typeof metadata !== "object" ||
			!("name" in metadata) ||
			metadata.name !== packageName
		) {
			throw new Error(`Invalid package metadata for ${packageName}`);
		}
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

export async function readKnownPackageInventory(
	owner = DEFAULT_OWNER,
	runner: CommandRunner = runCommand,
): Promise<PackageInventory[]> {
	const packageNames = [...new Set([...ACTIVE_PACKAGE_NAMES, ...RETIRED_PACKAGE_NAMES])].sort();
	const inventories: PackageInventory[] = [];
	for (const packageName of packageNames) {
		const encoded = encodeURIComponent(packageName);
		let metadata: unknown;
		try {
			const pages = await ghJson([`orgs/${owner}/packages/container/${encoded}`], runner);
			metadata = Array.isArray(pages) ? pages[0] : pages;
		} catch (error) {
			if (error instanceof GitHubApiError && error.status === 404) {
				continue;
			}
			throw error;
		}
		if (
			!metadata ||
			typeof metadata !== "object" ||
			!("name" in metadata) ||
			metadata.name !== packageName
		) {
			throw new Error(`Invalid package metadata for ${packageName}`);
		}
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

function cachePullRequest(name: string): string | undefined {
	const match = /^campus-agent\/pr-cache-([1-9][0-9]*)\/([a-z0-9-]+)$/u.exec(name);
	return match && ACTIVE_IMAGE_TARGETS.some((image) => image === match[2]) ? match[1] : undefined;
}

export async function readCachePullRequests(
	packages: readonly PackageInventory[],
	repository = DEFAULT_REPOSITORY,
	runner: CommandRunner = runCommand,
): Promise<Record<string, SourcePullRequest>> {
	const requests: Record<string, SourcePullRequest> = {};
	for (const number of new Set(
		packages.map((pkg) => cachePullRequest(pkg.name)).filter((number) => number !== undefined),
	)) {
		let value: unknown;
		try {
			value = await ghJson([`repos/${repository}/pulls/${number}`], runner);
		} catch {
			// An absent entry becomes a reported policy error and prevents apply.
			continue;
		}
		const record = Array.isArray(value) ? value[0] : value;
		if (
			!record ||
			typeof record !== "object" ||
			(record.state !== "open" && record.state !== "closed") ||
			(record.closed_at !== null && typeof record.closed_at !== "string")
		) {
			continue;
		}
		requests[number] = { state: record.state, closedAt: record.closed_at };
	}
	return requests;
}

function packageKind(name: string): ImagePackageKind {
	if (cachePullRequest(name) !== undefined) {
		return "pr-cache";
	}
	if (ACTIVE_PACKAGE_NAMES.includes(name)) {
		return "active";
	}
	if (RETIRED_PACKAGE_NAMES.includes(name)) {
		return "retired";
	}
	return "unmanaged";
}

function packageDigests(packages: readonly PackageInventory[], packageName: string): Set<string> {
	const inventory = packages.find((candidate) => candidate.name === packageName);
	return new Set(inventory?.versions.map((version) => version.name) ?? []);
}

export function protectedRootsForInventory(input: {
	gitopsDigests?: Record<string, readonly string[]>;
	packages: readonly PackageInventory[];
}): ProtectedRootSelection {
	const gitops = input.gitopsDigests ?? {};
	const byPackage = new Map<string, Set<string>>();
	const gitopsByPackage = new Map<string, Set<string>>();
	const cacheByPackage = new Map<string, Set<string>>();
	const errors: string[] = [];

	for (const inventory of input.packages) {
		if (!["active", "retired", "pr-cache"].includes(packageKind(inventory.name))) {
			continue;
		}
		const cache = new Set(
			inventory.versions
				.filter((version) => version.tags.includes(CACHE_TAG))
				.map((version) => version.name),
		);
		cacheByPackage.set(inventory.name, cache);
		const selectedGitops = new Set(gitops[inventory.name] ?? []);
		gitopsByPackage.set(inventory.name, selectedGitops);
		byPackage.set(inventory.name, new Set([...cache, ...selectedGitops]));
	}

	for (const [name] of Object.entries(gitops)) {
		const kind = packageKind(name);
		if (kind === "unmanaged") {
			errors.push(`GitOps references unmanaged package ${name}`);
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
		if (!PACKAGE_NAME_PATTERN.test(image) && cachePullRequest(packageName) === undefined) {
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
	const untaggedGraceDays = input.untaggedGraceDays ?? DEFAULT_UNTAGGED_GRACE_DAYS;
	const mode = input.mode ?? "report";
	const now = input.now ?? new Date();
	if (!Number.isSafeInteger(untaggedGraceDays) || untaggedGraceDays < 0) {
		throw new Error("untaggedGraceDays must be a non-negative integer");
	}
	const roots = protectedRootsForInventory({
		gitopsDigests: input.gitopsDigests,
		packages: input.packages,
	});
	const cutoff = now.getTime() - untaggedGraceDays * 24 * 60 * 60 * 1_000;
	const errors = [...expectedPackageErrors(input.packages), ...roots.errors];
	const packages = [...input.packages]
		.sort((left, right) => left.name.localeCompare(right.name))
		.map<PackageRetentionPlan>((inventory) => {
			const classification = packageKind(inventory.name);
			const prNumber = cachePullRequest(inventory.name);
			const pr = prNumber ? input.pullRequests?.[prNumber] : undefined;
			const validPr =
				pr &&
				(pr.state === "open" || (pr.closedAt !== null && Number.isFinite(Date.parse(pr.closedAt))));
			const expiredPr =
				validPr && pr.state === "closed" && Date.parse(pr.closedAt as string) <= cutoff;
			if (classification === "pr-cache" && !validPr) {
				errors.push(`Source PR state unavailable for cache package: ${inventory.name}`);
			}
			const rootDigests = new Set(roots.byPackage[inventory.name] ?? []);
			const manifestDigests = new Set(input.manifestClosure?.[inventory.name] ?? []);
			for (const digest of rootDigests) {
				manifestDigests.add(digest);
			}
			const gitopsDigests = new Set(roots.gitopsByPackage[inventory.name] ?? []);
			const cacheDigests = new Set(roots.cacheByPackage[inventory.name] ?? []);
			const versions = inventory.versions
				.slice()
				.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
				.map((version) => {
					if (classification === "pr-cache" && (!validPr || expiredPr)) {
						return decision(
							version,
							"keep",
							expiredPr
								? "closed-pr-package-will-be-deleted-as-a-whole"
								: "source-pr-state-unavailable",
						);
					}
					if (classification === "retired" && manifestDigests.size === 0) {
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
						return decision(version, "keep", "release-or-deployment-root");
					}
					if (cacheDigests.has(version.name)) {
						return decision(version, "keep", "current-build-cache");
					}
					if (manifestDigests.has(version.name)) {
						return decision(version, "keep", "child-of-protected-manifest");
					}
					const unknownTags = version.tags.filter(
						(tag) => tag !== CACHE_TAG && !CANDIDATE_TAG_PATTERN.test(tag),
					);
					if (unknownTags.length > 0) {
						return decision(version, "keep", `unknown-tag:${unknownTags.join(",")}`);
					}
					if (version.tags.some((tag) => CANDIDATE_TAG_PATTERN.test(tag))) {
						return decision(version, "delete", "unreferenced-candidate");
					}
					if (isRecent(version, cutoff)) {
						return decision(version, "keep", "untagged-grace-period");
					}
					return decision(version, "delete", "expired-untagged-version");
				});
			const packageAction =
				(classification === "retired" && manifestDigests.size === 0) || expiredPr
					? "delete"
					: classification === "unmanaged" || (classification === "pr-cache" && !validPr)
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

export interface PrCacheCleanupInput {
	mode: "apply" | "report";
	now?: Date;
	packages: readonly PackageInventory[];
	prNumber: string;
	pullRequests?: Record<string, SourcePullRequest>;
}

export function planPrCacheCleanup(input: PrCacheCleanupInput): RetentionPlan {
	const now = input.now ?? new Date();
	const errors: string[] = [];
	let packageAction: PackageRetentionPlan["packageAction"] = "delete";
	const scoped = input.packages.filter(
		(inventory) => cachePullRequest(inventory.name) === input.prNumber,
	);
	if (scoped.length > 0) {
		const pr = input.pullRequests?.[input.prNumber];
		if (
			!(
				pr &&
				(pr.state === "open" || (pr.closedAt !== null && Number.isFinite(Date.parse(pr.closedAt))))
			)
		) {
			errors.push(`Source PR state unavailable for cache cleanup: ${input.prNumber}`);
			packageAction = "hold";
		} else if (pr.state !== "closed") {
			errors.push(`Source PR is not closed for cache cleanup: ${input.prNumber}`);
			packageAction = "hold";
		}
	}
	const packages = scoped
		.sort((left, right) => left.name.localeCompare(right.name))
		.map<PackageRetentionPlan>((inventory) => ({
			classification: "pr-cache",
			name: inventory.name,
			packageAction,
			protectedManifestDigests: [],
			protectedRootDigests: [],
			versionCount: inventory.versions.length,
			versions: [...inventory.versions]
				.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
				.map((version) =>
					decision(version, "keep", "closed-pr-package-will-be-deleted-as-a-whole"),
				),
		}));
	const allVersions = packages.flatMap((plan) => plan.versions);
	return {
		generatedAt: now.toISOString(),
		mode: input.mode,
		packages,
		policy: {
			cacheTag: CACHE_TAG,
			untaggedGraceDays: 0,
		},
		protectedDigests: {},
		schemaVersion: 1,
		totals: {
			deletePackages: packages.filter((plan) => plan.packageAction === "delete").length,
			deleteVersions: 0,
			keepVersions: allVersions.length,
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
		"- Policy: protect non-retired formal releases, deployment/recovery roots, manifest children and current caches",
		`- Result: ${plan.errors.length > 0 ? "failed; planned actions may be incomplete" : "completed"}`,
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

interface CliOptions {
	mode: "apply" | "report";
	output: string;
	owner: string;
	prCachePr: string;
	scope: "full" | "pr";
	repository: string;
	gitopsRoot: string;
	releaseRoots: string;
	untaggedGraceDays: number;
	summary?: string;
}

export function parseArgs(args: string[]): CliOptions {
	const options: CliOptions = {
		mode: "report",
		prCachePr: "",
		scope: "pr",
		output: "ghcr-retention.json",
		owner: DEFAULT_OWNER,
		repository: DEFAULT_REPOSITORY,
		gitopsRoot: "",
		releaseRoots: "",
		untaggedGraceDays: DEFAULT_UNTAGGED_GRACE_DAYS,
	};
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		switch (argument) {
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
			case "--pr-cache-pr": {
				const value = valueAfter(args, index, argument);
				if (!/^[1-9][0-9]*$/u.test(value)) {
					throw new Error(`${argument} must be a pull request number`);
				}
				options.prCachePr = value;
				index += 1;
				break;
			}
			case "--scope": {
				const value = valueAfter(args, index, argument);
				if (value !== "full" && value !== "pr") {
					throw new Error("--scope must be full or pr");
				}
				options.scope = value;
				index += 1;
				break;
			}
			case "--release-roots":
				options.releaseRoots = valueAfter(args, index, argument);
				index += 1;
				break;
			case "--gitops-root":
				options.gitopsRoot = valueAfter(args, index, argument);
				index += 1;
				break;
			case "--untagged-grace-days": {
				const value = valueAfter(args, index, argument);
				if (!/^[0-9]+$/u.test(value)) {
					throw new Error("--untagged-grace-days must be a non-negative integer");
				}
				options.untaggedGraceDays = Number(value);
				index += 1;
				break;
			}
			case "--repository":
				options.repository = valueAfter(args, index, argument);
				index += 1;
				break;
			case "--summary":
				options.summary = valueAfter(args, index, argument);
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
	if (options.scope === "pr" && !options.prCachePr) {
		throw new Error("--pr-cache-pr is required for --scope pr");
	}
	if (options.scope === "full" && options.prCachePr) {
		throw new Error("--pr-cache-pr cannot be used with --scope full");
	}
	if (options.scope === "full" && options.untaggedGraceDays !== 0) {
		throw new Error("Full retention uses release and deployment roots, not an age window");
	}
	if (options.scope === "full" && !(options.gitopsRoot && options.releaseRoots)) {
		throw new Error("--gitops-root and --release-roots are required for --scope full");
	}
	return options;
}

export function mergeReleaseRoots(
	gitopsDigests: Record<string, string[]>,
	exportedRoots: Record<string, unknown>,
	packages: readonly PackageInventory[],
): void {
	const releaseRoots = parseObject(JSON.stringify(exportedRoots.images), "release image roots");
	const candidates = exportedRoots.candidateSourceShas;
	if (
		!Array.isArray(candidates) ||
		candidates.some((sha) => typeof sha !== "string" || !CANDIDATE_TAG_PATTERN.test(sha))
	) {
		throw new Error("Invalid candidate recovery Source SHAs");
	}
	for (const inventory of packages) {
		const pending = inventory.versions
			.filter((version) => version.tags.some((tag) => candidates.includes(tag)))
			.map((version) => version.name);
		if (pending.length > 0) {
			gitopsDigests[inventory.name] = [
				...new Set([...(gitopsDigests[inventory.name] ?? []), ...pending]),
			];
		}
	}
	for (const [name, values] of Object.entries(releaseRoots)) {
		if (
			!Array.isArray(values) ||
			values.some((value) => typeof value !== "string" || !DIGEST_PATTERN.test(value))
		) {
			throw new Error(`Invalid release roots for ${name}`);
		}
		gitopsDigests[name] = [
			...new Set([...(gitopsDigests[name] ?? []), ...(values as string[])]),
		].sort();
	}
}

export function intersectRetentionPlans(
	before: RetentionPlan,
	fresh: RetentionPlan,
): RetentionPlan {
	const plan = structuredClone(fresh);
	plan.errors = [...new Set([...before.errors, ...fresh.errors])];
	for (const pkg of plan.packages) {
		const previous = before.packages.find((entry) => entry.name === pkg.name);
		if (
			pkg.packageAction === "delete" &&
			(previous?.packageAction !== "delete" ||
				pkg.versions.some(
					(version) =>
						!previous.versions.some(
							(old) => old.id === version.id && old.digest === version.digest,
						),
				))
		) {
			pkg.packageAction = "retain";
		}
		for (const version of pkg.versions) {
			if (
				version.action === "delete" &&
				!previous?.versions.some(
					(old) =>
						old.id === version.id && old.digest === version.digest && old.action === "delete",
				)
			) {
				version.action = "keep";
				version.reason = "not-in-initial-deletion-plan";
			}
		}
	}
	plan.totals.deletePackages = plan.packages.filter((pkg) => pkg.packageAction === "delete").length;
	plan.totals.deleteVersions = plan.packages
		.flatMap((pkg) => pkg.versions)
		.filter((v) => v.action === "delete").length;
	plan.totals.keepVersions = plan.totals.versions - plan.totals.deleteVersions;
	return plan;
}

export function verifyRetentionDeletion(plan: RetentionPlan, inventory: PackageInventory[]): void {
	const inventoryErrors = expectedPackageErrors(inventory);
	if (inventoryErrors.length > 0) {
		throw new Error(inventoryErrors.join("\n"));
	}
	const deleted = planDeletions(plan);
	for (const name of deleted.packages) {
		if (inventory.some((pkg) => pkg.name === name)) {
			throw new Error(`Package deletion did not complete: ${name}`);
		}
	}
	for (const version of deleted.versions) {
		if (
			inventory
				.find((pkg) => pkg.name === version.packageName)
				?.versions.some((item) => item.id === version.id)
		) {
			throw new Error(`Version deletion did not complete: ${version.packageName}/${version.id}`);
		}
	}
	for (const pkg of plan.packages) {
		const remaining = new Set(
			inventory.find((item) => item.name === pkg.name)?.versions.map((v) => v.name),
		);
		for (const digest of new Set([...pkg.protectedRootDigests, ...pkg.protectedManifestDigests])) {
			if (!remaining.has(digest)) {
				throw new Error(`Protected digest disappeared: ${pkg.name}@${digest}`);
			}
		}
	}
}

export async function refreshedFullPlan(
	options: CliOptions,
	runner: CommandRunner,
): Promise<RetentionPlan> {
	const root = path.resolve(options.gitopsRoot);
	const execute = async (command: string, args: string[], env?: NodeJS.ProcessEnv) => {
		const result = await runner(command, args, { env });
		if (result.code !== 0) {
			throw commandError(command, args, result);
		}
		return result.stdout;
	};
	// Source publication and deletion share one workflow lock. GitOps is a separate
	// owner, so refresh its selection and recovery references on every plan read.
	const gitopsEnv = { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN };
	const main = parseObject(
		await execute("gh", ["api", "repos/MUC-WIKI/campus-agent-gitops/commits/main"], gitopsEnv),
		"GitOps main",
	);
	if (typeof main.sha !== "string" || !/^[a-f0-9]{40}$/u.test(main.sha)) {
		throw new Error("Invalid GitOps main SHA");
	}
	await execute(
		"git",
		[
			"-C",
			root,
			"-c",
			"credential.helper=",
			"-c",
			"credential.helper=!gh auth git-credential",
			"fetch",
			"--prune",
			"origin",
		],
		gitopsEnv,
	);
	const previous = (await execute("git", ["-C", root, "rev-parse", "HEAD"])).trim();
	await execute("git", ["-C", root, "checkout", "--detach", main.sha]);
	if (previous !== main.sha) {
		await execute("pnpm", ["--dir", root, "install", "--frozen-lockfile"]);
	}
	await execute("pnpm", [
		"--dir",
		root,
		"exec",
		"tsx",
		"tools/release-command.ts",
		"roots",
		"--root",
		root,
		"--output",
		path.resolve(options.releaseRoots),
	]);
	const refs = ["HEAD"];
	const branches = await execute("git", [
		"-C",
		root,
		"for-each-ref",
		"--format=%(refname)",
		"refs/remotes/origin/deploy/staging",
	]);
	if (branches.trim()) {
		refs.push("origin/deploy/staging");
	}
	const packages = await readKnownPackageInventory(options.owner, runner);
	const gitopsDigests = await readGitopsImageDigests(root, refs, runner);
	mergeReleaseRoots(
		gitopsDigests,
		parseObject(await readFile(options.releaseRoots, "utf8"), "release roots"),
		packages,
	);
	const roots = protectedRootsForInventory({ gitopsDigests, packages });
	if (roots.errors.length > 0) {
		throw new Error(roots.errors.join("\n"));
	}
	const manifestClosure = await fetchManifestClosure(roots.byPackage, options.repository, runner);
	return planRetention({
		gitopsDigests,
		manifestClosure,
		mode: options.mode,
		packages,
		untaggedGraceDays: 0,
	});
}

export async function runFullRetention(
	options: CliOptions,
	runtime: {
		runner?: CommandRunner;
		readPlan?: () => Promise<RetentionPlan>;
		readInventory?: () => Promise<PackageInventory[]>;
	} = {},
): Promise<void> {
	const runner = runtime.runner ?? runCommand;
	const readPlan = runtime.readPlan ?? (() => refreshedFullPlan(options, runner));
	let plan = planRetention({ mode: options.mode, packages: [] });
	let phase = "read retention plan";
	try {
		plan = await readPlan();
		if (plan.errors.length > 0) {
			throw new Error(plan.errors.join("\n"));
		}
		await writeFile(path.resolve(options.output), `${JSON.stringify(plan, null, 2)}\n`);
		if (options.mode === "apply") {
			phase = "refresh deletion references";
			plan = intersectRetentionPlans(plan, await readPlan());
			await writeFile(path.resolve(options.output), `${JSON.stringify(plan, null, 2)}\n`);
			phase = "apply retention plan";
			await applyRetentionPlan(plan, options.owner, runner);
			phase = "verify deletion and retained digests";
			verifyRetentionDeletion(
				plan,
				await (runtime.readInventory?.() ?? readKnownPackageInventory(options.owner, runner)),
			);
		}
	} catch (error) {
		plan.errors.push(`${phase}: ${error instanceof Error ? error.message : String(error)}`);
	}
	await writeFile(path.resolve(options.output), `${JSON.stringify(plan, null, 2)}\n`);
	if (options.summary) {
		await appendFile(path.resolve(options.summary), markdownSummary(plan));
	}
	if (plan.errors.length > 0) {
		throw new Error(`GHCR retention failed:\n${plan.errors.join("\n")}`);
	}
}

async function main(args: string[]): Promise<void> {
	const options = parseArgs(args);
	if (options.scope === "pr") {
		await runPrCacheCleanup(options, options.prCachePr);
	} else {
		await runFullRetention(options);
	}
}

interface CleanupRuntime {
	runner?: CommandRunner;
}

async function readEligiblePr(
	repository: string,
	prNumber: string,
	runner: CommandRunner,
): Promise<SourcePullRequest> {
	const pages = await ghJson([`repos/${repository}/pulls/${prNumber}`], runner);
	const pr = (Array.isArray(pages) ? pages[0] : pages) as {
		state?: string;
		closed_at?: string;
		head?: { repo?: { full_name?: string } };
		user?: { login?: string };
	};
	if (pr?.state !== "closed") {
		throw new Error(`Source PR is not closed for cache cleanup: ${prNumber}`);
	}
	if (pr.head?.repo?.full_name !== repository || pr.user?.login === "dependabot[bot]") {
		throw new Error(`Source PR is not eligible for cache cleanup: ${prNumber}`);
	}
	if (!(pr.closed_at && Number.isFinite(Date.parse(pr.closed_at)))) {
		throw new Error(`Invalid closed_at for PR ${prNumber}`);
	}
	return { state: "closed", closedAt: pr.closed_at };
}

export async function runPrCacheCleanup(
	options: Pick<CliOptions, "owner" | "repository" | "mode" | "output" | "summary">,
	prNumber: string,
	runtime: CleanupRuntime = {},
): Promise<void> {
	const runner = runtime.runner ?? runCommand;
	let plan = planPrCacheCleanup({ mode: options.mode, packages: [], prNumber });
	let phase = "validate PR";
	try {
		if (!/^[1-9][0-9]*$/u.test(prNumber)) {
			throw new Error("Invalid PR number");
		}
		await readEligiblePr(options.repository, prNumber, runner);
		phase = "read PR cache packages";
		const packages = await readPackageInventory(options.owner, runner, prNumber);
		phase = "recheck PR";
		const pr = await readEligiblePr(options.repository, prNumber, runner);
		plan = planPrCacheCleanup({
			mode: options.mode,
			packages,
			prNumber,
			pullRequests: { [prNumber]: pr },
		});
		phase = "write cleanup plan";
		await writeFile(path.resolve(options.output), `${JSON.stringify(plan, null, 2)}\n`);
		if (options.mode === "apply") {
			phase = "delete PR cache packages";
			await applyRetentionPlan(plan, options.owner, runner);
			phase = "verify deletion";
			const after = new Set(
				(await readPackageInventory(options.owner, runner, prNumber)).map((pkg) => pkg.name),
			);
			for (const candidate of plan.packages) {
				if (after.has(candidate.name)) {
					throw new Error(`Package deletion did not complete: ${candidate.name}`);
				}
			}
		}
	} catch (error) {
		plan.errors.push(`${phase}: ${error instanceof Error ? error.message : String(error)}`);
	}
	await writeFile(path.resolve(options.output), `${JSON.stringify(plan, null, 2)}\n`);
	if (options.summary) {
		await appendFile(path.resolve(options.summary), markdownSummary(plan));
	}
	if (plan.errors.length > 0) {
		throw new Error(`GHCR cleanup policy errors:\n${plan.errors.join("\n")}`);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
