import { runFileSync } from "./file-sync.js";
import { parseNoticeCommand, runNoticeCommand } from "./notice-command.js";

export const COLLECTION_USAGE = [
	"Usage:",
	"  --mode notice-sync",
	"  --mode notice-backfill --start-date YYYY-MM-DD",
	"  --mode notice-rescan --from YYYY-MM-DD --to YYYY-MM-DD",
	"  --mode file-sync",
].join("\n");

export type CollectionCommand =
	| { mode: "file-sync" }
	| { mode: "notice-sync" }
	| { mode: "notice-backfill"; startDate: string }
	| { mode: "notice-rescan"; from: string; to: string };

export interface CollectionCommandOptions {
	env?: NodeJS.ProcessEnv;
	ssoTgc?: string;
}

export function isCollectionHelp(argv: readonly string[]): boolean {
	const normalized = argv[0] === "--" ? argv.slice(1) : argv;
	return normalized.length === 1 && (normalized[0] === "--help" || normalized[0] === "-h");
}

export function parseCollectionCommand(argv: string[]): CollectionCommand {
	const flags = parseFlags(argv[0] === "--" ? argv.slice(1) : argv);
	const mode = required(flags, "--mode");
	if (mode === "notice-rescan") {
		assertOnlyFlags(flags, ["--mode", "--from", "--to"]);
		const command = parseNoticeCommand(["rescan", "--from", required(flags, "--from"), "--to", required(flags, "--to")]);
		if (command.name !== "rescan") throw usageError();
		return { mode, from: command.from, to: command.to };
	}
	if (mode === "file-sync") {
		assertOnlyFlags(flags, ["--mode"]);
		return { mode };
	}
	if (mode === "notice-sync") {
		assertOnlyFlags(flags, ["--mode"]);
		const command = parseNoticeCommand(["sync"]);
		if (command.name !== "sync") {
			throw usageError();
		}
		return { mode };
	}
	if (mode === "notice-backfill") {
		assertOnlyFlags(flags, ["--mode", "--start-date"]);
		const command = parseNoticeCommand([
			"backfill",
			"--start-date",
			required(flags, "--start-date"),
		]);
		if (command.name !== "backfill") {
			throw usageError();
		}
		return {
			mode,
			startDate: command.startDate,
		};
	}
	throw usageError();
}

export async function runCollectionCommand(
	command: CollectionCommand,
	options: CollectionCommandOptions = {},
): Promise<number> {
	const env = options.env ?? process.env;
	if (command.mode === "file-sync") {
		const summary = await runFileSync({
			env,
			...(options.ssoTgc === undefined ? {} : { ssoTgc: options.ssoTgc }),
		});
		const { failures: _failures, ...counts } = summary;
		console.log(JSON.stringify({ summary: { ...counts, mode: "file-sync" } }));
		return summary.failed > 0 ? 1 : 0;
	}
	const noticeSummary = await runNoticeCommand(
		command.mode === "notice-rescan"
			? { name: "rescan", from: command.from, to: command.to }
			: command.mode === "notice-sync"
			? { name: "sync" }
			: {
					name: "backfill",
					startDate: command.startDate,
				},
		options,
	);
	const { state: _state, ...counts } = noticeSummary;
	for (const failure of noticeSummary.failures) {
		console.error(
			JSON.stringify({
				error: failure.error,
				failure: {
					noticeId: failure.noticeId,
					operation: failure.operation,
					resourceKind: failure.resourceKind,
					resourceOrdinal: failure.resourceOrdinal,
				},
				status: "failed",
			}),
		);
	}
	console.log(
		JSON.stringify({
			maintenanceRange: noticeSummary.maintenanceRange,
			processedRange: noticeSummary.processedRange,
			summary: {
                outcome: counts.failures.length > 0 ? "partial" : "success",
				attachmentsDownloaded: counts.resources.attachmentsDownloaded,
				attachmentsMissing: counts.resources.attachmentsMissing,
				attachmentsReused: counts.resources.attachmentsReused,
				imagesDownloaded: counts.resources.imagesDownloaded,
				imagesReused: counts.resources.imagesReused,
				noticesFailed: counts.failures.length,
				noticesProcessed: counts.noticesProcessed,
				noticesAdded: counts.noticesAdded,
				objectsReused: counts.objectsReused,
				objectsWritten: counts.objectsWritten,
				pagesFetched: counts.pagesFetched,
				...(counts.upToDate ? { upToDate: true } : {}),
			},
			status: counts.failures.length > 0 ? "failed" : "succeeded",
		}),
	);
	return counts.failures.length > 0 ? 1 : 0;
}

function parseFlags(argv: string[]): Map<string, string> {
	if (argv.length === 0 || argv.length % 2 !== 0) {
		throw usageError();
	}
	const flags = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const name = argv[index];
		const value = argv[index + 1];
		if (!(name?.startsWith("--") && value) || flags.has(name)) {
			throw usageError();
		}
		flags.set(name, value);
	}
	return flags;
}

function required(flags: ReadonlyMap<string, string>, name: string): string {
	const value = flags.get(name)?.trim();
	if (!value) {
		throw usageError();
	}
	return value;
}

function assertOnlyFlags(flags: ReadonlyMap<string, string>, allowed: readonly string[]): void {
	for (const flag of flags.keys()) {
		if (!allowed.includes(flag)) {
			throw usageError();
		}
	}
}

function usageError(): Error {
	return new Error(COLLECTION_USAGE);
}
