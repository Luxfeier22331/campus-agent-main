import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
	assertDiningWayfindingLayout,
	canonicalizeDiningWayfindingLayout,
	type DiningWayfindingLayout,
	renderDiningWayfindingSvg,
	sanitizeDiningFloorplanSvg,
	serializeDiningWayfindingLayout,
} from "@campus-agent/dining/floorplans";

const PACKAGE_ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "../..");
const DINING_PACKAGE_ROOT = join(REPOSITORY_ROOT, "packages/domains/dining");
const execFileAsync = promisify(execFile);
let floorplanOperationTail: Promise<void> = Promise.resolve();

export const DINING_LAYOUT_DIRECTORY = join(DINING_PACKAGE_ROOT, "src/floorplans/layouts");
export const DINING_GENERATED_ASSET_MANIFEST = join(
	DINING_PACKAGE_ROOT,
	"src/floorplans/generated-assets.json",
);
export const DINING_PUBLIC_ASSET_DIRECTORY = join(
	REPOSITORY_ROOT,
	"apps/campus-web/public/assets/dining",
);

export interface GeneratedDiningFloorplanAsset {
	anchorInventory: Array<{ anchorId: string; label?: string; role: "window" }>;
	canvas: { height: number; width: number };
	floorId: string;
	floorplanId: string;
	hallId: string;
	sha256: `sha256:${string}`;
}

interface CurrentDiningFloorplanAssetRef {
	floorplanId: string;
	hallId: string;
	sha256: string;
}

export interface DiningWayfindingLayoutDocument {
	assetStatus: "current" | "stale";
	layout: DiningWayfindingLayout;
	revision: `sha256:${string}`;
}

export interface DiningFloorplanGenerationResult {
	assets: GeneratedDiningFloorplanAsset[];
	removedUntrackedAssets: string[];
}

export class DiningLayoutRevisionConflictError extends Error {
	constructor() {
		super("Dining layout changed after it was loaded.");
		this.name = "DiningLayoutRevisionConflictError";
	}
}

export async function readDiningWayfindingLayouts(): Promise<DiningWayfindingLayout[]> {
	const filenames = (await readdir(DINING_LAYOUT_DIRECTORY))
		.filter((filename) => filename.endsWith(".json"))
		.sort();
	const layouts: DiningWayfindingLayout[] = [];
	for (const filename of filenames) {
		const raw = JSON.parse(
			await readFile(join(DINING_LAYOUT_DIRECTORY, filename), "utf8"),
		) as unknown;
		assertDiningWayfindingLayout(raw);
		const layout = canonicalizeDiningWayfindingLayout(raw);
		if (`${layout.floorId}.json` !== filename) {
			throw new Error(`Dining layout filename must match floorId: ${filename}`);
		}
		layouts.push(layout);
	}
	if (layouts.length === 0) {
		throw new Error("No dining wayfinding layouts were found.");
	}
	return layouts;
}

export async function readDiningWayfindingLayoutDocuments(): Promise<
	DiningWayfindingLayoutDocument[]
> {
	const layouts = await readDiningWayfindingLayouts();
	const currentAssets = await readCurrentGeneratedAssets();
	return layouts.map((layout) => toLayoutDocument(layout, currentAssets));
}

export function saveDiningWayfindingLayout(input: {
	baseRevision: string;
	layout: DiningWayfindingLayout;
}): Promise<DiningWayfindingLayoutDocument> {
	return runFloorplanOperation(() => saveDiningWayfindingLayoutSource(input));
}

async function saveDiningWayfindingLayoutSource(input: {
	baseRevision: string;
	layout: DiningWayfindingLayout;
}): Promise<DiningWayfindingLayoutDocument> {
	const canonical = canonicalizeDiningWayfindingLayout(input.layout);
	const current = (await readDiningWayfindingLayouts()).find(
		(layout) => layout.floorId === canonical.floorId,
	);
	if (!current) {
		throw new Error("Dining layout does not exist.");
	}
	if (current.hallId !== canonical.hallId || current.floorplanId !== canonical.floorplanId) {
		throw new Error("Dining layout identity cannot be changed by the local editor.");
	}
	if (layoutRevision(current) !== input.baseRevision) {
		throw new DiningLayoutRevisionConflictError();
	}
	await atomicWrite(
		join(DINING_LAYOUT_DIRECTORY, `${canonical.floorId}.json`),
		serializeDiningWayfindingLayout(canonical),
	);
	return toLayoutDocument(canonical, await readCurrentGeneratedAssets());
}

export function generateDiningFloorplanAssets(input?: {
	check?: boolean;
	layouts?: DiningWayfindingLayout[];
}): Promise<DiningFloorplanGenerationResult> {
	return runFloorplanOperation(() => generateDiningFloorplanAssetsFromSource(input));
}

async function generateDiningFloorplanAssetsFromSource(input?: {
	check?: boolean;
	layouts?: DiningWayfindingLayout[];
}): Promise<DiningFloorplanGenerationResult> {
	const layouts = input?.layouts ?? (await readDiningWayfindingLayouts());
	const generated = layouts
		.map((layout) => {
			const canonical = canonicalizeDiningWayfindingLayout(layout);
			const svgMarkup = sanitizeDiningFloorplanSvg(renderDiningWayfindingSvg(canonical));
			const digest = createHash("sha256").update(svgMarkup).digest("hex");
			return {
				assetPath: join(DINING_PUBLIC_ASSET_DIRECTORY, `${digest}.svg`),
				metadata: {
					anchorInventory: canonical.windows.map((window) => ({
						anchorId: window.anchorId,
						label: window.label,
						role: "window" as const,
					})),
					canvas: canonical.canvas,
					floorId: canonical.floorId,
					floorplanId: canonical.floorplanId,
					hallId: canonical.hallId,
					sha256: `sha256:${digest}` as const,
				},
				svgMarkup,
			};
		})
		.sort((left, right) => left.metadata.floorId.localeCompare(right.metadata.floorId));

	const metadata = `${JSON.stringify(
		{ assets: generated.map((item) => item.metadata), schemaVersion: 2 },
		null,
		"\t",
	)}\n`;
	if (input?.check) {
		const failures: string[] = [];
		await Promise.all(
			generated.map(async (item) => {
				const current = await readOptionalFile(item.assetPath);
				if (current !== item.svgMarkup) {
					failures.push(`stale asset ${item.metadata.floorId}`);
				}
			}),
		);
		if ((await readOptionalFile(DINING_GENERATED_ASSET_MANIFEST)) !== metadata) {
			failures.push("stale generated-assets.json");
		}
		if (failures.length > 0) {
			throw new Error(`Dining floorplan generation check failed: ${failures.sort().join(", ")}`);
		}
		const orphanAssets = await listUntrackedDigestAssets(
			new Set(generated.map((item) => basename(item.assetPath))),
		);
		if (orphanAssets.length > 0) {
			throw new Error(
				`Dining floorplan generation check failed: untracked orphan assets ${orphanAssets.join(", ")}`,
			);
		}
		return { assets: generated.map((item) => item.metadata), removedUntrackedAssets: [] };
	}

	await mkdir(DINING_PUBLIC_ASSET_DIRECTORY, { recursive: true });
	for (const item of generated) {
		const existing = await readOptionalFile(item.assetPath);
		if (existing !== null && existing !== item.svgMarkup) {
			throw new Error(`Digest-addressed dining asset cannot be overwritten: ${item.assetPath}`);
		}
		if (existing === null) {
			await atomicWrite(item.assetPath, item.svgMarkup);
		}
	}
	await atomicWrite(DINING_GENERATED_ASSET_MANIFEST, metadata);
	const orphanAssets = await listUntrackedDigestAssets(
		new Set(generated.map((item) => basename(item.assetPath))),
	);
	for (const filename of orphanAssets) {
		await unlink(join(DINING_PUBLIC_ASSET_DIRECTORY, filename));
	}
	return {
		assets: generated.map((item) => item.metadata),
		removedUntrackedAssets: orphanAssets,
	};
}

function toLayoutDocument(
	layout: DiningWayfindingLayout,
	currentAssets: ReadonlyMap<string, CurrentDiningFloorplanAssetRef>,
): DiningWayfindingLayoutDocument {
	const expectedDigest = createHash("sha256")
		.update(sanitizeDiningFloorplanSvg(renderDiningWayfindingSvg(layout)))
		.digest("hex");
	const current = currentAssets.get(layout.floorId);
	return {
		assetStatus:
			current?.floorplanId === layout.floorplanId &&
			current.hallId === layout.hallId &&
			current.sha256 === expectedDigest
				? "current"
				: "stale",
		layout,
		revision: layoutRevision(layout),
	};
}

function layoutRevision(layout: DiningWayfindingLayout): `sha256:${string}` {
	return `sha256:${createHash("sha256")
		.update(serializeDiningWayfindingLayout(canonicalizeDiningWayfindingLayout(layout)))
		.digest("hex")}`;
}

async function readCurrentGeneratedAssets(): Promise<Map<string, CurrentDiningFloorplanAssetRef>> {
	const content = await readOptionalFile(DINING_GENERATED_ASSET_MANIFEST);
	if (!content) {
		return new Map();
	}
	const parsed = JSON.parse(content) as {
		assets?: Array<{
			floorId?: unknown;
			floorplanId?: unknown;
			hallId?: unknown;
			sha256?: unknown;
		}>;
	};
	return new Map(
		(parsed.assets ?? []).flatMap((asset) => {
			const digest =
				typeof asset.sha256 === "string"
					? /^sha256:([0-9a-f]{64})$/.exec(asset.sha256)?.[1]
					: undefined;
			return typeof asset.floorId === "string" &&
				typeof asset.floorplanId === "string" &&
				typeof asset.hallId === "string" &&
				digest
				? [
						[
							asset.floorId,
							{
								floorplanId: asset.floorplanId,
								hallId: asset.hallId,
								sha256: digest,
							},
						] as const,
					]
				: [];
		}),
	);
}

async function listUntrackedDigestAssets(
	currentAssetNames: ReadonlySet<string>,
): Promise<string[]> {
	const assetDirectoryFromRoot = relative(REPOSITORY_ROOT, DINING_PUBLIC_ASSET_DIRECTORY);
	const { stdout } = await execFileAsync(
		"git",
		["ls-files", "--others", "--exclude-standard", "--", `${assetDirectoryFromRoot}/*.svg`],
		{ cwd: REPOSITORY_ROOT },
	);
	const candidates = stdout
		.split(/\r?\n/)
		.map((path) => basename(path.trim()))
		.filter((filename) => /^[0-9a-f]{64}\.svg$/.test(filename))
		.filter((filename) => !currentAssetNames.has(filename));
	const verified: string[] = [];
	for (const filename of candidates) {
		const bytes = await readFile(join(DINING_PUBLIC_ASSET_DIRECTORY, filename));
		if (`${createHash("sha256").update(bytes).digest("hex")}.svg` !== filename) {
			throw new Error(`Untracked Dining SVG filename does not match its content: ${filename}`);
		}
		verified.push(filename);
	}
	return verified.sort();
}

async function readOptionalFile(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

async function atomicWrite(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryPath, content, "utf8");
		await rename(temporaryPath, path);
	} catch (error) {
		try {
			await unlink(temporaryPath);
		} catch (cleanupError) {
			if (!(isNodeError(cleanupError) && cleanupError.code === "ENOENT")) {
				throw new AggregateError(
					[error, cleanupError],
					"Dining floorplan atomic write and temporary file cleanup failed.",
				);
			}
		}
		throw error;
	}
}

function runFloorplanOperation<T>(operation: () => Promise<T>): Promise<T> {
	const result = floorplanOperationTail.then(operation, operation);
	floorplanOperationTail = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
