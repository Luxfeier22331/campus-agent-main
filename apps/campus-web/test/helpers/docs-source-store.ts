import { sha256 } from "../../src/docs-reader-build/artifact-digest.ts";
import type { DocsSourceObjectStore } from "../../src/docs-reader-build/published-reader-types.ts";

export function createMemoryDocsSourceStore(
	objects = new Map<string, Uint8Array>(),
): DocsSourceObjectStore & { objects: Map<string, Uint8Array> } {
	return {
		objects,
		async readOptionalBytesObject({ key }) {
			return objects.get(key);
		},
		async readOptionalObject({ key }) {
			const body = objects.get(key);
			return body ? { body, etag: sha256(body) } : undefined;
		},
		async writeBytesObject({ key, body, ifMatch, ifNoneMatch }) {
			const current = objects.get(key);
			if (
				(ifNoneMatch === "*" && current) ||
				(ifMatch && (!current || sha256(current) !== ifMatch))
			) {
				throw Object.assign(new Error("Precondition failed"), {
					name: "PreconditionFailed",
					$metadata: { httpStatusCode: 412 },
				});
			}
			objects.set(key, body);
		},
	};
}
