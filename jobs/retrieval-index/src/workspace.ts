import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ObjectReference, Sha256Ref } from "./types.ts";

export function digest(value: Uint8Array | string): Sha256Ref {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
export function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object")
		return `{${Object.entries(value)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
			.join(",")}}`;
	return JSON.stringify(value);
}
export interface StreamStore {
	read(key: string): Promise<Uint8Array>;
	stream(key: string): AsyncIterable<Uint8Array>;
}
/** A record is yielded only within a bounded line buffer; digest is checked at EOF. */
export async function* records(store: StreamStore, ref: ObjectReference): AsyncGenerator<unknown> {
	const hash = createHash("sha256");
	let size = 0;
	let pending = "";
	const decoder = new TextDecoder("utf-8", { fatal: true });
	for await (const bytes of store.stream(ref.key)) {
		hash.update(bytes);
		size += bytes.byteLength;
		pending += decoder.decode(bytes, { stream: true });
		let end: number;
		while ((end = pending.indexOf("\n")) >= 0) {
			const line = pending.slice(0, end);
			pending = pending.slice(end + 1);
			if (!line || Buffer.byteLength(line) > 8 * 1024 * 1024)
				throw new Error("invalid artifact record size");
			yield JSON.parse(line);
		}
		if (Buffer.byteLength(pending) > 8 * 1024 * 1024)
			throw new Error("artifact record exceeds 8 MiB");
	}
	pending += decoder.decode();
	if (pending || size !== ref.byteSize || `sha256:${hash.digest("hex")}` !== ref.sha256)
		throw new Error(`artifact identity mismatch: ${ref.key}`);
}
export async function manifest<T>(store: StreamStore, key: string, id: Sha256Ref): Promise<T> {
	const bytes = await store.read(key);
	if (digest(bytes) !== id) throw new Error(`manifest identity mismatch: ${key}`);
	return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
}
export async function workspace() {
	const root = process.env.RETRIEVAL_WORK_DIR ?? "var/retrieval-work";
	await mkdir(root, { recursive: true });
	const directory = await mkdtemp(join(root, "job-"));
	const db = new DatabaseSync(join(directory, "work.sqlite"));
	db.exec(
		"PRAGMA cache_size=-16384; PRAGMA temp_store=FILE; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;",
	);
	return {
		db,
		directory,
		async close() {
			db.close();
			await rm(directory, { recursive: true, force: true });
		},
	};
}
