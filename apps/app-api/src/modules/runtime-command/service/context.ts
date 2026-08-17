import { defaultComputeFingerprint, defaultGenerateId, deriveSafetyIdentifier } from "./normalize";
import type { ChatCommandServiceDependencies } from "./types";

export interface ChatCommandServiceContext {
	computeFingerprint: NonNullable<ChatCommandServiceDependencies["computeFingerprint"]>;
	dependencies: ChatCommandServiceDependencies;
	deriveSafetyIdentifierForPrincipal: NonNullable<
		ChatCommandServiceDependencies["deriveSafetyIdentifier"]
	>;
	generateId: NonNullable<ChatCommandServiceDependencies["generateId"]>;
	now: NonNullable<ChatCommandServiceDependencies["now"]>;
	telemetry: ChatCommandServiceDependencies["telemetry"];
}

export function createChatCommandServiceContext(
	dependencies: ChatCommandServiceDependencies,
): ChatCommandServiceContext {
	return {
		computeFingerprint: dependencies.computeFingerprint ?? defaultComputeFingerprint,
		dependencies,
		deriveSafetyIdentifierForPrincipal:
			dependencies.deriveSafetyIdentifier ??
			((principal) =>
				deriveSafetyIdentifier(principal, dependencies.safetyIdentifierHmacSecret ?? "")),
		generateId: dependencies.generateId ?? defaultGenerateId,
		now: dependencies.now ?? (() => new Date()),
		telemetry: dependencies.telemetry,
	};
}
