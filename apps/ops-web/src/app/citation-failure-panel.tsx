import {
	CITATION_REASONS,
	CITATION_STAGE_LABELS,
	type CitationReason,
} from "campus-contracts/citation-diagnostic";
import type { OpsRequestDetailResponse } from "../shared/ops-contract";
import { KeyValue } from "./ops-display";
import { normalizeRequestListReturnPath } from "./ops-view-helpers";

type Failure = OpsRequestDetailResponse["execution"]["failure"];
export function failureReasonLabel(reason: string | null | undefined): string {
	return reason ? (CITATION_REASONS[reason as CitationReason] ?? reason) : "未记录";
}
export function similarFailurePath(failure: Failure, from?: string): string {
	let previous = new URL(normalizeRequestListReturnPath(from), "https://ops.local");
	// Detail return links carry a parent path in `from`, while list pages use it for time.
	while (/^\/(requests|conversations)\/[^/]+$/.test(previous.pathname)) {
		const parent = previous.searchParams.get("from");
		if (!parent) {
			break;
		}
		previous = new URL(normalizeRequestListReturnPath(parent), "https://ops.local");
	}
	const query = new URLSearchParams();
	for (const field of ["window", "from", "to"]) {
		const value = previous.searchParams.get(field);
		if (value) {
			query.set(field, value);
		}
	}
	if (failure.code) {
		query.set("failureCode", failure.code);
	}
	if (failure.reason) {
		query.set("failureReason", failure.reason);
	}
	if (failure.citation) {
		query.set("citationStage", failure.citation.validation_stage);
	}
	query.set("failureScope", "any");
	return `/requests?${query.toString()}`;
}
export function CitationFailurePanel({
	failure,
	from,
}: {
	failure: Failure;
	from?: string | undefined;
}) {
	const diagnostic = failure.citation;
	const isCitationFailure = (failure.sourceCode ?? failure.code) === "citation_validation_failed";
	return (
		<div className="grid gap-2 text-sm">
			{failure.sourceCode ? <KeyValue label="原始失败代码" value={failure.sourceCode} /> : null}
			{failure.reason || isCitationFailure ? (
				<div>
					<KeyValue label="具体原因" value={failureReasonLabel(failure.reason)} />
					{failure.reason ? (
						<code className="break-all text-xs text-muted-foreground">{failure.reason}</code>
					) : null}
				</div>
			) : null}
			{isCitationFailure ? (
				diagnostic ? (
					<dl className="grid gap-2 sm:grid-cols-2">
						<KeyValue label="校验阶段" value={CITATION_STAGE_LABELS[diagnostic.validation_stage]} />
						{diagnostic.field ? <KeyValue label="字段" value={diagnostic.field} /> : null}
						{diagnostic.item_index === undefined ? null : (
							<KeyValue label="输入项位置（从 0 开始）" value={String(diagnostic.item_index)} />
						)}
						{diagnostic.citation_index === undefined ? null : (
							<KeyValue label="引用编号" value={String(diagnostic.citation_index)} />
						)}
						{diagnostic.actual_type ? (
							<KeyValue label="实际类型" value={diagnostic.actual_type} />
						) : null}
						{diagnostic.start === undefined ? null : (
							<KeyValue label="区间起点" value={String(diagnostic.start)} />
						)}
						{diagnostic.end === undefined ? null : (
							<KeyValue label="区间终点" value={String(diagnostic.end)} />
						)}
						{diagnostic.text_length === undefined ? null : (
							<KeyValue label="正文长度" value={String(diagnostic.text_length)} />
						)}
						{diagnostic.offset_unit ? (
							<KeyValue
								label="计数单位"
								value={
									{
										utf16_code_unit: "UTF-16 code unit",
										unicode_code_point: "Unicode code point",
										utf8_byte: "UTF-8 byte",
									}[diagnostic.offset_unit]
								}
							/>
						) : null}
					</dl>
				) : (
					<p className="text-muted-foreground">
						{failure.citationState === "invalid" ? "诊断无法解析" : "引用定位信息未记录"}
					</p>
				)
			) : null}
			{failure.code ? (
				<a
					className="font-medium text-info hover:underline"
					href={similarFailurePath(failure, from)}
				>
					查看同类请求
				</a>
			) : null}
		</div>
	);
}
