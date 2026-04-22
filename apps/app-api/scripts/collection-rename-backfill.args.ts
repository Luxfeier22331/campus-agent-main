import type { CollectionRenameBackfillArgs } from "./collection-rename-backfill.shared";

function readPositiveInteger(value: string | undefined, flagName: string): number {
	const parsed = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		throw new Error(`${flagName} must be a positive integer.`);
	}
	return parsed;
}

export function parseCollectionRenameBackfillArgs(argv: string[]): CollectionRenameBackfillArgs {
	const [commandToken, ...rest] = argv;
	if (!commandToken) {
		throw new Error("Expected one subcommand: audit, apply, replay-projections.");
	}

	if (commandToken === "audit") {
		let writeReportPath: string | undefined;
		for (let index = 0; index < rest.length; index += 1) {
			const token = rest[index];
			if (token === "--") {
				continue;
			}
			if (token !== "--write-report") {
				throw new Error(`Unknown argument: ${token}`);
			}
			const value = rest[index + 1];
			if (!value?.trim()) {
				throw new Error("--write-report requires a non-empty value.");
			}
			writeReportPath = value;
			index += 1;
		}
		return {
			command: "audit",
			...(writeReportPath ? { writeReportPath } : {}),
		};
	}

	if (commandToken === "apply") {
		let batchSize: number | undefined;
		let writeReportPath: string | undefined;
		for (let index = 0; index < rest.length; index += 1) {
			const token = rest[index];
			if (token === "--") {
				continue;
			}
			if (token === "--batch-size") {
				batchSize = readPositiveInteger(rest[index + 1], "--batch-size");
				index += 1;
				continue;
			}
			if (token === "--write-report") {
				const value = rest[index + 1];
				if (!value?.trim()) {
					throw new Error("--write-report requires a non-empty value.");
				}
				writeReportPath = value;
				index += 1;
				continue;
			}
			throw new Error(`Unknown argument: ${token}`);
		}
		return {
			...(typeof batchSize === "number" ? { batchSize } : {}),
			command: "apply",
			...(writeReportPath ? { writeReportPath } : {}),
		};
	}

	if (commandToken === "replay-projections") {
		const requestIds: string[] = [];
		let reportPath: string | undefined;
		let writeReportPath: string | undefined;
		for (let index = 0; index < rest.length; index += 1) {
			const token = rest[index];
			if (token === "--") {
				continue;
			}
			if (token === "--request-id") {
				const value = rest[index + 1]?.trim();
				if (!value) {
					throw new Error("--request-id requires a non-empty value.");
				}
				requestIds.push(value);
				index += 1;
				continue;
			}
			if (token === "--report") {
				const value = rest[index + 1]?.trim();
				if (!value) {
					throw new Error("--report requires a non-empty value.");
				}
				reportPath = value;
				index += 1;
				continue;
			}
			if (token === "--write-report") {
				const value = rest[index + 1]?.trim();
				if (!value) {
					throw new Error("--write-report requires a non-empty value.");
				}
				writeReportPath = value;
				index += 1;
				continue;
			}
			throw new Error(`Unknown argument: ${token}`);
		}

		return {
			command: "replay-projections",
			...(reportPath ? { reportPath } : {}),
			requestIds,
			...(writeReportPath ? { writeReportPath } : {}),
		};
	}

	throw new Error(`Unknown subcommand: ${commandToken}`);
}
