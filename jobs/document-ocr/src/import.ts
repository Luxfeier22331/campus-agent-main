import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
	type OcrConfig,
	type OcrObjects,
	type OcrTaskStore,
	persistResult,
} from "@campus-agent/document-ocr";

export async function importHistory(
	manifestPath: string,
	store: OcrTaskStore,
	objects: OcrObjects,
	config: OcrConfig,
) {
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	const root = resolve(dirname(manifestPath), "..");
	let imported = 0;
	let reused = 0;
	const missingImages: { taskId: string; images: string[] }[] = [];
	for (const resource of manifest.resources) {
		if (resource.processing.status !== "completed") {
			continue;
		}
		const ocr = resource.processing.ocr;
		const task = await store.create(
			{
				kind: "source",
				noticeId: String(resource.noticeId),
				key: resource.objectKey,
				contentType: resource.kind === "images" ? "image/*" : "application/pdf",
			},
			config,
		);
		if (task.status === "completed") {
			reused++;
			continue;
		}
		if (task.providerJobId && task.providerJobId !== ocr.jobId) {
			throw new Error("Existing OCR task conflicts with imported job");
		}
		const raw = new Uint8Array(await readFile(resolve(root, ocr.result.path)));
		task.result = await persistResult(task.id, raw, objects, { allowMissingImages: true });
		task.inputSha256 = resource.input.sha256;
		task.providerJobId = ocr.jobId;
		task.status = "completed";
		task.error = null;
		await store.save(task);
		if (task.result.missingImages.length > 0) {
			missingImages.push({ taskId: task.id, images: task.result.missingImages });
		}
		imported++;
	}
	return { imported, reused, missingImages };
}
