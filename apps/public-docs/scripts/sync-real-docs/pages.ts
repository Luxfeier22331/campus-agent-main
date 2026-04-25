export function buildHomePage(input: { includePublicRegulations?: boolean } = {}): string {
	let cards = `<a class="docs-home-card" href="/student-handbook/">
	<strong>学生手册</strong>
	<span>查询学籍、奖助、纪律、住宿、公费医疗等学生管理制度。</span>
</a>
<a class="docs-home-card" href="/curriculum-plan/">
	<strong>培养方案</strong>
	<span>按专业、实验班、强基计划和通识课程查看培养目标、毕业要求和课程安排。</span>
</a>`;
	if (input.includePublicRegulations) {
		cards += `
<a class="docs-home-card" href="/campus-regulations/">
	<strong>校内规章</strong>
	<span>查看已确认公开发布的校内管理规定和办事依据。</span>
</a>`;
	}
	return `---
title: "Campus Agent 文档站"
footer: false
---

# Campus Agent 文档站

<p class="docs-home-kicker">校园公开文档入口</p>

学生手册、培养方案与公开规章的统一阅读入口。

<div class="docs-home-grid">
${cards}
</div>

## 真实公开文档

汇总学生手册、培养方案与公开规章，保持与学校公开文件一致的阅读入口。
`;
}
