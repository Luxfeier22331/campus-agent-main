import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { ArtifactObjectStore } from "./types.ts";

export function createFilesystemArtifactStore(root: string): ArtifactObjectStore {
	const artifactRoot = resolve(root);
	const artifactPath = (key: string) => resolve(artifactRoot, key);
	return {
		async read(key) {
			return new Uint8Array(await readFile(artifactPath(key)));
		},
		async writeImmutable(key, body) {
			const path = artifactPath(key);
			await mkdir(dirname(path), { recursive: true });
			try {
				await writeFile(path, body, { flag: "wx" });
				return;
			} catch (error) {
				if (!isFileExistsError(error)) throw error;
			}
			const existing = await readFile(path);
			if (!existing.equals(Buffer.from(body))) {
				throw new Error(`immutable artifact conflicts with existing content: ${key}`);
			}
		},
	};
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === "EEXIST";
}
