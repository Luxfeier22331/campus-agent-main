import { runOfficialWebNextLocalHarness } from "./local-harness.ts";

interface CliOptions {
	artifactRootDir?: string;
	maxConcurrency?: number;
	maxRequests?: number;
	releaseId?: string;
	respectRobots?: boolean;
	runId?: string;
	sameDomainDelayMs?: number;
	siteId?: string;
	userAgent?: string;
	worksetPath?: string;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const required = requireOptions(options);
	const result = await runOfficialWebNextLocalHarness({
		artifactRootDir: required.artifactRootDir,
		crawlPolicy: {
			respectRobots: options.respectRobots,
			userAgent: options.userAgent,
		},
		limits:
			options.maxConcurrency || options.maxRequests || options.sameDomainDelayMs
				? {
						maxConcurrency: options.maxConcurrency ?? 1,
						maxRequests: options.maxRequests ?? 50,
						sameDomainDelayMs: options.sameDomainDelayMs ?? 1000,
					}
				: undefined,
		releaseId: required.releaseId,
		runId: required.runId,
		siteId: required.siteId,
		worksetPath: required.worksetPath,
	});
	console.log(
		JSON.stringify(
			{
				schemaVersion: "official_web_next_local_harness_summary.v1",
				runId: result.capture.runId,
				pagesFetched: result.capture.pagesFetched,
				pagesFailed: result.capture.pagesFailed,
				documentUnitCount: result.reference.documentUnits.length,
				chunkCount: result.reference.chunks.length,
				sourceTruthBundleObjectKey: result.capture.sourceTruthBundleRef.objectKey,
				referenceManifestObjectKey:
					result.referenceArtifactRefs.find((ref) =>
						ref.objectKey.endsWith("/reference/release-manifest.json"),
					)?.objectKey ?? null,
			},
			null,
			2,
		),
	);
}

function parseArgs(args: string[]): CliOptions {
	const options: CliOptions = {};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		const readNextValue = (): string => {
			index += 1;
			return readArgValue(args, index, arg);
		};
		const readNextPositiveInteger = (): number => {
			index += 1;
			return readPositiveInteger(args, index, arg);
		};
		const readNextNonNegativeInteger = (): number => {
			index += 1;
			return readNonNegativeInteger(args, index, arg);
		};
		switch (arg) {
			case "--artifact-root":
				options.artifactRootDir = readNextValue();
				break;
			case "--max-concurrency":
				options.maxConcurrency = readNextPositiveInteger();
				break;
			case "--max-requests":
				options.maxRequests = readNextPositiveInteger();
				break;
			case "--release-id":
				options.releaseId = readNextValue();
				break;
			case "--respect-robots":
				options.respectRobots = true;
				break;
			case "--ignore-robots":
				options.respectRobots = false;
				break;
			case "--run-id":
				options.runId = readNextValue();
				break;
			case "--same-domain-delay-ms":
				options.sameDomainDelayMs = readNextNonNegativeInteger();
				break;
			case "--site-id":
				options.siteId = readNextValue();
				break;
			case "--user-agent":
				options.userAgent = readNextValue();
				break;
			case "--workset":
				options.worksetPath = readNextValue();
				break;
			default:
				throw new Error(`unknown official-web-next CLI option: ${arg}`);
		}
	}
	return options;
}

function requireOptions(
	options: CliOptions,
): Required<
	Pick<CliOptions, "artifactRootDir" | "releaseId" | "runId" | "siteId" | "worksetPath">
> {
	const missing = [
		["--artifact-root", options.artifactRootDir],
		["--release-id", options.releaseId],
		["--run-id", options.runId],
		["--site-id", options.siteId],
		["--workset", options.worksetPath],
	].filter(([, value]) => !value);
	if (missing.length > 0) {
		throw new Error(`official-web-next CLI requires ${missing.map(([name]) => name).join(", ")}`);
	}
	return {
		artifactRootDir: assertPresent(options.artifactRootDir, "--artifact-root"),
		releaseId: assertPresent(options.releaseId, "--release-id"),
		runId: assertPresent(options.runId, "--run-id"),
		siteId: assertPresent(options.siteId, "--site-id"),
		worksetPath: assertPresent(options.worksetPath, "--workset"),
	};
}

function assertPresent(value: string | undefined, optionName: string): string {
	if (!value) {
		throw new Error(`official-web-next CLI requires ${optionName}`);
	}
	return value;
}

function readArgValue(args: string[], index: number, optionName: string): string {
	const value = args[index];
	if (!value || value.startsWith("--")) {
		throw new Error(`${optionName} requires a value`);
	}
	return value;
}

function readPositiveInteger(args: string[], index: number, optionName: string): number {
	const value = readNonNegativeInteger(args, index, optionName);
	if (value <= 0) {
		throw new Error(`${optionName} must be greater than 0`);
	}
	return value;
}

function readNonNegativeInteger(args: string[], index: number, optionName: string): number {
	const raw = readArgValue(args, index, optionName);
	const value = Number.parseInt(raw, 10);
	if (!Number.isInteger(value) || value < 0 || String(value) !== raw) {
		throw new Error(`${optionName} must be a non-negative integer`);
	}
	return value;
}
