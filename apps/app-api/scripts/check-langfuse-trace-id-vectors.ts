import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	deriveLangfuseTraceId,
	traceParentForLangfuseTraceId,
} from "../src/modules/telemetry/trace";

interface LangfuseTraceIdVector {
	langfuse_trace_id: string;
	product_trace_id: string;
	traceparent: string;
}

interface LangfuseTraceIdVectorFixture {
	schema_version: "langfuse_trace_id_vectors.v1";
	vectors: LangfuseTraceIdVector[];
}

function loadFixture(): LangfuseTraceIdVectorFixture {
	const fixturePath = resolve(process.cwd(), "../../tests/fixtures/langfuse_trace_id_vectors.json");
	return JSON.parse(readFileSync(fixturePath, "utf-8")) as LangfuseTraceIdVectorFixture;
}

function main(): number {
	const fixture = loadFixture();
	if (fixture.schema_version !== "langfuse_trace_id_vectors.v1") {
		throw new Error(`Unsupported Langfuse trace id vector schema: ${fixture.schema_version}`);
	}
	if (!Array.isArray(fixture.vectors) || fixture.vectors.length === 0) {
		throw new Error("Langfuse trace id vectors must not be empty.");
	}
	for (const vector of fixture.vectors) {
		const actualTraceId = deriveLangfuseTraceId(vector.product_trace_id);
		if (actualTraceId !== vector.langfuse_trace_id) {
			throw new Error(
				`Langfuse trace id mismatch for ${vector.product_trace_id}: ${actualTraceId}`,
			);
		}
		const actualTraceParent = traceParentForLangfuseTraceId(vector.langfuse_trace_id);
		if (actualTraceParent !== vector.traceparent) {
			throw new Error(
				`Langfuse traceparent mismatch for ${vector.product_trace_id}: ${actualTraceParent}`,
			);
		}
	}
	return 0;
}

process.exitCode = main();
