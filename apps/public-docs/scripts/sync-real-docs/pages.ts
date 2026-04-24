export function buildHomePage(input: { includePublicRegulations?: boolean } = {}): string {
	let actions = `    - theme: brand
      text: 浏览学生手册
      link: /student-handbook/
    - theme: alt
      text: 浏览培养方案
      link: /curriculum-plan/`;
	let features = `  - title: 真实公开文档
    details: 当前接入内容来自本地 MinIO 的真实公开文档产物，不再使用手写测试样文。
    icon: 📚
  - title: 学生手册
    details: 展示制度类正文阅读、分章定位与长文搜索效果。
    icon: 📘
    link: /student-handbook/
  - title: 培养方案
    details: 展示专业培养方案在长段落、目录层级和表格段落下的阅读效果。
    icon: 🧭
    link: /curriculum-plan/`;
	if (input.includePublicRegulations) {
		actions += `
    - theme: alt
      text: 浏览校内规章
      link: /campus-regulations/`;
		features += `
  - title: 校内规章
    details: 仅展示已显式标记为公开可发布的 notice-derived 或内部采集规章。
    icon: 📑
    link: /campus-regulations/`;
	}
	return `---
pageType: home

hero:
  name: Campus Agent 文档站
  text: 校园公开文档入口
  tagline: 当前页面展示公开文档阅读面使用的正式 docs shell，用于验证层级导航、阅读体验与信息架构。
  actions:
${actions}
features:
${features}
---
`;
}
