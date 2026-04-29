import { rmSync } from "node:fs";
import { afterEach } from "vitest";
import type { ObjectStoreClient } from "../scripts/sync-real-docs/storage";

export class FakeObjectStore implements ObjectStoreClient {
	private readonly objects: ReadonlyMap<string, Uint8Array | string>;

	constructor(objects: ReadonlyMap<string, Uint8Array | string>) {
		this.objects = objects;
	}

	async readTextObject({ key }: { bucket?: string; key: string }): Promise<string> {
		const value = this.objects.get(key);
		if (value === undefined) {
			throw new Error(`missing object: ${key}`);
		}
		return typeof value === "string" ? value : new TextDecoder().decode(value);
	}

	async readOptionalBytesObject({
		key,
	}: {
		bucket?: string;
		key: string;
	}): Promise<Uint8Array | undefined> {
		const value = this.objects.get(key);
		if (value === undefined) {
			return;
		}
		return typeof value === "string" ? new TextEncoder().encode(value) : value;
	}

	async listObjectKeys({ prefix }: { bucket?: string; prefix: string }): Promise<string[]> {
		return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
	}
}

export const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});
