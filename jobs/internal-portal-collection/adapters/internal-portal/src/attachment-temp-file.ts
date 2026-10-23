import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export interface TemporaryAttachmentFile {
	byteSize: number;
	contentSha256: string;
	filePath: string;
	openReadStream(): ReturnType<typeof createReadStream>;
	remove(): Promise<void>;
}

export async function spoolAttachmentToTemporaryFile(input: {
	abortSignal?: AbortSignal;
	body: AsyncIterable<Uint8Array>;
	maxBytes: number;
	sizeLimitError: (observedBytes: number) => Error;
}): Promise<TemporaryAttachmentFile> {
	input.abortSignal?.throwIfAborted();
	const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "campus-agent-attachment-"));
	const filePath = path.join(temporaryDirectory, "body");
	const hash = createHash("sha256");
	let byteSize = 0;
	let removed = false;
	try {
		await pipeline(
			input.body,
			async function* measure(source: AsyncIterable<Uint8Array>) {
				for await (const chunk of source) {
					byteSize += chunk.byteLength;
					if (byteSize > input.maxBytes) {
						throw input.sizeLimitError(byteSize);
					}
					hash.update(chunk);
					yield chunk;
				}
			},
			createWriteStream(filePath, { flags: "wx", mode: 0o600 }),
			input.abortSignal ? { signal: input.abortSignal } : {},
		);
		return {
			byteSize,
			contentSha256: hash.digest("hex"),
			filePath,
			openReadStream: () => createReadStream(filePath),
			async remove() {
				if (removed) {
					return;
				}
				removed = true;
				await rm(temporaryDirectory, { force: true, recursive: true });
			},
		};
	} catch (error) {
		await rm(temporaryDirectory, { force: true, recursive: true });
		// pipeline reports cancellation as a generic AbortError; surface the caller's reason instead.
		input.abortSignal?.throwIfAborted();
		throw error;
	}
}
