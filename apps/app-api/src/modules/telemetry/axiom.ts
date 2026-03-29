const DEFAULT_AXIOM_ENDPOINT = "https://api.axiom.co";

const FORBIDDEN_FIELD_NAMES = new Set([
  "answer",
  "auth_header",
  "authorization",
  "cookie",
  "jwt",
  "memory",
  "memory_text",
  "operator_email",
  "prompt",
  "raw_answer",
  "raw_jwt",
  "raw_prompt",
  "transcript",
]);

type AxiomScalar = boolean | number | string | null;

function buildAxiomIngestUrl(endpoint: string, dataset: string): string {
  const hostname = new URL(endpoint).hostname;
  if (/\.edge\.axiom\.co$/u.test(hostname)) {
    return `${endpoint}/v1/ingest/${dataset}`;
  }

  return `${endpoint}/v1/datasets/${dataset}/ingest`;
}

export interface AxiomRuntimeEventSink {
  emit(payload: Record<string, unknown>): Promise<void>;
}

export interface AxiomRuntimeEventEnv {
  AXIOM_DATASET?: string;
  AXIOM_ENDPOINT?: string;
  AXIOM_TOKEN?: string;
}

export function sanitizeAxiomEventPayload(
  payload: Record<string, unknown>,
): Record<string, AxiomScalar> {
  const sanitized: Record<string, AxiomScalar> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (FORBIDDEN_FIELD_NAMES.has(key) || value === undefined) {
      continue;
    }

    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "string"
    ) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export function createAxiomRuntimeEventSink(
  env: AxiomRuntimeEventEnv,
  input: {
    fetchImplementation?: typeof fetch;
    logger?: Pick<Console, "warn">;
  } = {},
): AxiomRuntimeEventSink {
  const dataset = env.AXIOM_DATASET?.trim();
  const token = env.AXIOM_TOKEN?.trim();
  const endpoint = (env.AXIOM_ENDPOINT?.trim() || DEFAULT_AXIOM_ENDPOINT).replace(/\/$/, "");
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const logger = input.logger ?? console;

  return {
    async emit(payload) {
      if (!dataset || !token) {
        return;
      }

      try {
        const response = await fetchImplementation(buildAxiomIngestUrl(endpoint, dataset), {
          body: JSON.stringify([sanitizeAxiomEventPayload(payload)]),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        });

        if (!response.ok) {
          logger.warn(
            `Axiom ingest failed with status ${response.status} for dataset ${dataset}.`,
          );
        }
      } catch (error) {
        logger.warn(
          error instanceof Error
            ? `Axiom ingest failed: ${error.message}`
            : "Axiom ingest failed with an unknown error.",
        );
      }
    },
  };
}
