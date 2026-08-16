import { z } from "zod";

import { formatZodIssues } from "./core.ts";

const RequiredTextSchema = z
	.string()
	.transform((value) => value.trim())
	.pipe(z.string().min(1));

const PositiveIntegerSchema = z.number().int().positive();

const ChunkRuntimeDefaultsSchema = z
	.object({
		strategy_name: RequiredTextSchema,
		chunk_size: PositiveIntegerSchema,
		max_chunk_size: PositiveIntegerSchema,
		chunk_overlap: z.number().int().nonnegative(),
		min_chunk_size: PositiveIntegerSchema,
	})
	.superRefine((value, context) => {
		if (value.max_chunk_size < value.chunk_size) {
			context.addIssue({
				code: "custom",
				message: "max_chunk_size must be greater than or equal to chunk_size",
				path: ["max_chunk_size"],
			});
		}
		if (value.chunk_overlap >= value.max_chunk_size) {
			context.addIssue({
				code: "custom",
				message: "chunk_overlap must be less than max_chunk_size",
				path: ["chunk_overlap"],
			});
		}
		if (value.min_chunk_size >= value.max_chunk_size) {
			context.addIssue({
				code: "custom",
				message: "min_chunk_size must be less than max_chunk_size",
				path: ["min_chunk_size"],
			});
		}
	});

const CollectionChunkProfileSchema = z.object({
	corpus: RequiredTextSchema,
	collection: RequiredTextSchema,
	chunk_profile_version: RequiredTextSchema,
	structured_input: RequiredTextSchema,
	runtime_defaults: ChunkRuntimeDefaultsSchema,
	cleaning_policy_version: RequiredTextSchema,
	lane_defaults: z.record(z.string(), ChunkRuntimeDefaultsSchema).default({}),
});

export interface CollectionChunkRuntimeDefaults {
	strategyName: string;
	chunkSize: number;
	maxChunkSize: number;
	chunkOverlap: number;
	minChunkSize: number;
}

export interface CollectionChunkProfile {
	corpus: string;
	collection: string;
	chunkProfileVersion: string;
	structuredInput: string;
	runtimeDefaults: CollectionChunkRuntimeDefaults;
	cleaningPolicyVersion: string;
	laneDefaults: Record<string, CollectionChunkRuntimeDefaults>;
}

export function parseCollectionChunkProfile(value: unknown): CollectionChunkProfile {
	const parsed = CollectionChunkProfileSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`collection chunk profile is invalid: ${formatZodIssues(parsed.error.issues, "profile").join(
				"; ",
			)}`,
		);
	}
	return {
		corpus: parsed.data.corpus,
		collection: parsed.data.collection,
		chunkProfileVersion: parsed.data.chunk_profile_version,
		structuredInput: parsed.data.structured_input,
		runtimeDefaults: toChunkRuntimeDefaults(parsed.data.runtime_defaults),
		cleaningPolicyVersion: parsed.data.cleaning_policy_version,
		laneDefaults: Object.fromEntries(
			Object.entries(parsed.data.lane_defaults).map(([lane, defaults]) => [
				lane,
				toChunkRuntimeDefaults(defaults),
			]),
		),
	};
}

function toChunkRuntimeDefaults(
	value: z.infer<typeof ChunkRuntimeDefaultsSchema>,
): CollectionChunkRuntimeDefaults {
	return {
		strategyName: value.strategy_name,
		chunkSize: value.chunk_size,
		maxChunkSize: value.max_chunk_size,
		chunkOverlap: value.chunk_overlap,
		minChunkSize: value.min_chunk_size,
	};
}
