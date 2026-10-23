import { type ChildProcessByStdio, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import type { NoticeJob, NoticeJobCreate } from "../shared/ops-contract.ts";
import { type NoticeJobStore, parseNoticeJobDiagnostics } from "./notice-jobs.ts";

const DEFAULT_REPOSITORY_ROOT = resolve(import.meta.dirname, "../../../..");
const MAX_LISTED_JOBS = 50;

type SpawnProcess = (
	command: string,
	args: readonly string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ["ignore", "pipe", "pipe"] },
) => ChildProcessByStdio<null, Readable, Readable>;

interface LocalNoticeCommand {
	args: string[];
	env: NodeJS.ProcessEnv;
}

export function createLocalNoticeJobStore(
	repositoryRoot = DEFAULT_REPOSITORY_ROOT,
): NoticeJobStore {
	return new LocalNoticeJobStore(repositoryRoot);
}

export class LocalNoticeJobStore implements NoticeJobStore {
	private readonly jobs = new Map<string, NoticeJob>();
	private readonly repositoryRoot: string;
	private readonly spawnProcess: SpawnProcess;

	constructor(
		repositoryRoot: string,
		spawnProcess: SpawnProcess = (command, args, options) => spawn(command, [...args], options),
	) {
		this.repositoryRoot = repositoryRoot;
		this.spawnProcess = spawnProcess;
	}

	async create(input: NoticeJobCreate): Promise<NoticeJob> {
		const jobName = `${input.operation}-${randomUUID()}`;
		const job: NoticeJob = {
			completedAt: null,
			createdAt: new Date().toISOString(),
			controllerError: null,
			error: null,
			jobName,
			maintenanceRange: null,
			noticeId: "noticeId" in input ? input.noticeId : null,
			operation: input.operation,
			trigger: "manual",
			processedRange: null,
			progress: null,
			startedAt: null,
			status: "pending",
			summary: null,
		};
		this.jobs.set(jobName, job);
		queueMicrotask(() => this.run(jobName, input));
		return structuredClone(job);
	}

	async get(jobName: string): Promise<NoticeJob | null> {
		const job = this.jobs.get(jobName);
		return job ? structuredClone(job) : null;
	}

	async list(): Promise<NoticeJob[]> {
		return [...this.jobs.values()]
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
			.slice(0, MAX_LISTED_JOBS)
			.map((job) => structuredClone(job));
	}

	async findActive(
		family: "collection" | "classification" | "publication",
	): Promise<string | null> {
		const prefixes =
			family === "collection"
				? ["notice-sync", "notice-backfill", "notice-rescan"]
				: family === "classification"
					? ["notice-classify-missing", "notice-classify-one", "notice-reclassify-all"]
					: ["notice-publish-pending", "notice-publish-one", "notice-republish-one"];
		return (
			[...this.jobs.values()].find(
				(job) =>
					prefixes.includes(job.operation) &&
					(job.status === "pending" || job.status === "running"),
			)?.jobName ?? null
		);
	}

	private run(jobName: string, input: NoticeJobCreate): void {
		const command = localNoticeCommand(input);
		let child: ChildProcessByStdio<null, Readable, Readable>;
		try {
			child = this.spawnProcess("pnpm", command.args, {
				cwd: this.repositoryRoot,
				env: command.env,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			this.fail(jobName, `本地通知任务启动失败：${errorMessage(error)}`);
			return;
		}

		let stdout = "";
		let stderr = "";
		let spawnError: Error | null = null;
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
			this.applyDiagnostics(jobName, stdout);
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("spawn", () => {
			const job = this.jobs.get(jobName);
			if (job) {
				job.startedAt = new Date().toISOString();
				job.status = "running";
			}
		});
		child.once("error", (error) => {
			spawnError = error;
		});
		child.once("close", (code, signal) => {
			this.applyDiagnostics(jobName, stdout);
			const job = this.jobs.get(jobName);
			if (!job) {
				return;
			}
			job.completedAt = new Date().toISOString();
			if (code === 0) {
				job.error = null;
				job.status = "succeeded";
				return;
			}
			const diagnostics = parseNoticeJobDiagnostics(stdout);
			job.error =
				stderr.trim() ||
				(spawnError ? `本地通知任务启动失败：${spawnError.message}` : null) ||
				diagnostics.error ||
				(signal
					? `本地通知任务被信号 ${signal} 终止。`
					: `本地通知任务退出码：${code ?? "未知"}。`);
			job.status = "failed";
		});
	}

	private applyDiagnostics(jobName: string, stdout: string): void {
		const job = this.jobs.get(jobName);
		if (!job) {
			return;
		}
		const diagnostics = parseNoticeJobDiagnostics(stdout);
		job.progress = diagnostics.progress;
		job.processedRange = diagnostics.processedRange;
		job.maintenanceRange = diagnostics.maintenanceRange;
		job.summary = diagnostics.summary;
	}

	private fail(jobName: string, error: string): void {
		const job = this.jobs.get(jobName);
		if (!job) {
			return;
		}
		job.completedAt = new Date().toISOString();
		job.error = error;
		job.status = "failed";
	}
}

export function localNoticeCommand(
	input: NoticeJobCreate,
	environment: NodeJS.ProcessEnv = process.env,
): LocalNoticeCommand {
	const env = { ...environment };
	switch (input.operation) {
		case "notice-rescan":
			return {
				args: [...collectionArgs("notice-rescan"), "--from", input.from, "--to", input.to],
				env,
			};
		case "notice-sync":
			return { args: collectionArgs("notice-sync"), env };
		case "notice-backfill":
			return {
				args: collectionArgs("notice-backfill"),
				env: { ...env, INTERNAL_PORTAL_NOTICE_START_DATE: input.startDate },
			};
		case "notice-classify-missing":
			return { args: ["--dir", "jobs/notice-classifier", "run", "classify:local"], env };
		case "notice-reclassify-all":
			return {
				args: ["--dir", "jobs/notice-classifier", "run", "classify:local", "--all"],
				env,
			};
		case "notice-classify-one":
			return {
				args: [
					"--dir",
					"jobs/notice-classifier",
					"run",
					"classify:local",
					"--notice-id",
					String(input.noticeId),
				],
				env,
			};
		case "notice-publish-pending":
			return { args: publisherArgs("publish"), env };
		case "notice-publish-one":
			return { args: publisherArgs("publish", input.noticeId), env };
		case "notice-republish-one":
			return { args: publisherArgs("republish", input.noticeId), env };
		default:
			throw new Error(`Unsupported local notice operation: ${input satisfies never}`);
	}
}

function collectionArgs(operation: "notice-backfill" | "notice-sync" | "notice-rescan"): string[] {
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

function publisherArgs(operation: "publish" | "republish", noticeId?: number): string[] {
	return [
		"--filter",
		"notice-publisher",
		"run",
		operation,
		...(noticeId === undefined ? [] : ["--notice-id", String(noticeId)]),
	];
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
