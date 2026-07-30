import { fileURLToPath } from "node:url";

export const INGESTION_TASK_REGISTRY_ROOT = fileURLToPath(
	new URL("../../../configs/ingestion", import.meta.url),
);
export const INGESTION_KERNEL_TOKENIZER_JSON_PATH =
	"/opt/campus-agent/models/qwen3-embedding-4b/tokenizer.json";
