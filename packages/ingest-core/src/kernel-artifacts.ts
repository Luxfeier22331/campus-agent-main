import { type IngestionTaskEnvelope, validateRetrievalChunkSetV2 } from "ingestion-contracts";
import { z } from "zod";

import { encodeObjectKeySegment, formatZodIssues, parseJsonObjectBytes } from "./core.ts";

export const INGESTION_KERNEL_ARTIFACT_CONTENT_TYPE = "application/json";

const DocumentUnitsValidationReportSchema = z
	.object({
		error_count: z.number().int().nonnegative(),
		errors: z.array(z.string()),
		schema_version: z.literal("document_units_validation_report.v1"),
		unit_count: z.number().int().nonnegative(),
	})
	.refine((value) => value.error_count === value.errors.length, {
		message: "error_count must match errors length",
		path: ["error_count"],
	});

const KernelOutputSchemas = {
	"document_units_validation_report.v1": DocumentUnitsValidationReportSchema,
} as const;

export function buildIngestionKernelArtifactKey(input: {
	activityAttempt: number;
	kernelId: string;
	task: IngestionTaskEnvelope;
}): string {
	if (!Number.isSafeInteger(input.activityAttempt) || input.activityAttempt <= 0) {
		throw new Error("activityAttempt must be a positive integer");
	}
	return [
		"ingestion-kernels",
		encodeObjectKeySegment(input.task.registry_task_id),
		"runs",
		encodeObjectKeySegment(input.task.run_id),
		"attempts",
		String(input.activityAttempt),
		encodeObjectKeySegment(input.task.task_id),
		`${encodeObjectKeySegment(input.kernelId)}.json`,
	].join("/");
}

export function parseIngestionKernelJsonOutput(input: {
	expectedSchemaVersion: string;
	kernelId: string;
	stdout: Uint8Array;
}): { bytes: Uint8Array; errorCount: number; errors: string[]; value: Record<string, unknown> } {
	const value = parseJsonObjectBytes(input.stdout, `ingestion kernel ${input.kernelId} stdout`);
	if (value.schema_version !== input.expectedSchemaVersion) {
		throw new Error(
			`ingestion kernel ${input.kernelId} stdout expected schema_version ${input.expectedSchemaVersion}`,
		);
	}
	validateKernelOutputContract({
		expectedSchemaVersion: input.expectedSchemaVersion,
		kernelId: input.kernelId,
		value,
	});
	const errorCount = readKernelErrorCount(input.kernelId, value);
	const errors = readKernelErrors(input.kernelId, value);
	return {
		bytes: input.stdout,
		errorCount,
		errors,
		value,
	};
}

export class IngestionKernelReportedErrorsError extends Error {
	readonly errorCount: number;
	readonly errors: string[];
	readonly kernelId: string;

	constructor(input: { errorCount: number; errors: string[]; kernelId: string }) {
		super(
			`ingestion kernel ${input.kernelId} reported ${input.errorCount} validation error${input.errorCount === 1 ? "" : "s"}${formatKernelReportedErrors(input.errors)}`,
		);
		this.errorCount = input.errorCount;
		this.errors = [...input.errors];
		this.kernelId = input.kernelId;
	}
}

export function assertIngestionKernelOutputSucceeded(input: {
	errorCount: number;
	errors: string[];
	kernelId: string;
}): void {
	if (input.errorCount > 0) {
		throw new IngestionKernelReportedErrorsError(input);
	}
}

function validateKernelOutputContract(input: {
	expectedSchemaVersion: string;
	kernelId: string;
	value: Record<string, unknown>;
}): void {
	if (input.expectedSchemaVersion === "retrieval_chunk_set.v2") {
		const result = validateRetrievalChunkSetV2(input.value);
		if (!result.ok) {
			throw new Error(
				`ingestion kernel ${input.kernelId} stdout is invalid: ${result.errors.join("; ")}`,
			);
		}
		return;
	}
	const schema =
		KernelOutputSchemas[input.expectedSchemaVersion as keyof typeof KernelOutputSchemas];
	if (!schema) {
		throw new Error(
			`ingestion kernel ${input.kernelId} stdout has unsupported schema_version ${input.expectedSchemaVersion}`,
		);
	}
	const parsed = schema.safeParse(input.value);
	if (!parsed.success) {
		throw new Error(
			`ingestion kernel ${input.kernelId} stdout is invalid: ${formatZodIssues(
				parsed.error.issues,
				"stdout",
			).join("; ")}`,
		);
	}
}

function readKernelErrorCount(kernelId: string, value: Record<string, unknown>): number {
	const errorCount = value.error_count;
	if (typeof errorCount !== "number" || !Number.isInteger(errorCount) || errorCount < 0) {
		throw new Error(`ingestion kernel ${kernelId} stdout error_count is invalid`);
	}
	return errorCount;
}

function readKernelErrors(kernelId: string, value: Record<string, unknown>): string[] {
	const errors = value.errors;
	if (!Array.isArray(errors) || errors.some((item) => typeof item !== "string")) {
		throw new Error(`ingestion kernel ${kernelId} stdout errors is invalid`);
	}
	return [...errors];
}

function formatKernelReportedErrors(errors: string[]): string {
	if (errors.length === 0) {
		return ".";
	}
	return `: ${errors.slice(0, 5).join("; ").slice(0, 1000)}`;
}
