import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	listCollectionChunkProfileFiles,
	loadCollectionChunkProfilesFromRoot,
} from "../src/node.ts";

describe("ingest-core node registry loading", () => {
	it("loads collection chunk profiles recursively", () => {
		const root = mkdtempSync(join(tmpdir(), "ingest-core-chunk-profile-"));
		const profileDir = join(root, "regulations", "institutional_rules");
		mkdirSync(profileDir, { recursive: true });
		const profilePath = join(profileDir, "chunk-profile.json");
		writeFileSync(profilePath, JSON.stringify(chunkProfilePayload()));

		expect(listCollectionChunkProfileFiles(root)).toEqual([profilePath]);
		expect(
			loadCollectionChunkProfilesFromRoot(root).get("regulations/institutional_rules"),
		).toMatchObject({
			collection: "institutional_rules",
			corpus: "regulations",
			runtimeDefaults: {
				chunkSize: 260,
				maxChunkSize: 360,
				minChunkSize: 48,
			},
		});
	});

	it("rejects duplicate collection chunk profiles", () => {
		const root = mkdtempSync(join(tmpdir(), "ingest-core-chunk-profile-duplicate-"));
		const left = join(root, "left");
		const right = join(root, "right");
		mkdirSync(left, { recursive: true });
		mkdirSync(right, { recursive: true });
		writeFileSync(join(left, "chunk-profile.json"), JSON.stringify(chunkProfilePayload()));
		writeFileSync(join(right, "chunk-profile.json"), JSON.stringify(chunkProfilePayload()));

		expect(() => loadCollectionChunkProfilesFromRoot(root)).toThrow(
			"duplicate collection chunk profile: regulations/institutional_rules",
		);
	});
});

function chunkProfilePayload(): unknown {
	return {
		corpus: "regulations",
		collection: "institutional_rules",
		chunk_profile_version: "institutional_rules_semantic_v1",
		structured_input: "document_units_jsonl",
		runtime_defaults: {
			strategy_name: "institutional_rules_semantic_v1",
			chunk_size: 260,
			max_chunk_size: 360,
			chunk_overlap: 48,
			min_chunk_size: 48,
		},
		cleaning_policy_version: "institutional_rules_cleaning_v1",
	};
}
