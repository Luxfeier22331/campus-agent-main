import { type JsonObject, loadJsonObject, mappingList, stringField, stringList } from "./shared";

const SCHEMA_VERSION = "public_web_search_agent_eval.v1";
const ALLOWED_EVAL_KINDS = new Set([
	"answer_grounding",
	"routing_tool_selection",
	"source_quality",
]);
const ALLOWED_EXPECTED_TOOLS = new Set(["direct_answer", "knowledge_query", "public_web_search"]);

export interface PublicWebSearchEvalCase extends JsonObject {
	case_id: string;
	expected_tool: string;
	min_sources: number;
	query: string;
	required_allowed_url_patterns: string[];
	required_answer_facts: string[];
}

export interface PublicWebSearchEvalValidationResult extends JsonObject {
	case_count: number;
	cases: PublicWebSearchEvalCase[];
	eval_kinds: string[];
	expected_tool_counts: Record<string, number>;
	schema_version: string;
}

export function loadPublicWebSearchEvalAsset(path: string): PublicWebSearchEvalValidationResult {
	return validatePublicWebSearchEvalAsset(loadJsonObject(path));
}

export function validatePublicWebSearchEvalAsset(
	payload: JsonObject,
): PublicWebSearchEvalValidationResult {
	const schemaVersion = stringField(payload.schema_version, "schema_version");
	if (schemaVersion !== SCHEMA_VERSION) {
		throw new Error(`schema_version must be ${SCHEMA_VERSION}`);
	}

	const evalKinds = stringList(payload.eval_kinds);
	if (evalKinds.length === 0) {
		throw new Error("eval_kinds is required");
	}
	for (const kind of evalKinds) {
		if (!ALLOWED_EVAL_KINDS.has(kind)) {
			throw new Error(`eval_kinds contains unsupported kind: ${kind}`);
		}
	}

	const cases = mappingList(payload.cases, "cases").map(parseCase);
	if (cases.length === 0) {
		throw new Error("cases must not be empty");
	}

	const seenCaseIds = new Set<string>();
	const expectedToolCounts: Record<string, number> = {};
	for (const [index, item] of cases.entries()) {
		if (seenCaseIds.has(item.case_id)) {
			throw new Error(`cases[${index}].case_id is duplicated: ${item.case_id}`);
		}
		seenCaseIds.add(item.case_id);
		validateCase(item, index);
		expectedToolCounts[item.expected_tool] = (expectedToolCounts[item.expected_tool] ?? 0) + 1;
	}

	return {
		case_count: cases.length,
		cases,
		eval_kinds: evalKinds,
		expected_tool_counts: expectedToolCounts,
		schema_version: schemaVersion,
	};
}

function parseCase(value: JsonObject): PublicWebSearchEvalCase {
	const minSources = Number(value.min_sources);
	if (!Number.isInteger(minSources) || minSources < 0 || minSources > 5) {
		throw new Error("min_sources must be an integer between 0 and 5");
	}
	return {
		case_id: stringField(value.case_id, "case_id"),
		expected_tool: stringField(value.expected_tool, "expected_tool"),
		min_sources: minSources,
		query: stringField(value.query, "query"),
		required_allowed_url_patterns: stringList(value.required_allowed_url_patterns),
		required_answer_facts: stringList(value.required_answer_facts),
	};
}

function validateCase(item: PublicWebSearchEvalCase, index: number): void {
	if (!ALLOWED_EXPECTED_TOOLS.has(item.expected_tool)) {
		throw new Error(`cases[${index}].expected_tool is not allowed: ${item.expected_tool}`);
	}
	if (item.expected_tool === "public_web_search" && item.min_sources < 1) {
		throw new Error(`cases[${index}].min_sources must be positive for public_web_search`);
	}
	if (item.expected_tool !== "public_web_search" && item.min_sources !== 0) {
		throw new Error(`cases[${index}].min_sources must be 0 when no public web source is expected`);
	}
	for (const pattern of item.required_allowed_url_patterns) {
		assertAllowedPublicMucPattern(pattern, index);
	}
}

function assertAllowedPublicMucPattern(pattern: string, index: number): void {
	let parsed: URL;
	try {
		parsed = new URL(pattern.replaceAll("*", "x"));
	} catch {
		throw new Error(`cases[${index}].expected url pattern must be a URL-like HTTPS MUC pattern`);
	}
	const hostname = parsed.hostname.toLowerCase();
	const isMucHost = hostname === "muc.edu.cn" || hostname.endsWith(".muc.edu.cn");
	if (
		parsed.protocol !== "https:" ||
		parsed.port !== "" ||
		hostname === "my.muc.edu.cn" ||
		!isMucHost
	) {
		throw new Error(`cases[${index}].expected url pattern must stay under public HTTPS muc.edu.cn`);
	}
}
