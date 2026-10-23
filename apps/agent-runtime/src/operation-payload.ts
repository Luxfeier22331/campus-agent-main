import { AgentRuntimeError } from "./runtime-errors.ts";

export const MAX_OPERATION_PAYLOAD_BYTES = 1 << 20;

export function encodeOperationPayload(value: unknown): string {
	const encoded = JSON.stringify(value);
	if (Buffer.byteLength(encoded, "utf8") > MAX_OPERATION_PAYLOAD_BYTES) {
		throw new AgentRuntimeError(
			"workflow_operation_payload_too_large",
			"Operation payload exceeds the byte budget.",
		);
	}
	return encoded;
}
