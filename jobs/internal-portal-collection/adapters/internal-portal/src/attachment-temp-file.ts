import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { type FileHandle, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
	const handle = await open(filePath, "wx", 0o600);
	const hash = createHash("sha256");
	let byteSize = 0;
	let handleClosed = false;
	let removed = false;
	try {
		for await (const chunk of input.body) {
			input.abortSignal?.throwIfAborted();
			const nextByteSize = byteSize + chunk.byteLength;
			if (nextByteSize > input.maxBytes) {
				throw input.sizeLimitError(nextByteSize);
			}
			hash.update(chunk);
			await writeEntireChunk(handle, chunk);
			byteSize = nextByteSize;
		}
		await handle.close();
		handleClosed = true;
		const contentSha256 = hash.digest("hex");
		return {
			byteSize,
			contentSha256,
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
		if (!handleClosed) {
			await handle.close().catch(() => undefined);
		}
		await rm(temporaryDirectory, { force: true, recursive: true });
		throw error;
	}
}

async function writeEntireChunk(handle: FileHandle, chunk: Uint8Array): Promise<void> {
	let offset = 0;
	while (offset < chunk.byteLength) {
		const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
		if (bytesWritten <= 0) {
			throw new Error("temporary attachment file write made no progress");
		}
		offset += bytesWritten;
	}
}
