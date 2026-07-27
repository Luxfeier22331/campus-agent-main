import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type AuthCheckDependencies, checkAuth } from "./auth-check.js";
import {
	PortalCredentialExpiredError,
	PortalCredentialUnavailableError,
	PortalSessionExpiredError,
} from "./auth-errors.js";
import {
	type InternalPortalConfig,
	loadInternalPortalEnv,
	resolveInternalPortalConfig,
} from "./config.js";
import { formatSafeErrorMessage } from "./safe-error.js";

export const AUTH_KEEPALIVE_INTERVAL_MS = 30 * 60_000;

const adapterRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_STATUS_PATH = path.join(adapterRoot, ".auth-status.json");

export type AuthKeepaliveOutcome = "valid" | "credential_rejected" | "check_failed";

export interface AuthKeepaliveStatus {
	lastAttemptAt: string;
	lastOutcome: AuthKeepaliveOutcome;
	lastSuccessfulAt: string | null;
}

export interface AuthKeepaliveDependencies {
	checkAuthentication?: AuthCheckDependencies["checkAuthentication"];
	loadConfig?: () => InternalPortalConfig;
	now?: () => Date;
	onError?: (error: unknown) => void;
	onStatus?: (status: AuthKeepaliveStatus) => void;
	statusPath?: string;
	wait?: (delayMs: number, abortSignal: AbortSignal) => Promise<void>;
}

export async function runAuthKeepalive(
	abortSignal: AbortSignal,
	dependencies: AuthKeepaliveDependencies = {},
): Promise<void> {
	const statusPath = dependencies.statusPath ?? DEFAULT_STATUS_PATH;
	let previousStatus = readAuthKeepaliveStatus(statusPath);

	while (!abortSignal.aborted) {
		previousStatus = await runAuthKeepaliveAttempt({
			abortSignal,
			dependencies,
			previousStatus,
			statusPath,
		});
		if (abortSignal.aborted) {
			break;
		}
		await (dependencies.wait ?? waitForNextAttempt)(AUTH_KEEPALIVE_INTERVAL_MS, abortSignal);
	}
}

export async function runAuthKeepaliveAttempt(input: {
	abortSignal: AbortSignal;
	dependencies?: AuthKeepaliveDependencies;
	previousStatus: AuthKeepaliveStatus | null;
	statusPath: string;
}): Promise<AuthKeepaliveStatus> {
	const dependencies = input.dependencies ?? {};
	const now = dependencies.now ?? (() => new Date());
	const lastAttemptAt = now().toISOString();
	let status: AuthKeepaliveStatus;

	try {
		await checkAuth({
			abortSignal: input.abortSignal,
			checkAuthentication: dependencies.checkAuthentication,
			config: (dependencies.loadConfig ?? createFreshConfigLoader())(),
		});
		status = {
			lastAttemptAt,
			lastOutcome: "valid",
			lastSuccessfulAt: now().toISOString(),
		};
	} catch (error) {
		status = {
			lastAttemptAt,
			lastOutcome: classifyKeepaliveFailure(error),
			lastSuccessfulAt: input.previousStatus?.lastSuccessfulAt ?? null,
		};
		(dependencies.onError ?? ((cause) => console.error(formatSafeErrorMessage(cause))))(error);
	}

	writeAuthKeepaliveStatus(input.statusPath, status);
	(dependencies.onStatus ?? ((value) => console.log(JSON.stringify(value))))(status);
	return status;
}

export function readAuthKeepaliveStatus(statusPath: string): AuthKeepaliveStatus | null {
	let raw: string;
	try {
		raw = readFileSync(statusPath, "utf8");
	} catch (error) {
		if (isMissingFileError(error)) {
			return null;
		}
		throw error;
	}
	const value = JSON.parse(raw) as unknown;
	if (!isAuthKeepaliveStatus(value)) {
		throw new Error(`invalid internal portal auth status: ${statusPath}`);
	}
	return value;
}

export function main(): Promise<void> {
	const abortController = new AbortController();
	const stop = () => abortController.abort();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	return runAuthKeepalive(abortController.signal).finally(() => {
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
	});
}

function createFreshConfigLoader(): () => InternalPortalConfig {
	const startupEnv = { ...process.env };
	return () => {
		const currentEnv = { ...startupEnv };
		loadInternalPortalEnv(currentEnv);
		return resolveInternalPortalConfig(currentEnv);
	};
}

function classifyKeepaliveFailure(error: unknown): AuthKeepaliveOutcome {
	return error instanceof PortalCredentialUnavailableError ||
		error instanceof PortalCredentialExpiredError ||
		error instanceof PortalSessionExpiredError
		? "credential_rejected"
		: "check_failed";
}

function writeAuthKeepaliveStatus(statusPath: string, status: AuthKeepaliveStatus): void {
	const temporaryPath = `${statusPath}.${process.pid}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporaryPath, statusPath);
}

function isAuthKeepaliveStatus(value: unknown): value is AuthKeepaliveStatus {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record.lastAttemptAt === "string" &&
		(record.lastOutcome === "valid" ||
			record.lastOutcome === "credential_rejected" ||
			record.lastOutcome === "check_failed") &&
		(record.lastSuccessfulAt === null || typeof record.lastSuccessfulAt === "string")
	);
}

function isMissingFileError(error: unknown): boolean {
	return (
		error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

async function waitForNextAttempt(delayMs: number, abortSignal: AbortSignal): Promise<void> {
	if (abortSignal.aborted) {
		return;
	}
	await new Promise<void>((resolve) => {
		const timer = setTimeout(finish, delayMs);
		abortSignal.addEventListener("abort", finish, { once: true });

		function finish() {
			clearTimeout(timer);
			abortSignal.removeEventListener("abort", finish);
			resolve();
		}
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
