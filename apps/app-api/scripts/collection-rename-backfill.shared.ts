import type { ClientConfig } from "pg";

import type { Env } from "../src/config";
import type { RequestExecutionStatus } from "../src/modules/runtime-command";

export const COLLECTION_RENAME_MAP = {
	institutional_regulations: "institutional_rules",
	student_handbook: "student_rules",
} as const;

export const LEGACY_COLLECTION_NAMES = Object.keys(COLLECTION_RENAME_MAP);
export const LEGACY_SCOPE_SUMMARIES = LEGACY_COLLECTION_NAMES.map(
	(collection) => `regulations/${collection}`,
);

export const COLLECTION_CASE_SQL = `
	case
		when collection = 'student_handbook' then 'student_rules'
		when collection = 'institutional_regulations' then 'institutional_rules'
		else collection
	end
`;

export const RESOLVED_SCOPE_JSON_CASE_SQL = `
	case
		when resolved_scope_json->>'collection' = 'student_handbook'
			then jsonb_set(resolved_scope_json, '{collection}', to_jsonb('student_rules'::text), true)
		when resolved_scope_json->>'collection' = 'institutional_regulations'
			then jsonb_set(
				resolved_scope_json,
				'{collection}',
				to_jsonb('institutional_rules'::text),
				true
			)
		else resolved_scope_json
	end
`;

export const RESOLVED_SCOPE_SUMMARY_CASE_SQL = `
	case
		when resolved_scope_summary = 'regulations/student_handbook' then 'regulations/student_rules'
		when resolved_scope_summary = 'regulations/institutional_regulations'
			then 'regulations/institutional_rules'
		else resolved_scope_summary
	end
`;

export type LegacyCollectionName = keyof typeof COLLECTION_RENAME_MAP;
export type ReplayEventType =
	| "request.accepted"
	| "request.completed"
	| "request.needs_clarification"
	| "request.no_answer"
	| "request.error"
	| "request.approval_required"
	| "request.rejected"
	| "request.cancelled";

export interface CollectionRenameBackfillPlanInput {
	gradeCollection: string | null;
	requestId: string;
	requestStatus: RequestExecutionStatus;
	resolvedScopeJson: Record<string, unknown> | null;
	resolvedScopeSummary: string | null;
	runtimeCollection: string | null;
}

export interface CollectionRenameBackfillPlan {
	hasChanges: boolean;
	nextGradeCollection: string | null;
	nextResolvedScopeJson: Record<string, unknown> | null;
	nextResolvedScopeSummary: string | null;
	nextRuntimeCollection: string | null;
	replayEventType: ReplayEventType;
	requestId: string;
	requestStatus: RequestExecutionStatus;
}

export interface CollectionRenameBackfillAuditReport {
	affectedRequestIds: string[];
	command: "audit";
	tables: {
		metricRollupRows: number;
		qualityGradeRows: number;
		requestExecutionRows: number;
		requestObservabilityRows: number;
		requestProjectionRows: number;
	};
}

export interface CollectionRenameBackfillApplyReport {
	affectedRequestIds: string[];
	command: "apply";
	tables: {
		metricRollupRows: number;
		qualityGradeRows: number;
		requestExecutionRows: number;
		requestObservabilityRows: number;
		requestProjectionRows: number;
	};
}

export interface CollectionRenameReplayReport {
	command: "replay-projections";
	failed: number;
	processed: number;
	requestIds: string[];
	reusedOutboxEvents: number;
	syntheticOutboxEvents: number;
}

export type CollectionRenameBackfillReport =
	| CollectionRenameBackfillApplyReport
	| CollectionRenameBackfillAuditReport
	| CollectionRenameReplayReport;

export type CollectionRenameBackfillArgs =
	| {
			command: "audit";
			writeReportPath?: string;
	  }
	| {
			batchSize?: number;
			command: "apply";
			writeReportPath?: string;
	  }
	| {
			command: "replay-projections";
			reportPath?: string;
			requestIds: string[];
			writeReportPath?: string;
	  };

export interface LocalCollectionRenameBackfillRuntime {
	env: Env;
	operatorClientConfig: ClientConfig;
}
