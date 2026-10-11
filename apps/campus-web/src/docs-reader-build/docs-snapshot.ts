import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ReaderObjectStoreClient } from "./published-reader-types.ts";

const objectPath = (root: string, key: string) =>
	resolve(root, "objects", createHash("sha256").update(key).digest("hex"));

export function snapshotReader(root: string): ReaderObjectStoreClient {
	return {
		async readOptionalBytesObject({ key }) {
			try {
				return await readFile(objectPath(root, key));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					return;
				}
				throw error;
			}
		},
	};
}

export async function recordingSnapshotReader(
	root: string,
	client: ReaderObjectStoreClient,
): Promise<ReaderObjectStoreClient> {
	await mkdir(resolve(root, "objects"), { recursive: true });
	const reads = new Map<string, Promise<Uint8Array | undefined>>();
	return {
		readOptionalBytesObject({ key }) {
			let pending = reads.get(key);
			if (!pending) {
				pending = client.readOptionalBytesObject({ key }).then(async (bytes) => {
					if (bytes) {
						await writeFile(objectPath(root, key), bytes);
					}
					return bytes;
				});
				reads.set(key, pending);
			}
			return pending;
		},
	};
}
