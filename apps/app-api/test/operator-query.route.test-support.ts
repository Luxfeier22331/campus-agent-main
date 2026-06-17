import { vi } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { OperatorQueryService } from "../src/modules/operator-query";

export const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

export function createOperatorPrincipal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: ["ops"],
			principalId: "ops@example.com",
			principalType: "operator",
			roles: ["operator"],
			userId: "ops@example.com",
		},
		permissions: {
			chat: false,
			operator: true,
		},
		principal: {
			displayName: "Ops Team",
			email: "ops@example.com",
			principalId: "ops@example.com",
			type: "operator",
		},
		session: null,
	};
}

export function createCampusPrincipal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: [],
			principalId: "user_01HQ",
			principalType: "campus_member",
			roles: ["campus_member"],
			userId: "user_01HQ",
		},
		permissions: {
			chat: true,
			operator: false,
		},
		principal: {
			displayName: "Jane Doe",
			email: "jane@example.edu",
			principalId: "user_01HQ",
			type: "campus_member",
		},
		session: {
			expiresAt: "2026-03-29T07:00:00.000Z",
			sessionId: "sess_01HQ",
		},
	};
}

export function createOperatorQueryServiceMock(
	overrides: Partial<OperatorQueryService> = {},
): OperatorQueryService {
	return {
		getById: vi.fn(),
		getAuditById: vi.fn(),
		getEvalCoverage: vi.fn(),
		getObservabilityById: vi.fn(),
		getOverview: vi.fn(),
		getRuntimeHealth: vi.fn(),
		listAutoscalerActuations: vi.fn(),
		listAutoscalerDecisions: vi.fn(),
		listTemporalTaskQueues: vi.fn(),
		getIntentSummary: vi.fn(),
		getIntentTimeseries: vi.fn(),
		getQualitySummary: vi.fn(),
		getQualityTimeseries: vi.fn(),
		getSafetySummary: vi.fn(),
		listSafetyAnomalies: vi.fn(),
		getCostSummary: vi.fn(),
		getCostTimeseries: vi.fn(),
		listQualityBadcases: vi.fn(),
		listQualityEvalCandidates: vi.fn(),
		listAudit: vi.fn(),
		list: vi.fn(),
		...overrides,
	};
}
