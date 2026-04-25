export function buildHomePage(input: { includePublicRegulations?: boolean } = {}): string {
	let cards = `<a class="docs-home-card" href="/student-handbook/">
	<strong>学生手册</strong>
	<span>查询学籍、奖助、纪律、住宿、公费医疗等学生管理制度。</span>
	<small>按制度类别阅读</small>
</a>
<a class="docs-home-card" href="/curriculum-plan/">
	<strong>培养方案</strong>
	<span>按专业、实验班、强基计划和通识课程查看培养目标、毕业要求和课程安排。</span>
	<small>按培养类型阅读</small>
</a>`;
	if (input.includePublicRegulations) {
		cards += `
<a class="docs-home-card" href="/campus-regulations/">
	<strong>校内规章</strong>
	<span>查看已确认公开发布的校内管理规定和办事依据。</span>
	<small>按公开规章阅读</small>
</a>`;
	}
	return `---
title: "文档首页"
footer: false
---

# 校园公开文档

<p class="docs-home-kicker">校园公开文档入口</p>

<p class="docs-home-lede">集中阅读学生手册、培养方案与公开规章。内容保持来源、页码和版本信息可见，适合按文件核对制度依据。</p>

<div class="docs-home-grid">
${cards}
</div>

## 真实公开文档

<p class="docs-home-note">如果你已经知道文件名称，可以直接使用顶部搜索；如果不确定归属，先从学生手册或培养方案集合进入。</p>
`;
}
