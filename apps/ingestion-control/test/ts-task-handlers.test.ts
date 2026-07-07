import {
	DEFAULT_EXECUTABLE_TS_TASKS,
	type ObjectStore,
	parseAuthenticatedNoticeNoticeFamilyConfig,
	sha256Hex,
} from "ingest-core";
import { describe, expect, it } from "vitest";
import { TsTaskHandlerNotRegisteredError } from "../src/task-executor";
import {
	createAuthenticatedNoticeTsTaskHandlerRegistry,
	createDefaultTsTaskHandlerRegistry,
} from "../src/ts-task-handlers";

describe("ingestion-control TS task handler runtime wiring", () => {
	it("registers every default executable TS task identity when dependencies are configured", () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		const registry = createDefaultTsTaskHandlerRegistry({
			authenticatedNoticeFamilyConfig: sampleNoticeFamilyConfig(),
			authenticatedNoticeObjectStore: objectStore,
			officialWebObjectStore: objectStore,
			wechatOfficialAccountObjectStore: objectStore,
		});

		expect(registry.registeredIdentities()).toEqual(
			DEFAULT_EXECUTABLE_TS_TASKS.map(
				({ inputContract: _inputContract, outputContract: _outputContract, ...identity }) =>
					identity,
			),
		);
		for (const task of DEFAULT_EXECUTABLE_TS_TASKS) {
			expect(
				registry.has({
					sourceFamily: task.sourceFamily,
					corpus: task.corpus,
					collection: task.collection,
					registryTaskId: task.registryTaskId,
				}),
			).toBe(true);
		}
	});

	it("fails closed when runtime dependencies for a default handler are missing", () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");
		const task = {
			collection: "internal_notice",
			corpus: "campus_notices",
			created_at: "2026-04-04T01:25:00.000Z",
			created_by: "operator",
			idempotency_key: "campus_notices/internal_notice/source_truth_materialize/run-001",
			input_contract: "authenticated_notice_capture_release.v1",
			input_ref: {
				kind: "object_store",
				uri: "s3://campus-agent-source/internal_portal/runs/site/capture-release.json",
			},
			output_contract: "authenticated_notice_source_truth.v1",
			registry_task_id: "source_truth_materialize",
			run_id: "run_internal_notice_20260404",
			schema_version: "ingestion_task_envelope.v2",
			source_channel: "internal_portal",
			source_family: "authenticated_notice",
			task_id: "task_internal_notice_source_truth_materialize_001",
			task_kind: "source_truth_materialize",
		} as const;

		expect(() => createDefaultTsTaskHandlerRegistry().require(task)).toThrow(
			TsTaskHandlerNotRegisteredError,
		);
		expect(() =>
			createDefaultTsTaskHandlerRegistry({
				authenticatedNoticeObjectStore: objectStore,
			}).require(task),
		).toThrow(TsTaskHandlerNotRegisteredError);

		const registry = createAuthenticatedNoticeTsTaskHandlerRegistry({
			noticeFamilyConfig: sampleNoticeFamilyConfig(),
			objectStore,
		});
		expect(
			registry.has({
				collection: "internal_notice",
				corpus: "campus_notices",
				registryTaskId: "source_truth_materialize",
				sourceFamily: "authenticated_notice",
			}),
		).toBe(true);
	});
});

class InMemoryObjectStore implements ObjectStore {
	readonly #objects = new Map<string, Uint8Array>();
	readonly bucket: string;

	constructor(bucket: string) {
		this.bucket = bucket;
	}

	async getObject(input: { bucket: string; key: string }): Promise<Uint8Array> {
		if (input.bucket !== this.bucket) {
			throw new Error(`unexpected bucket: ${input.bucket}`);
		}
		const object = this.#objects.get(input.key);
		if (!object) {
			throw new Error(`missing object: ${input.key}`);
		}
		return object;
	}

	async putObject(input: {
		bucket: string;
		key: string;
		body: Uint8Array;
		contentType: string;
	}): Promise<{ byteSize: number; contentSha256: string }> {
		if (input.bucket !== this.bucket) {
			throw new Error(`unexpected bucket: ${input.bucket}`);
		}
		this.#objects.set(input.key, input.body);
		return {
			byteSize: input.body.byteLength,
			contentSha256: sha256Hex(input.body),
		};
	}
}

function sampleNoticeFamilyConfig() {
	return parseAuthenticatedNoticeNoticeFamilyConfig({
		schema_version: "authenticated_notice_notice_family_classification_v1",
		corpus: "campus_notices",
		collection: "internal_notice",
		source_channel: "internal_portal",
		default_family: "other",
		default_admission_policy: "no_adoption",
		default_priority: 40,
		routing_policy: {
			family_policies: {
				other: {
					consumption_route: "notice_level_query",
					machine_processing_policy: "not_required",
				},
			},
			terminal_no_adoption_title_patterns: [],
			default_family_route_overrides: [],
			machine_processing_value_terms: [],
		},
		rules: [
			{
				family: "course_teaching_arrangement",
				admission_policy: "hold_notice_runtime",
				priority: 20,
				notice_type_names: ["教学通知"],
			},
		],
	});
}
