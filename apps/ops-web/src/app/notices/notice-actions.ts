import type { NoticeCategory } from "campus-contracts/notices";
import type { NoticeSummary } from "../../shared/ops-contract";

export type NoticePrimaryAction = "classify" | "publish";

export interface NoticeActionState {
	canSave: boolean;
	primaryAction: NoticePrimaryAction | null;
	showReclassify: boolean;
	saveDescription: string;
}

export function getNoticeActionState(input: {
	draftCategory: NoticeCategory | "";
	notice: Pick<NoticeSummary, "category" | "state">;
}): NoticeActionState {
	const canSave = Boolean(input.draftCategory) && input.draftCategory !== input.notice.category;
	const primaryAction =
		input.notice.state === "needs_classification"
			? "classify"
			: input.notice.state === "needs_publication"
				? "publish"
				: null;
	return {
		canSave,
		primaryAction,
		showReclassify:
			input.notice.state === "needs_publication" || input.notice.state === "published",
		saveDescription:
			input.notice.state === "published"
				? "保存后立即在学生端生效。"
				: input.notice.category === null
					? "保存分类后，通知进入待发布状态。"
					: "保存后通知保持待发布状态。",
	};
}
