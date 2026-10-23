import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
	createOcrObjects,
	fileExtension,
	type OcrTask,
	reportOcrValidation,
	resolveOcrConfig,
	runOcrTask,
	withOcrLock,
} from "@campus-agent/document-ocr";
import { createNoticeDatabasePool } from "@campus-agent/notice-database";
import { importHistory } from "./import.ts";
import { cleanupPageObjects, migratePages } from "./page-migration.ts";
import { selectNoticeInputs, selectUncoveredNoticeInputs } from "./sources.ts";
import { runTaskPool } from "./task-pool.ts";

export async function main() {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: {
			notice: { type: "string" },
			file: { type: "string" },
			task: { type: "string" },
			directory: { type: "string" },
			manifest: { type: "string" },
			concurrency: { type: "string" },
			"max-submissions": { type: "string" },
			"since-days": { type: "string" },
			"dry-run": { type: "boolean", default: false },
			"pdf-only": { type: "boolean", default: false },
		},
	});
	const command = positionals[0] ?? "scan";
	if (
		![
			"scan",
			"file",
			"notice",
			"resume",
			"rerun",
			"export",
			"import",
			"validate",
			"migrate-pages",
			"cleanup-page-objects",
		].includes(command)
	) {
		throw new Error("Unknown OCR command");
	}
	if (values["pdf-only"] && !["scan", "notice"].includes(command)) {
		throw new Error("--pdf-only is supported only with scan or notice");
	}
	if (values.concurrency !== undefined && !["scan", "notice", "resume"].includes(command)) {
		throw new Error("--concurrency is supported only with scan, notice or resume");
	}
	const concurrency = values.concurrency ? Number(values.concurrency) : 8;
	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
		throw new Error("--concurrency must be an integer between 1 and 32");
	}
	if (values["max-submissions"] !== undefined && !["scan", "notice", "resume"].includes(command)) {
		throw new Error("--max-submissions is supported only with scan, notice or resume");
	}
	const maxSubmissions = values["max-submissions"] ? Number(values["max-submissions"]) : 10;
	if (!Number.isInteger(maxSubmissions) || maxSubmissions < 1 || maxSubmissions > 1000) {
		throw new Error("--max-submissions must be an integer between 1 and 1000");
	}
	if (values["since-days"] !== undefined && command !== "scan") {
		throw new Error("--since-days is supported only with scan");
	}
	const sinceDays = values["since-days"] ? Number(values["since-days"]) : undefined;
	if (sinceDays !== undefined && (!Number.isInteger(sinceDays) || sinceDays < 1)) {
		throw new Error("--since-days must be a positive integer");
	}
	const pool = createNoticeDatabasePool(process.env, { max: Math.max(2, concurrency + 1) });
	const objects = createOcrObjects(process.env);
	const modelUrl = process.env.MODEL_CONFIG_URL || "http://model-config:8000";
	const controller = new AbortController();
	const stop = () => controller.abort();
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);
	try {
		const outcome = await withOcrLock(pool, async (store, client) => {
			if (command === "migrate-pages") {
				return migratePages(client, objects, values["dry-run"]);
			}
			if (command === "cleanup-page-objects") {
				return cleanupPageObjects(client, objects, values["dry-run"]);
			}
			if (command === "export") {
				const task = await store.get(required(values.task, "--task"));
				if (!task?.result) {
					throw new Error("OCR task has no stored result");
				}
				const directory = resolve(required(values.directory, "--directory"), task.id);
				const pages = await store.getPages(task.id);
				for (const [relative, bytes] of [
					["result.jsonl", await objects.getDerived(task.result.rawKey)] as const,
					...pages.map(
						(page) =>
							[
								`page-${String(page.index).padStart(3, "0")}.md`,
								new TextEncoder().encode(page.markdown),
							] as const,
					),
				]) {
					const path = resolve(directory, relative);
					await mkdir(dirname(path), { recursive: true });
					await writeFile(path, bytes);
				}
				for (const key of pages.flatMap((page) => page.images)) {
					const relative = key.slice(`ocr/tasks/${task.id}/`.length);
					const path = resolve(directory, relative);
					await mkdir(dirname(path), { recursive: true });
					await writeFile(path, await objects.getDerived(key));
				}
				return { exported: task.id, directory };
			}
			const config = await resolveOcrConfig(modelUrl);
			if (command === "import") {
				return importHistory(required(values.manifest, "--manifest"), store, objects, config);
			}
			let tasks: OcrTask[] = [];
			if (command === "file") {
				const body = new Uint8Array(await readFile(required(values.file, "--file")));
				const extension = fileExtension(body);
				const key = `ocr/inputs/${createHash("sha256").update(body).digest("hex")}${extension}`;
				await objects.putDerived(
					key,
					body,
					extension === ".pdf"
						? "application/pdf"
						: `image/${extension === ".jpg" ? "jpeg" : "png"}`,
				);
				tasks.push(
					await store.create(
						{
							kind: "uploaded",
							key,
							contentType: extension === ".pdf" ? "application/pdf" : "image/*",
						},
						config,
					),
				);
			} else if (command === "validate") {
				tasks.push(await store.create({ kind: "validation" }, config));
			} else if (values.task) {
				const task = await store.get(values.task);
				if (!task) {
					throw new Error("OCR task not found");
				}
				if (command === "rerun") {
					tasks.push(await store.create(task.input, config, true));
				} else {
					if (task.status === "failed" && !task.providerJobId) {
						throw new Error("No provider jobId; explicit rerun required");
					}
					if (task.status === "failed") {
						task.status = "submitted";
						await store.save(task);
					}
					tasks.push(task);
				}
			} else {
				tasks = await store.runnable();
			}
			let newSubmissions = 0;
			// A deferred submission means the provider is saturated; this run only
			// finishes accepted work and leaves the remaining tasks pending.
			let deferred = false;
			const submissionsClosed = () =>
				controller.signal.aborted || deferred || newSubmissions >= maxSubmissions;
			const run = async (task: OcrTask) => {
				const submits = task.status === "pending";
				if (controller.signal.aborted || (submits && submissionsClosed())) {
					return;
				}
				if (submits) {
					newSubmissions++;
				}
				const result = await runOcrTask(task, {
					store,
					objects,
					config,
					signal: controller.signal,
					reportValidation: (updatedAt, passed, message) =>
						reportOcrValidation(modelUrl, updatedAt, passed, message),
				});
				if (submits && result.status === "pending") {
					deferred = true;
				}
				console.log(
					JSON.stringify({
						taskId: result.id,
						status: result.status,
						progress: result.progress,
						error: result.error,
					}),
				);
			};
			// Submitted work always precedes new submissions.
			tasks.sort((a, b) => Number(a.status === "pending") - Number(b.status === "pending"));
			// Provider jobs run async; a bounded worker pool overlaps submission,
			// polling and result download across tasks instead of serializing them.
			// Discovery fills the queue while workers drain it, so an empty initial
			// queue (the scan and notice commands' usual case) still submits new tasks.
			await runTaskPool(
				tasks,
				concurrency,
				async (push) => {
					if (!(command === "scan" || command === "notice")) {
						return;
					}
					const inputs =
						command === "notice"
							? selectNoticeInputs(pool, objects, required(values.notice, "--notice"), {
									pdfOnly: values["pdf-only"],
								})
							: selectUncoveredNoticeInputs(pool, objects, {
									pdfOnly: values["pdf-only"],
									...(sinceDays === undefined
										? {}
										: { since: new Date(Date.now() - sinceDays * 86_400_000) }),
								});
					for await (const input of inputs) {
						if (submissionsClosed()) {
							break;
						}
						const created = await store.create(input, config);
						if (created.status === "pending") {
							push(created);
						}
					}
				},
				run,
			);
			return { newSubmissions, deferred };
		});
		if (outcome === null && ["migrate-pages", "cleanup-page-objects"].includes(command)) {
			throw new Error("OCR runner already active; page migration/cleanup was not executed");
		}
		console.log(JSON.stringify({ summary: outcome ?? { skipped: "OCR runner already active" } }));
	} finally {
		process.off("SIGTERM", stop);
		process.off("SIGINT", stop);
		objects.close();
		await pool.end();
	}
}
function required(value: string | undefined, flag: string) {
	if (!value) {
		throw new Error(`${flag} is required`);
	}
	return value;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
