import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { InvalidRequestError, RateLimitError } from "@paddleocr/api-sdk";
import { normalizeImageInput } from "./image-input.ts";
import { createPaddleClient, downloadResource } from "./provider.ts";
import { OcrResultError, persistResult } from "./results.ts";
import type { OcrConfig, OcrObjects, OcrPage, OcrTask, OcrTaskStore } from "./types.ts";

// Provider submissions reject bursts (observed: 6 same-second submissions
// returned 429 while 5 or fewer passed). Serialize submissions with a minimum
// spacing so worker concurrency does not translate into submission bursts.
const SUBMISSION_INTERVAL_MS = 2_000;
let submissionChain: Promise<unknown> = Promise.resolve();
export async function throttledSubmission<T>(
	submit: () => Promise<T>,
	intervalMs = SUBMISSION_INTERVAL_MS,
): Promise<T> {
	const run = submissionChain.then(async () => {
		await sleep(intervalMs);
		return await submit();
	});
	submissionChain = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

export interface RunOcrOptions {
	store: OcrTaskStore;
	objects: OcrObjects;
	config: OcrConfig;
	signal?: AbortSignal;
	waitMs?: number;
	pollMs?: number;
	submissionIntervalMs?: number;
	client?: ReturnType<typeof createPaddleClient>;
	download?: (url: string) => Promise<Uint8Array>;
	reportValidation?: (updatedAt: string, passed: boolean, message: string) => Promise<void>;
}
export async function runOcrTask(task: OcrTask, options: RunOcrOptions): Promise<OcrTask> {
	const { store, objects, config } = options;
	if (task.status === "completed" || task.status === "failed") {
		return task;
	}
	const signal = AbortSignal.any([
		AbortSignal.timeout(options.waitMs ?? 600_000),
		...(options.signal ? [options.signal] : []),
	]);
	async function finishResult(raw?: Uint8Array) {
		let pages: OcrPage[];
		let result = task.result;
		if (task.result) {
			pages = await store.getPages(task.id);
		} else {
			if (!raw) {
				throw new OcrResultError("OCR result missing");
			}
			const persisted = await persistResult(
				task.id,
				raw,
				objects,
				options.download ? { download: options.download } : {},
			);
			result = persisted.result;
			pages = persisted.pages;
		}
		if (!(result && pages.length > 0)) {
			throw new OcrResultError("OCR result has no stored pages");
		}
		if (task.input.kind === "validation") {
			if (!task.result) {
				await store.saveResult(task, pages, result);
			}
			const storedPages = await store.getPages(task.id);
			const firstPage = storedPages[0];
			if (storedPages.length !== 1 || !firstPage) {
				throw new OcrResultError("OCR validation must return one page");
			}
			const text = firstPage.markdown;
			if (!(text.includes("CAMPUS") && text.includes("12345"))) {
				throw new OcrResultError("OCR validation text was not recognized");
			}
			await options.reportValidation?.(
				task.configUpdatedAt,
				true,
				"Paddle OCR one-page parsing completed.",
			);
		}
		const completed = { ...task, status: "completed" as const, error: null };
		await store.saveResult(completed, pages, result);
		Object.assign(task, completed);
	}
	try {
		if (task.status === "submitting" && !task.providerJobId) {
			throw new OcrResultError(
				"Submission interrupted without a jobId; provider acceptance is unknown. Explicit rerun required.",
			);
		}
		// Own results survive provider job/URL expiry and allow callback-only recovery.
		if (task.result) {
			await finishResult();
			return task;
		}
		if (task.providerJobId) {
			let cached: Uint8Array | undefined;
			try {
				cached = await objects.getDerived(`ocr/tasks/${task.id}/result.jsonl`);
			} catch {
				/* Not downloaded yet. */
			}
			if (cached) {
				await finishResult(cached);
				return task;
			}
		}
		const client = options.client ?? createPaddleClient(config, task.target);
		if (!task.providerJobId) {
			if (
				task.input.kind === "validation" &&
				Date.parse(task.configUpdatedAt) !== Date.parse(config.updatedAt)
			) {
				throw new OcrResultError(
					"Configuration changed before validation started; start a new validation task.",
				);
			}
			const sourceBytes =
				task.input.kind === "validation"
					? validationDocument()
					: task.input.kind === "source"
						? await objects.getSource(task.input.key)
						: await objects.getDerived(task.input.key);
			const bytes =
				task.input.kind === "source" && task.input.contentType.startsWith("image/")
					? (await normalizeImageInput(sourceBytes)).bytes
					: sourceBytes;
			task.inputSha256 = createHash("sha256").update(sourceBytes).digest("hex");
			const directory = await mkdtemp(join(tmpdir(), "document-ocr-"));
			try {
				const path = join(directory, `input${fileExtension(bytes)}`);
				await writeFile(path, bytes);
				const submitted = await throttledSubmission(async () => {
					// A run stopped while queued behind the spacing never contacts the provider.
					signal.throwIfAborted();
					task.status = "submitting";
					await store.save(task);
					return await client.submitDocumentParsing(
						{ filePath: path, model: task.target.model, options: task.target.options },
						{ signal },
					);
				}, options.submissionIntervalMs);
				task.providerJobId = submitted.jobId;
				task.status = "submitted";
				await store.save(task);
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		}
		while (!signal.aborted) {
			const status = await client.getStatus(task.providerJobId, { signal });
			task.progress = status.progress ?? null;
			task.error = null;
			await store.save(task);
			if (status.state === "failed") {
				throw new OcrResultError(status.errorMsg || "Paddle OCR job failed");
			}
			if (status.state === "done") {
				if (!status.resultUrl?.jsonUrl) {
					throw new OcrResultError("Paddle OCR completed without a result URL");
				}
				const raw = await (options.download ?? downloadResource)(status.resultUrl.jsonUrl);
				await finishResult(raw);
				return task;
			}
			await sleep(options.pollMs ?? 5_000, undefined, { signal });
		}
	} catch (error) {
		// Rate limiting and a full provider queue reject the submission without
		// accepting it; the task can safely return to pending for a later run.
		// A run stopped before submission started leaves nothing at the provider either.
		if (
			!task.providerJobId &&
			((task.status === "pending" && signal.aborted) ||
				(task.status === "submitting" && isDeferredSubmission(error)))
		) {
			task.status = "pending";
			task.error = null;
			await store.save(task);
			return task;
		}
		task.error = error instanceof Error ? error.message : String(error);
		const terminal = !task.providerJobId || error instanceof OcrResultError;
		if (terminal) {
			if (!task.providerJobId && task.status === "submitting") {
				task.error =
					error instanceof InvalidRequestError
						? `Provider rejected the submission; explicit rerun required. ${task.error}`
						: `Submission outcome unknown; explicit rerun required. ${task.error}`;
			}
			try {
				if (task.input.kind === "validation") {
					await options.reportValidation?.(task.configUpdatedAt, false, task.error);
				}
				task.status = "failed";
			} catch (reportError) {
				// Retain a runnable state until Model Config accepts (or rejects as stale) the report.
				task.status = task.providerJobId ? "submitted" : "submitting";
				task.error += `; ${reportError instanceof Error ? reportError.message : String(reportError)}`;
			}
		} else {
			task.status = "submitted";
		}
		await store.save(task);
	}
	return task;
}

// The provider reports a full submission queue as HTTP 400, which the SDK
// maps to InvalidRequestError; only the message distinguishes it.
function isDeferredSubmission(error: unknown): boolean {
	return (
		error instanceof RateLimitError ||
		(error instanceof InvalidRequestError && error.message.includes("队列已满"))
	);
}

export function fileExtension(bytes: Uint8Array): string {
	if (new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") {
		return ".pdf";
	}
	if (bytes[0] === 0xff && bytes[1] === 0xd8) {
		return ".jpg";
	}
	if (bytes[0] === 0x89 && bytes[1] === 0x50) {
		return ".png";
	}
	throw new Error("OCR input must be a PDF, JPEG or PNG");
}

// Small synthetic one-page PDF; no collected content is used to validate credentials.
export function validationDocument(): Uint8Array {
	const stream = "BT /F1 28 Tf 50 740 Td (CAMPUS OCR 12345) Tj ET";
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
	];
	let pdf = "%PDF-1.4\n";
	const offsets = [0];
	for (const [index, object] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf));
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}
	const xref = Buffer.byteLength(pdf);
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets.slice(1)) {
		pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
	}
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(pdf);
}
