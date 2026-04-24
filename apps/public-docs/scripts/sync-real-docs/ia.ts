import type { CurriculumDoc, HandbookDoc, HandbookFlowGraphDoc } from "./shared";

export interface DocsIaGroup<TDoc> {
	id: string;
	label: string;
	docs: TDoc[];
}

export type HandbookDocGroupId =
	| "workflows"
	| "academic"
	| "discipline"
	| "scholarship"
	| "dormitory-medical"
	| "practice-service"
	| "general-rules";

export type CurriculumDocGroupId =
	| "undergraduate"
	| "special-programs"
	| "strong-base"
	| "second-degree"
	| "general-education"
	| "other";

export const HANDBOOK_GROUPS: readonly { id: HandbookDocGroupId; label: string }[] = [
	{ id: "workflows", label: "办事流程" },
	{ id: "academic", label: "学籍与教学" },
	{ id: "discipline", label: "行为规范与纪律" },
	{ id: "scholarship", label: "奖助与资助" },
	{ id: "dormitory-medical", label: "住宿与公费医疗" },
	{ id: "practice-service", label: "实践、服务与发展" },
	{ id: "general-rules", label: "通用法规" },
];

export const CURRICULUM_GROUPS: readonly { id: CurriculumDocGroupId; label: string }[] = [
	{ id: "undergraduate", label: "本科专业与专业类" },
	{ id: "special-programs", label: "实验班与专项培养" },
	{ id: "strong-base", label: "强基计划" },
	{ id: "second-degree", label: "第二学士学位" },
	{ id: "general-education", label: "通识课程" },
	{ id: "other", label: "其他培养方案" },
];

export function groupHandbookDocs(input: {
	flowGraphDocs: HandbookFlowGraphDoc[];
	handbookDocs: HandbookDoc[];
}): DocsIaGroup<HandbookDoc | HandbookFlowGraphDoc>[] {
	const docsByGroup = new Map<HandbookDocGroupId, Array<HandbookDoc | HandbookFlowGraphDoc>>(
		HANDBOOK_GROUPS.map((group) => [group.id, []]),
	);
	for (const doc of input.flowGraphDocs) {
		docsByGroup.get("workflows")?.push(doc);
	}
	for (const doc of input.handbookDocs) {
		docsByGroup.get(classifyHandbookDocGroup(doc.title))?.push(doc);
	}
	return HANDBOOK_GROUPS.map((group) => ({
		...group,
		docs: docsByGroup.get(group.id) ?? [],
	}));
}

export function classifyHandbookDocGroup(title: string): HandbookDocGroupId {
	if (includesAny(title, ["普通高等学校", "高等学校学生行为准则", "校园秩序"])) {
		return "general-rules";
	}
	if (
		includesAny(title, [
			"学分制",
			"学籍",
			"学士学位",
			"推免",
			"专业调整",
			"境外留学",
			"创新教育",
			"考勤",
			"学生证",
			"本科预科生",
			"课堂",
			"考试",
		])
	) {
		return "academic";
	}
	if (
		includesAny(title, ["违纪", "申诉", "听证", "纪律处分", "解除学生纪律处分", "学生管理规定"])
	) {
		return "discipline";
	}
	if (
		includesAny(title, [
			"奖学金",
			"助学金",
			"资助",
			"助学贷款",
			"困难学生",
			"困难补助",
			"勤工助学",
			"学费",
			"代偿",
			"社会奖助学金",
		])
	) {
		return "scholarship";
	}
	if (includesAny(title, ["宿舍", "公寓", "医疗", "照明", "电器"])) {
		return "dormitory-medical";
	}
	if (
		includesAny(title, [
			"志愿服务",
			"社会实践",
			"综合素质",
			"先进",
			"十佳",
			"毕业生",
			"民族团结",
			"周查月报",
		])
	) {
		return "practice-service";
	}
	return "discipline";
}

export function groupCurriculumDocsByIa(
	curriculumDocs: CurriculumDoc[],
): DocsIaGroup<CurriculumDoc>[] {
	const docsByGroup = new Map<CurriculumDocGroupId, CurriculumDoc[]>(
		CURRICULUM_GROUPS.map((group) => [group.id, []]),
	);
	for (const doc of curriculumDocs) {
		docsByGroup.get(classifyCurriculumDocGroupId(doc.title))?.push(doc);
	}
	return CURRICULUM_GROUPS.map((group) => ({
		...group,
		docs: docsByGroup.get(group.id) ?? [],
	}));
}

export function classifyCurriculumDocGroupId(title: string): CurriculumDocGroupId {
	if (title.includes("通识课程")) {
		return "general-education";
	}
	if (title.includes("强基计划")) {
		return "strong-base";
	}
	if (title.includes("第二学士学位") || title.includes("第二学位")) {
		return "second-degree";
	}
	if (includesAny(title, ["实验班", "拔尖", "孝通", "专项", "创新人才", "少数民族预科"])) {
		return "special-programs";
	}
	if (title.includes("本科人才培养方案")) {
		return "undergraduate";
	}
	return "other";
}

function includesAny(value: string, needles: readonly string[]): boolean {
	return needles.some((needle) => value.includes(needle));
}
