import type { OcrObjects, OcrPage } from "@campus-agent/document-ocr";
import type { PoolClient } from "pg";

interface LegacyPage {
	markdownKey: string;
	images: string[];
}
interface LegacyTask {
	id: string;
	result: { rawKey: string; missingImages?: string[]; pages: LegacyPage[] };
}

async function legacyTasks(client: PoolClient): Promise<LegacyTask[]> {
	const result = await client.query<{ id: string; result: LegacyTask["result"] }>(
		"select id, result from ocr.tasks where result->'pages' is not null",
	);
	return result.rows.map((row) => ({ id: row.id, result: row.result }));
}

async function storedPages(client: PoolClient, taskId: string): Promise<OcrPage[]> {
	const result = await client.query<OcrPage>(
		"select page_index as index, markdown, images from ocr.pages where task_id=$1 order by page_index",
		[taskId],
	);
	return result.rows;
}

function samePage(a: OcrPage, b: OcrPage) {
	return (
		a.index === b.index &&
		a.markdown === b.markdown &&
		JSON.stringify(a.images) === JSON.stringify(b.images)
	);
}

function assertLegacyPages(task: LegacyTask) {
	if (
		!Array.isArray(task.result.pages) ||
		task.result.pages.length === 0 ||
		task.result.pages.some(
			(page, index) =>
				page.markdownKey !== `ocr/tasks/${task.id}/page-${String(index).padStart(3, "0")}.md` ||
				!Array.isArray(page.images),
		)
	) {
		throw new Error(`Invalid legacy OCR page references: ${task.id}`);
	}
}

export async function migratePages(client: PoolClient, objects: OcrObjects, dryRun = false) {
	let migrated = 0;
	for (const task of await legacyTasks(client)) {
		assertLegacyPages(task);
		const pages: OcrPage[] = [];
		const legacy = task.result.pages;
		for (const [index, page] of legacy.entries()) {
			pages.push({
				index,
				markdown: new TextDecoder().decode(await objects.getDerived(page.markdownKey)),
				images: page.images,
			});
		}
		const existing = await storedPages(client, task.id);
		if (
			existing.some((page) => {
				const expected = pages[page.index];
				return !(expected && samePage(page, expected));
			})
		) {
			throw new Error(`Stored OCR pages conflict with legacy result: ${task.id}`);
		}
		if (dryRun) {
			migrated++;
			continue;
		}
		await client.query("begin");
		try {
			for (const page of pages) {
				await client.query(
					"insert into ocr.pages(task_id,page_index,markdown,images) values($1,$2,$3,$4) on conflict(task_id,page_index) do nothing",
					[task.id, page.index, page.markdown, page.images],
				);
			}
			await client.query("commit");
			migrated++;
		} catch (error) {
			await client.query("rollback");
			throw error;
		}
	}
	return { migrated, dryRun };
}

export async function cleanupPageObjects(client: PoolClient, objects: OcrObjects, dryRun = false) {
	let cleaned = 0;
	for (const task of await legacyTasks(client)) {
		assertLegacyPages(task);
		const pages = await storedPages(client, task.id);
		if (pages.length !== task.result.pages.length) {
			throw new Error(`OCR page migration incomplete: ${task.id}`);
		}
		for (const [index, legacy] of task.result.pages.entries()) {
			const page = pages[index];
			if (
				!page ||
				page.index !== index ||
				JSON.stringify(page.images) !== JSON.stringify(legacy.images)
			) {
				throw new Error(`OCR page references differ: ${task.id}/${index}`);
			}
			let markdown: string;
			try {
				markdown = new TextDecoder().decode(await objects.getDerived(legacy.markdownKey));
			} catch (error) {
				// A prior cleanup can stop after deleting some objects but before clearing the task field.
				if (
					error instanceof Error &&
					(error.name === "NoSuchKey" ||
						(error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ===
							404)
				) {
					continue;
				}
				throw error;
			}
			if (page.markdown !== markdown) {
				throw new Error(`OCR page body differs: ${task.id}/${index}`);
			}
		}
		if (dryRun) {
			cleaned++;
			continue;
		}
		for (const page of task.result.pages) {
			await objects.deleteDerived(page.markdownKey);
		}
		await client.query("update ocr.tasks set result=result-'pages' where id=$1", [task.id]);
		cleaned++;
	}
	return { cleaned, dryRun };
}
