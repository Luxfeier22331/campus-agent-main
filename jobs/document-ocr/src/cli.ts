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
import { selectNoticeInputs } from "./sources.ts";

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
			const run = async (task: OcrTask) => {
				if (controller.signal.aborted || (task.status === "pending" && newSubmissions >= 10)) {
					return;
				}
				if (task.status === "pending") {
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
			// queue (the notice command's usual case) still submits new tasks.
			const queue = [...tasks];
			const worker = async () => {
				for (let task = queue.shift(); task; task = queue.shift()) {
					await run(task);
				}
			};
			const discover = async () => {
				if (!(command === "scan" || command === "notice")) {
					return;
				}
				const notice = command === "notice" ? required(values.notice, "--notice") : undefined;
				for await (const input of selectNoticeInputs(pool, objects, notice, {
					pdfOnly: values["pdf-only"],
				})) {
					if (newSubmissions >= 10 || controller.signal.aborted) {
						break;
					}
					const created = await store.create(input, config);
					if (created.status === "pending") {
						queue.push(created);
					}
				}
			};
			await Promise.all([discover(), ...Array.from({ length: concurrency }, worker)]);
			return { newSubmissions };
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
