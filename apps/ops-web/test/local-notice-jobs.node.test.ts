// @vitest-environment node

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { LocalNoticeJobStore, localNoticeCommand } from "../src/server/local-notice-jobs.ts";

describe("local notice jobs", () => {
	it("maps every operation to a fixed workspace command", () => {
		expect(
			localNoticeCommand({ operation: "notice-rescan", from: "2026-04-27", to: "2026-05-06" }, {})
				.args,
		).toEqual([
			...collectionArgs("notice-sync").slice(0, -1),
			"notice-rescan",
			"--from",
			"2026-04-27",
			"--to",
			"2026-05-06",
		]);
		expect(localNoticeCommand({ operation: "notice-sync" }, {})).toEqual({
			args: collectionArgs("notice-sync"),
			env: {},
		});
		expect(
			localNoticeCommand(
				{ operation: "notice-backfill", startDate: "2026-08-01" },
				{ EXISTING: "preserved" },
			),
		).toEqual({
			args: collectionArgs("notice-backfill"),
			env: { EXISTING: "preserved", INTERNAL_PORTAL_NOTICE_START_DATE: "2026-08-01" },
		});
		expect(localNoticeCommand({ operation: "notice-classify-missing" }, {}).args).toEqual([
			"--dir",
			"jobs/notice-classifier",
			"run",
			"classify:local",
		]);
		expect(
			localNoticeCommand({ noticeId: 354516, operation: "notice-classify-one" }, {}).args,
		).toEqual([
			"--dir",
			"jobs/notice-classifier",
			"run",
			"classify:local",
			"--notice-id",
			"354516",
		]);
		expect(localNoticeCommand({ operation: "notice-publish-pending" }, {}).args).toEqual([
			"--filter",
			"notice-publisher",
			"run",
			"publish",
		]);
		expect(
			localNoticeCommand({ noticeId: 354516, operation: "notice-publish-one" }, {}).args,
		).toEqual(["--filter", "notice-publisher", "run", "publish", "--notice-id", "354516"]);
		expect(
			localNoticeCommand({ noticeId: 354516, operation: "notice-republish-one" }, {}).args,
		).toEqual(["--filter", "notice-publisher", "run", "republish", "--notice-id", "354516"]);
	});

	it("runs asynchronously and records structured progress and summary", async () => {
		const child = fakeChild();
		const spawnProcess = vi.fn(() => child.process);
		const store = new LocalNoticeJobStore("/repo", spawnProcess);

		const created = await store.create({ noticeId: 354516, operation: "notice-republish-one" });
		expect(created).toMatchObject({
			maintenanceRange: null,
			noticeId: 354516,
			operation: "notice-republish-one",
			processedRange: null,
			status: "pending",
		});
		await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
		expect(spawnProcess).toHaveBeenCalledWith(
			"pnpm",
			expect.arrayContaining(["republish", "--notice-id", "354516"]),
			expect.objectContaining({ cwd: "/repo", stdio: ["ignore", "pipe", "pipe"] }),
		);

		child.events.emit("spawn");
		child.stdout.write(
			`${JSON.stringify({ progress: { phase: "processing", processed: 1, total: 1 } })}\n`,
		);
		await vi.waitFor(async () =>
			expect(await store.get(created.jobName)).toMatchObject({
				progress: { phase: "processing", processed: 1, total: 1 },
				status: "running",
			}),
		);

		child.stdout.write(`${JSON.stringify({ summary: { unchanged: 1, updated: 0 } })}\n`);
		child.events.emit("close", 0, null);
		await expect(store.get(created.jobName)).resolves.toMatchObject({
			completedAt: expect.any(String),
			controllerError: null,
			error: null,
			status: "succeeded",
			summary: { unchanged: 1, updated: 0 },
		});
	});

	it("records stderr when a local command exits unsuccessfully", async () => {
		const child = fakeChild();
		const store = new LocalNoticeJobStore("/repo", () => child.process);
		const created = await store.create({ operation: "notice-publish-pending" });
		await vi.waitFor(() => expect(child.events.listenerCount("close")).toBe(1));
		child.events.emit("spawn");
		child.stderr.write("publisher failed\n");
		child.events.emit("close", 1, null);

		await expect(store.get(created.jobName)).resolves.toMatchObject({
			controllerError: null,
			error: "publisher failed",
			status: "failed",
		});
	});
});

function collectionArgs(operation: "notice-backfill" | "notice-sync"): string[] {
	return [
		"--dir",
		"jobs/internal-portal-collection",
		"exec",
		"tsx",
		"adapters/internal-portal/src/collection-cli.ts",
		"--mode",
		operation,
	];
}

function fakeChild() {
	const events = new EventEmitter();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	return {
		events,
		process: Object.assign(events, { stderr, stdout }) as never,
		stderr,
		stdout,
	};
}
