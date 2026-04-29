import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
	appendPublicDocsReleaseLedgerRecord,
	checkPublishedReaderManifest,
	type PublicDocsManifestCheckResult,
	type PublicDocsPublishEnvironment,
	type PublicDocsReleaseLedgerRecord,
} from "./check-published-reader-manifest";
import { APP_ROOT } from "./sync-real-docs/shared";
import { createS3ObjectStore, type ObjectStoreClient } from "./sync-real-docs/storage";

export type PublicDocsScheduledCheckOutcome = "checked" | "lock_busy" | "not_due";

export interface PublicDocsPublishScheduleWindow {
	cronUtc: "7 4,10,16,22 * * *";
	due: boolean;
	scheduleKey?: string;
	shanghaiTime: string;
	windowLabel?: "00:00" | "06:00" | "12:00" | "18:00";
}

export interface PublicDocsPublishLockFile {
	acquiredAt: string;
	environment?: PublicDocsPublishEnvironment;
	expiresAt: string;
	lockId: string;
	ownerId: string;
	schemaVersion: 1;
	surface?: "public_docs";
}

export interface PublicDocsScheduledCheckResult {
	activeLock?: PublicDocsPublishLockFile;
	check?: PublicDocsManifestCheckResult;
	lockId?: string;
	outcome: PublicDocsScheduledCheckOutcome;
	schedule: PublicDocsPublishScheduleWindow;
	staleLockRemoved?: boolean;
}

export type PublicDocsPublishLockAcquireResult =
	| { acquired: true; lock: PublicDocsPublishLockFile; staleLockRemoved: boolean }
	| {
			acquired: false;
			activeLock: PublicDocsPublishLockFile;
			staleLockRemoved: boolean;
	  };

const SHANGHAI_OFFSET_HOURS = 8;
const SCHEDULE_HOURS = [0, 6, 12, 18] as const;
const DEFAULT_DUE_WINDOW_MINUTES = 15;
const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000;

export function resolvePublicDocsPublishScheduleWindow(input: {
	dueWindowMinutes?: number;
	now?: string;
}): PublicDocsPublishScheduleWindow {
	const now = new Date(input.now ?? new Date().toISOString());
	if (Number.isNaN(now.getTime())) {
		throw new Error("now must be a valid ISO datetime");
	}
	const dueWindowMinutes = input.dueWindowMinutes ?? DEFAULT_DUE_WINDOW_MINUTES;
	const shanghai = new Date(now.getTime() + SHANGHAI_OFFSET_HOURS * 60 * 60 * 1000);
	const currentShanghaiMinutes = shanghai.getUTCHours() * 60 + shanghai.getUTCMinutes();
	const window = SCHEDULE_HOURS.map((hour) => ({
		diffMinutes: currentShanghaiMinutes - hour * 60,
		hour,
	})).find(({ diffMinutes }) => diffMinutes >= 0 && diffMinutes <= dueWindowMinutes);

	return {
		cronUtc: "7 4,10,16,22 * * *",
		due: Boolean(window),
		scheduleKey: window ? formatShanghaiDateTime(shanghai, window.hour) : undefined,
		shanghaiTime: formatShanghaiDateTime(
			shanghai,
			shanghai.getUTCHours(),
			shanghai.getUTCMinutes(),
		),
		windowLabel: window ? formatWindowLabel(window.hour) : undefined,
	};
}

export async function runPublishedReaderScheduledCheck(input: {
	client: ObjectStoreClient;
	dueWindowMinutes?: number;
	environment: PublicDocsPublishEnvironment;
	force?: boolean;
	ledgerFilePath: string;
	lockFilePath: string;
	lockStaleMs?: number;
	manifestFilePath?: string;
	manifestObjectKey?: string;
	now?: string;
	runnerId?: string;
}): Promise<PublicDocsScheduledCheckResult> {
	const now = input.now ?? new Date().toISOString();
	const schedule = resolvePublicDocsPublishScheduleWindow({
		dueWindowMinutes: input.dueWindowMinutes,
		now,
	});
	if (!(schedule.due || input.force)) {
		return { outcome: "not_due", schedule };
	}

	const acquired = acquirePublicDocsPublishLock({
		environment: input.environment,
		lockFilePath: input.lockFilePath,
		lockStaleMs: input.lockStaleMs ?? DEFAULT_LOCK_STALE_MS,
		now,
		ownerId: input.runnerId ?? "public-docs-scheduled-runner",
	});
	if (!acquired.acquired) {
		return {
			activeLock: acquired.activeLock,
			outcome: "lock_busy",
			schedule,
			staleLockRemoved: acquired.staleLockRemoved,
		};
	}

	try {
		const check = await checkPublishedReaderManifest({
			client: input.client,
			environment: input.environment,
			ledgerFilePath: input.ledgerFilePath,
			manifestFilePath: input.manifestFilePath,
			manifestObjectKey: input.manifestObjectKey,
			now,
			runnerId: input.runnerId,
		});
		const ledgerRecord: PublicDocsReleaseLedgerRecord = {
			...check.ledgerRecord,
			lockId: acquired.lock.lockId,
			runnerId: input.runnerId,
			scheduleKey: input.force ? "forced" : schedule.scheduleKey,
			trigger: input.force ? "forced" : "scheduled",
		};
		appendPublicDocsReleaseLedgerRecord({
			ledgerFilePath: input.ledgerFilePath,
			record: ledgerRecord,
		});
		return {
			check: {
				...check,
				ledgerRecord,
			},
			lockId: acquired.lock.lockId,
			outcome: "checked",
			schedule,
			staleLockRemoved: acquired.staleLockRemoved,
		};
	} finally {
		releasePublicDocsPublishLock({
			lockFilePath: input.lockFilePath,
			lockId: acquired.lock.lockId,
		});
	}
}

export function acquirePublicDocsPublishLock(input: {
	environment: PublicDocsPublishEnvironment;
	lockFilePath: string;
	lockStaleMs: number;
	now: string;
	ownerId: string;
}): PublicDocsPublishLockAcquireResult {
	const nowMs = new Date(input.now).getTime();
	let staleLockRemoved = false;
	if (existsSync(input.lockFilePath)) {
		const activeLock = readPublicDocsPublishLock(input.lockFilePath);
		if (!isLockStale({ lock: activeLock, lockStaleMs: input.lockStaleMs, nowMs })) {
			return { acquired: false, activeLock, staleLockRemoved };
		}
		rmSync(input.lockFilePath, { force: true });
		staleLockRemoved = true;
	}

	const lock: PublicDocsPublishLockFile = {
		acquiredAt: input.now,
		environment: input.environment,
		expiresAt: new Date(nowMs + input.lockStaleMs).toISOString(),
		lockId: buildLockId({
			environment: input.environment,
			now: input.now,
			ownerId: input.ownerId,
		}),
		ownerId: input.ownerId,
		schemaVersion: 1,
		surface: "public_docs",
	};
	mkdirSync(dirname(input.lockFilePath), { recursive: true });
	try {
		writeFileSync(input.lockFilePath, `${JSON.stringify(lock, null, 2)}\n`, { flag: "wx" });
	} catch (error) {
		if (isFileExistsError(error) && existsSync(input.lockFilePath)) {
			return {
				acquired: false,
				activeLock: readPublicDocsPublishLock(input.lockFilePath),
				staleLockRemoved,
			};
		}
		throw error;
	}
	return { acquired: true, lock, staleLockRemoved };
}

export function releasePublicDocsPublishLock(input: {
	lockFilePath: string;
	lockId: string;
}): void {
	if (!existsSync(input.lockFilePath)) {
		return;
	}
	const activeLock = readPublicDocsPublishLock(input.lockFilePath);
	if (activeLock.lockId === input.lockId) {
		rmSync(input.lockFilePath, { force: true });
	}
}

function readPublicDocsPublishLock(lockFilePath: string): PublicDocsPublishLockFile {
	const parsed = JSON.parse(
		readFileSync(lockFilePath, "utf8"),
	) as Partial<PublicDocsPublishLockFile>;
	if (
		parsed.schemaVersion !== 1 ||
		!parsed.lockId ||
		!parsed.ownerId ||
		!parsed.acquiredAt ||
		!parsed.expiresAt
	) {
		throw new Error("public docs publish lock file is invalid");
	}
	return {
		acquiredAt: parsed.acquiredAt,
		environment: parsed.environment,
		expiresAt: parsed.expiresAt,
		lockId: parsed.lockId,
		ownerId: parsed.ownerId,
		schemaVersion: 1,
		surface: parsed.surface,
	};
}

function isLockStale(input: {
	lock: PublicDocsPublishLockFile;
	lockStaleMs: number;
	nowMs: number;
}): boolean {
	const acquiredAtMs = new Date(input.lock.acquiredAt).getTime();
	const expiresAtMs = new Date(input.lock.expiresAt).getTime();
	return expiresAtMs <= input.nowMs || input.nowMs - acquiredAtMs > input.lockStaleMs;
}

function buildLockId(input: {
	environment: PublicDocsPublishEnvironment;
	now: string;
	ownerId: string;
}): string {
	return [
		"public_docs",
		input.environment,
		input.ownerId.replace(/[^0-9A-Za-z_-]/g, "_"),
		input.now.replace(/[^0-9A-Za-z]/g, ""),
	].join(":");
}

function formatShanghaiDateTime(date: Date, hour: number, minute = 0): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	return `${year}-${month}-${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`;
}

function formatWindowLabel(
	hour: (typeof SCHEDULE_HOURS)[number],
): PublicDocsPublishScheduleWindow["windowLabel"] {
	return `${String(hour).padStart(2, "0")}:00` as PublicDocsPublishScheduleWindow["windowLabel"];
}

function isFileExistsError(error: unknown): boolean {
	return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

export function parsePublishedReaderScheduledCheckArgs(argv: string[]): {
	dueWindowMinutes: number;
	environment: PublicDocsPublishEnvironment;
	force: boolean;
	ledgerFilePath?: string;
	lockFilePath?: string;
	lockStaleMs: number;
	manifestFilePath?: string;
	manifestObjectKey?: string;
	now?: string;
} {
	const args = [...argv];
	let dueWindowMinutes = DEFAULT_DUE_WINDOW_MINUTES;
	let environment: PublicDocsPublishEnvironment =
		process.env.CLOUDFLARE_ENV === "staging" ? "staging" : "prod";
	let force = false;
	let ledgerFilePath: string | undefined;
	let lockFilePath: string | undefined;
	let lockStaleMs = DEFAULT_LOCK_STALE_MS;
	let manifestFilePath: string | undefined = process.env.PUBLIC_DOCS_SYNC_MANIFEST_PATH;
	let manifestObjectKey: string | undefined = process.env.PUBLIC_DOCS_SYNC_MANIFEST_KEY;
	let now: string | undefined;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") {
			continue;
		}
		if (arg === "--due-window-minutes") {
			dueWindowMinutes = Number.parseInt(requireArgValue(args, index, arg), 10);
			index += 1;
		} else if (arg === "--env") {
			environment = parseEnvironment(requireArgValue(args, index, arg));
			index += 1;
		} else if (arg === "--force") {
			force = true;
		} else if (arg === "--ledger") {
			ledgerFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--lock-file") {
			lockFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--lock-stale-ms") {
			lockStaleMs = Number.parseInt(requireArgValue(args, index, arg), 10);
			index += 1;
		} else if (arg === "--manifest-path") {
			manifestFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--manifest-key") {
			manifestObjectKey = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--now") {
			now = requireArgValue(args, index, arg);
			index += 1;
		} else {
			throw new Error(`unsupported argument: ${arg}`);
		}
	}

	return {
		dueWindowMinutes,
		environment,
		force,
		ledgerFilePath,
		lockFilePath,
		lockStaleMs,
		manifestFilePath,
		manifestObjectKey,
		now,
	};
}

function requireArgValue(args: string[], index: number, name: string): string {
	const value = args[index + 1]?.trim();
	if (!value) {
		throw new Error(`${name} requires a value`);
	}
	return value;
}

function parseEnvironment(value: string): PublicDocsPublishEnvironment {
	if (value === "prod" || value === "staging") {
		return value;
	}
	throw new Error("--env must be prod or staging");
}

async function main(): Promise<void> {
	const args = parsePublishedReaderScheduledCheckArgs(process.argv.slice(2));
	const runtimeRoot = resolve(APP_ROOT, "../../.planning/runtime/public-docs-publish");
	const environment = args.environment;
	const result = await runPublishedReaderScheduledCheck({
		client: createS3ObjectStore(),
		dueWindowMinutes: args.dueWindowMinutes,
		environment,
		force: args.force,
		ledgerFilePath: args.ledgerFilePath ?? resolve(runtimeRoot, `${environment}-ledger.json`),
		lockFilePath: args.lockFilePath ?? resolve(runtimeRoot, `${environment}.lock.json`),
		lockStaleMs: args.lockStaleMs,
		manifestFilePath: args.manifestFilePath,
		manifestObjectKey: args.manifestObjectKey,
		now: args.now,
		runnerId: process.env.PUBLIC_DOCS_PUBLISH_RUNNER_ID,
	});
	console.log(JSON.stringify(result, null, 2));
	if (result.outcome === "lock_busy") {
		process.exitCode = 2;
	}
	if (result.outcome === "checked") {
		const verdict = result.check?.verdict;
		if (verdict === "blocked" || verdict === "invalid") {
			process.exitCode = 1;
		}
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
