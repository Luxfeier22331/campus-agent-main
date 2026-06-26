import { spawn } from "node:child_process";

import { formatSafeErrorMessage } from "./safe-error.js";

export type CollectorEntrypointMode =
	| "auth-check"
	| "notice-export"
	| "file-release-export"
	| "visual-ref-audit";

export function resolveCollectorMode(
	env: Record<string, string | undefined> = process.env,
): CollectorEntrypointMode {
	const raw = env.AUTHENTICATED_NOTICE_COLLECTOR_MODE?.trim();
	if (!raw) {
		return "auth-check";
	}
	if (
		raw === "auth-check" ||
		raw === "notice-export" ||
		raw === "file-release-export" ||
		raw === "visual-ref-audit"
	) {
		return raw;
	}
	throw new Error(
		"AUTHENTICATED_NOTICE_COLLECTOR_MODE must be auth-check, notice-export, file-release-export, or visual-ref-audit",
	);
}

export function buildCollectorModeCommand(mode: CollectorEntrypointMode): string[] {
	switch (mode) {
		case "auth-check":
			return ["pnpm", "--dir", "apps/authenticated-notice-collector", "auth:check"];
		case "notice-export":
			return ["pnpm", "--dir", "apps/authenticated-notice-collector", "bootstrap:export"];
		case "file-release-export":
			return ["pnpm", "--dir", "apps/authenticated-notice-collector", "file-release:export"];
		case "visual-ref-audit":
			return [
				"pnpm",
				"--dir",
				"apps/authenticated-notice-collector",
				"exec",
				"tsx",
				"src/visual-ref-audit.ts",
			];
		default: {
			const exhaustiveCheck: never = mode;
			throw new Error(`unsupported collector mode: ${exhaustiveCheck}`);
		}
	}
}

export async function main(): Promise<void> {
	const command = buildCollectorModeCommand(resolveCollectorMode());
	const [executable, ...args] = command;
	await new Promise<void>((resolve, reject) => {
		const child = spawn(executable, args, {
			stdio: "inherit",
		});
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
			reject(new Error(`collector mode command failed: ${reason}`));
		});
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
