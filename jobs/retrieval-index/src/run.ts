import { applyIndex } from "./apply.ts";
import { createArtifactStore } from "./stream-store.ts";
import type { Sha256Ref } from "./types.ts";

/** Local CLI and production CLI use exactly the same versioned apply. */
export async function runCampusRagPublish(input: {
	docsEmbeddingSet: Sha256Ref;
	noticeEmbeddingSet: Sha256Ref;
	env?: NodeJS.ProcessEnv;
}) {
	const store = createArtifactStore(input.env ?? process.env, true);
	try {
		return await applyIndex({
			store,
			docs: input.docsEmbeddingSet,
			notices: input.noticeEmbeddingSet,
			graceMs: 0,
			...(input.env ? { env: input.env } : {}),
		});
	} finally {
		store.close();
	}
}
