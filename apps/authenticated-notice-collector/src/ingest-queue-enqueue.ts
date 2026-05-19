import { spawn } from "node:child_process";

import type { CollectorRunLedgerRecord } from "./collector-run-ledger.js";

export interface VerifiedRunEnqueueInput {
	ledgerRecord: CollectorRunLedgerRecord;
	outputDir: string | null;
	siteId: string;
}

export interface VerifiedRunEnqueueCommandInput {
	outputDir: string | null;
	runId: string;
	siteId: string;
	sourceSurface: string;
}

export function buildVerifiedRunEnqueueCommand(input: VerifiedRunEnqueueCommandInput): string[] {
	const command = [
		"uv",
		"run",
		"--all-packages",
		"python",
		"-m",
		"campus_ingestion_worker.enqueue_authenticated_notice_collector_run",
		"--run-id",
		input.runId,
		"--site-id",
		input.siteId,
		"--source-surface",
		input.sourceSurface,
	];
	if (input.outputDir !== null) {
		command.push("--output-dir", input.outputDir);
	}
	command.push("--enqueue-source", "live_discovery", "--execute");
	return command;
}

export async function enqueueVerifiedCollectorRun(input: VerifiedRunEnqueueInput): Promise<void> {
	assertVerifiedLedgerRecord(input.ledgerRecord);
	const command = buildVerifiedRunEnqueueCommand({
		outputDir: input.outputDir,
		runId: input.ledgerRecord.runId,
		siteId: input.siteId,
		sourceSurface: input.ledgerRecord.sourceSurface,
	});
	await runCommand(command);
}

function assertVerifiedLedgerRecord(record: CollectorRunLedgerRecord): void {
	if (record.status !== "success" || record.verificationStatus !== "verified") {
		throw new Error(
			`collector run is not verified for enqueue: ${record.runId} ${record.status}/${record.verificationStatus}`,
		);
	}
}

async function runCommand(command: string[]): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command[0], command.slice(1), {
			stdio: "inherit",
		});
		child.once("error", reject);
		child.once("exit", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`verified run enqueue command failed with exit code ${code}`));
		});
	});
}
