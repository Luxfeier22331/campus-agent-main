import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectEnvDoctorStatus } from "./core.ts";
import { surfaceSpecs } from "./specs.ts";

export function runDoctorEnvSelfTest(): number {
	const renderedSpecs = JSON.stringify(surfaceSpecs);
	for (const retired of [
		"EVAL_LLM_API_KEY",
		"EMBEDDING_API_KEY",
		"EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_HEADERS",
		"STAGING_APP_API_SENTRY_DSN",
	]) {
		expect(!renderedSpecs.includes(retired), `retired key ${retired} leaked into doctor specs`);
	}
	for (const surface of Object.keys(surfaceSpecs)) {
		selfTestSurface(surface);
	}
	selfTestEvalProjectionFailures();
	console.log("doctor_env self-test passed.");
	return 0;
}

function selfTestSurface(surface: string): void {
	withFixture((root) => {
		const spec = surfaceSpecs[surface];
		if (!spec) {
			throw new Error(`missing generated spec for ${surface}`);
		}
		const env: Record<string, string> = {};
		for (const checkedKeys of Object.values(spec.required_settings)) {
			const key = checkedKeys[0];
			if (key) {
				env[key] = `${key.toLowerCase()}-value`;
			}
		}
		for (const [path, fileSpec] of Object.entries(spec.files)) {
			writeText(
				join(root, path),
				`${(fileSpec.required_keys ?? []).map((key) => `${key}=${key.toLowerCase()}-value`).join("\n")}\n`,
			);
		}
		if (surface === "execution-control") {
			const path = "configs/runtime/execution-control/runtime-config.staging.json";
			env.EXECUTION_CONTROL_RUNTIME_CONFIG_PATH = path;
			writeText(
				join(root, path),
				'{"schema_version":"campus_execution_control_runtime_config.v1"}\n',
			);
		}
		if (surface === "evals") {
			const path = join(root, "eval-provider-projection.json");
			writeProjection(path);
			env.EVAL_PROVIDER_CONFIG_PROJECTION_PATH = path;
		}
		const ready = collectEnvDoctorStatus({ env, root, surface });
		expect(ready.overall_ready, `${surface} should be ready with all contracted inputs`);
	});

	withFixture((root) => {
		const missing = collectEnvDoctorStatus({ env: {}, root, surface });
		expect(!missing.overall_ready, `${surface} must fail closed without contracted inputs`);
	});
}

function selfTestEvalProjectionFailures(): void {
	withFixture((root) => {
		const path = join(root, "eval-provider-projection.json");
		writeProjection(path);
		chmodSync(path, 0o644);
		const status = collectEnvDoctorStatus({
			env: {
				EVAL_PROVIDER_CONFIG_PROJECTION_PATH: path,
				LANGFUSE_BASE_URL: "https://langfuse.example",
				LANGFUSE_ENVIRONMENT: "test",
				LANGFUSE_PUBLIC_KEY: "public",
				LANGFUSE_SECRET_KEY: "secret",
			},
			root,
			surface: "evals",
		});
		expect(!status.overall_ready, "eval projection with mode 0644 must fail closed");
		expect(
			String(status.provider_projection.error).includes("0600"),
			"eval projection mode error missing",
		);
	});
}

function writeProjection(path: string): void {
	const profile = {
		api_key: "provider-secret",
		base_url: "https://provider.example/v1",
		model: "model",
		provider: "openai",
		timeout_ms: 180000,
		transport: "openai_responses",
	};
	writeText(
		path,
		`${JSON.stringify({
			schema_version: "provider_config_projection.v1",
			profiles: {
				eval_judge_llm: profile,
				eval_ragas_embedding: { ...profile, dimensions: 2560, transport: "openai_embeddings" },
				eval_ragas_llm: profile,
			},
		})}\n`,
	);
	chmodSync(path, 0o600);
}

function withFixture(callback: (root: string) => void): void {
	const root = join(mkdtempSync(join(tmpdir(), "doctor-env-")), "campus-agent");
	try {
		callback(root);
	} finally {
		rmSync(dirname(root), { recursive: true, force: true });
	}
}

function writeText(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, "utf8");
}

function expect(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}
