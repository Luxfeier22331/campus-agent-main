import type { vi } from "vitest";

function createActor() {
	return {
		cohort: "2024",
		departments: [],
		major: "历史学",
		principalId: "principal_01HQ",
		principalType: "student" as const,
		program: "历史学强基计划",
		roles: ["student"],
		userId: "user_01HQ",
	};
}

function createAuthorization() {
	return {
		applicabilityScope: "undergraduate",
		approvalState: "not_required",
		entitlementGroups: ["students"],
		entitlementSnapshotId: "entitlements-2026-03-29",
		ownershipScopes: ["conversation:user_01HQ"],
		principalId: "principal_01HQ",
		projectionSource: "campus_identity" as const,
		retrievalFilter: {
			entitlementGroups: ["students"],
			policyProjectionVersion: "phase1-authorization-projection-v1",
			visibilityLevel: "public",
			visibilityScope: "main",
		},
		visibilityScope: "main",
	};
}

function createContext(turnCount = 0) {
	return {
		actor: createActor(),
		authorization: createAuthorization(),
		profileMemory: {
			items: [],
		},
		session: {
			confirmedSlots: [],
			turnCount,
		},
	};
}

function readMockRequestBody(fetchImplementation: ReturnType<typeof vi.fn>, index: number): string {
	const body = fetchImplementation.mock.calls[index]?.[1]?.body;
	if (typeof body !== "string") {
		throw new Error(`Missing request body for call ${index}`);
	}
	return body;
}

export interface SupervisorAdapterSuiteContext {
	createActor: typeof createActor;
	createAuthorization: typeof createAuthorization;
	createContext: typeof createContext;
	readMockRequestBody: typeof readMockRequestBody;
	createSupervisorExecutionClient: typeof import("../src/modules/integration/supervisor").createSupervisorExecutionClient;
	probeSupervisorApiReady: typeof import("../src/modules/integration/supervisor").probeSupervisorApiReady;
	SupervisorTransportError: typeof import("../src/modules/integration/supervisor").SupervisorTransportError;
}

export { createActor, createAuthorization, createContext, readMockRequestBody };
