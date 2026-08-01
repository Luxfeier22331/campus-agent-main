import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { PublishedObjectRef, ReaderObjectStoreClient } from "./published-reader-types.ts";

export function createCachingReaderObjectStore(input: {
	client: ReaderObjectStoreClient;
	objectsRoot: string;
}): ReaderObjectStoreClient {
	return {
		async readOptionalBytesObject({ key }) {
			const bytes = await input.client.readOptionalBytesObject({ key });
			if (!bytes) {
				return;
			}
			const target = preparedReaderObjectPath(input.objectsRoot, { key });
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, bytes, { mode: 0o600 });
			return bytes;
		},
	};
}

export function preparedReaderObjectPath(
	root: string,
	ref: Pick<PublishedObjectRef, "key">,
): string {
	const keyDigest = createHash("sha256").update(ref.key).digest("hex");
	return resolve(root, `${keyDigest}.bin`);
}
