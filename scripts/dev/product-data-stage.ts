import { readFile, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReaderObjectStore } from "../../jobs/campus-rag-index-publisher/src/types.ts";

/** Run-local disk cache. Concurrent requests for one key share one download. */
export function createStagedObjectStore(
	source: ReaderObjectStore,
	directory: string,
	signal: AbortSignal,
) {
	const files = new Map<string, Promise<string>>();
	const stats = { objects: 0, bytes: 0 };
	return {
		stats,
		async read(key: string): Promise<Uint8Array> {
			signal.throwIfAborted();
			let file = files.get(key);
			if (!file) {
				const path = join(directory, `object-${files.size}`);
				file = (async () => {
					const bytes = await source.read(key);
					signal.throwIfAborted();
					const disk = await statfs(directory);
					if (disk.bavail * disk.bsize < bytes.byteLength + 64 * 1024 * 1024) {
						throw new Error(`Insufficient staging space for object ${key}`);
					}
					await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
					stats.objects += 1;
					stats.bytes += bytes.byteLength;
					return path;
				})();
				files.set(key, file);
			}
			return readFile(await file);
		},
	};
}
