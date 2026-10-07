import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import internalPortalFileReleaseSourceSchema from "../schemas/internal-portal-file-release-source.v1.schema.json" with {
	type: "json",
};
import internalPortalMetaSchema from "../schemas/internal-portal-meta.v1.schema.json" with {
	type: "json",
};
import internalPortalNoticeSourceSchema from "../schemas/internal-portal-notice-source.v2.schema.json" with {
	type: "json",
};
import internalPortalNoticeSyncStateV2Schema from "../schemas/internal-portal-notice-sync-state.v2.schema.json" with {
	type: "json",
};
import internalPortalNoticeSyncStateV3Schema from "../schemas/internal-portal-notice-sync-state.v3.schema.json" with {
	type: "json",
};
import internalPortalNoticeSyncStateV4Schema from "../schemas/internal-portal-notice-sync-state.v4.schema.json" with {
	type: "json",
};

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export interface InternalPortalNoticeSourceAttachment {
	notice_annex_id: string | null;
	notice_annex_name: string | null;
	notice_annex_path: string | null;
	suffix: string | null;
	type: string | null;
}

export interface InternalPortalNoticeResource {
	kind: "images" | "attachments";
	ordinal: number;
	object_key: string | null;
	content_type: string | null;
	byte_size: number | null;
	sha256: string | null;
}

interface InternalPortalNoticeSourceBase {
	schema_version: "internal_portal_notice_source.v2";
	notice_id: number;
	notice_type: number;
	organization_id: string | null;
	notice_title: string;
	notice_release_time: string | null;
	notice_content_html: string | null;
	attachments: InternalPortalNoticeSourceAttachment[];
	resources?: InternalPortalNoticeResource[];
}

export type InternalPortalNoticeSource = InternalPortalNoticeSourceBase &
	({ is_external: false; external_url: null } | { is_external: true; external_url: string });

interface InternalPortalNoticeSyncStateBase {
	schema_version: "internal_portal_notice_sync_state.v3" | "internal_portal_notice_sync_state.v4";
	updated_at: string;
}

export type InternalPortalNoticeSyncState = InternalPortalNoticeSyncStateBase &
	(
		| { covered_from: null; covered_until: null }
		| { covered_from: string; covered_until: string }
	) & {
		recent_reviewed_at?: string | null;
		full_reviewed_at?: string | null;
		unavailable_notice_ids?: number[];
	};

export interface V3InternalPortalNoticeSyncState {
	schema_version: "internal_portal_notice_sync_state.v3";
	updated_at: string;
	covered_from: string | null;
	covered_until: string | null;
	recent_reviewed_at?: string | null;
	full_reviewed_at?: string | null;
}

export interface LegacyInternalPortalNoticeSyncState {
	schema_version: "internal_portal_notice_sync_state.v2";
	head_notice_id: number | null;
	history_covered_from: string | null;
	updated_at: string;
}

export interface InternalPortalMeta {
	schema_version: "internal_portal_meta.v1";
	notice_types: Record<string, string>;
	organizations: Record<string, string>;
	updated_at: string;
}

export interface InternalPortalFileReleaseSource {
	schema_version: "internal_portal_file_release_source.v1";
	site_id: string;
	file_release_id: number;
	title: string;
	file_code: string | null;
	department: string | null;
	explanation_department: string | null;
	published_at: string | null;
	file: {
		object_key: string;
		original_filename: string;
		content_type: string;
		byte_size: number;
		digest: string;
	};
}

const ajv = new Ajv2020({
	allErrors: true,
	messages: true,
	strict: true,
	strictRequired: false,
	verbose: true,
});
addFormats(ajv);

const internalPortalFileReleaseSourceValidator = ajv.compile(
	internalPortalFileReleaseSourceSchema,
) as ValidateFunction<InternalPortalFileReleaseSource>;
const internalPortalNoticeSourceValidator = ajv.compile(
	internalPortalNoticeSourceSchema,
) as ValidateFunction<InternalPortalNoticeSource>;
const internalPortalNoticeSyncStateV2Validator = ajv.compile(
	internalPortalNoticeSyncStateV2Schema,
) as ValidateFunction<LegacyInternalPortalNoticeSyncState>;
const internalPortalNoticeSyncStateV3Validator = ajv.compile(
	internalPortalNoticeSyncStateV3Schema,
) as ValidateFunction<V3InternalPortalNoticeSyncState>;
const internalPortalNoticeSyncStateV4Validator = ajv.compile(
	internalPortalNoticeSyncStateV4Schema,
) as ValidateFunction<InternalPortalNoticeSyncState>;
const internalPortalMetaValidator = ajv.compile(
	internalPortalMetaSchema,
) as ValidateFunction<InternalPortalMeta>;

export function validateInternalPortalNoticeSource(value: unknown): ValidationResult {
	return validateWith(internalPortalNoticeSourceValidator, value);
}

export function validateInternalPortalNoticeSyncState(value: unknown): ValidationResult {
	const validation = validateWith(internalPortalNoticeSyncStateV4Validator, value);
	const effective = validation.ok
		? validation
		: validateWith(internalPortalNoticeSyncStateV3Validator, value);
	if (!effective.ok) {
		return effective;
	}
	const state = value as InternalPortalNoticeSyncState;
	if (
		state.covered_from !== null &&
		state.covered_until !== null &&
		state.covered_from > state.covered_until
	) {
		return { ok: false, errors: ["covered_until must be on or after covered_from"] };
	}
	return effective;
}

export function validateLegacyInternalPortalNoticeSyncState(value: unknown): ValidationResult {
	return validateWith(internalPortalNoticeSyncStateV2Validator, value);
}

export function validateInternalPortalMeta(value: unknown): ValidationResult {
	return validateWith(internalPortalMetaValidator, value);
}

export function validateInternalPortalFileReleaseSource(value: unknown): ValidationResult {
	return validateWith(internalPortalFileReleaseSourceValidator, value);
}

function validateWith(validator: ValidateFunction, value: unknown): ValidationResult {
	if (validator(value)) {
		return { ok: true };
	}
	return {
		ok: false,
		errors: formatAjvErrors(validator.errors ?? []),
	};
}

function formatAjvErrors(errors: ErrorObject[]): string[] {
	return errors.map(formatAjvError);
}

function formatAjvError(error: ErrorObject): string {
	const path = error.instancePath ? jsonPointerToPath(error.instancePath) : "payload";
	if (error.keyword === "required") {
		const missingProperty = String(error.params.missingProperty ?? "");
		return `${joinPath(path, missingProperty)} is required`;
	}
	if (error.keyword === "additionalProperties") {
		const additionalProperty = String(error.params.additionalProperty ?? "");
		return `${joinPath(path, additionalProperty)} is not allowed`;
	}
	if (error.keyword === "enum") {
		return `${path} is not supported: ${String(error.data)}`;
	}
	if (error.keyword === "const") {
		return `${path} must be ${String(error.params.allowedValue)}`;
	}
	if (error.keyword === "format") {
		return `${path} must match ${String(error.params.format)} format`;
	}
	if (error.keyword === "minLength") {
		return `${path} must be non-empty`;
	}
	if (error.keyword === "minItems") {
		return `${path} must contain at least ${String(error.params.limit)} item`;
	}
	return `${path} ${error.message ?? "is invalid"}`;
}

function jsonPointerToPath(pointer: string): string {
	const segments = pointer
		.split("/")
		.slice(1)
		.map((segment) => segment.replace(/~1/gu, "/").replace(/~0/gu, "~"));
	if (segments.length === 0) {
		return "payload";
	}
	return segments.reduce((path, segment) => {
		if (/^\d+$/u.test(segment)) {
			return `${path}[${segment}]`;
		}
		return path === "payload" ? segment : `${path}.${segment}`;
	}, "payload");
}

function joinPath(path: string, field: string): string {
	return path === "payload" ? field : `${path}.${field}`;
}
