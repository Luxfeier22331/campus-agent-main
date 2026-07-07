import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(fileURLToPath(import.meta.url)).replace(/[/\\]scripts$/u, "");
const fixtureDocsRoot = join(appRoot, "public/docs");
const publicReaderPath = join(
	appRoot,
	"public/docs/regulations/student_rules/doc-c62077b20430.html",
);
const docsIndexPath = join(appRoot, "public/docs/index.html");
const regulationsIndexPath = join(appRoot, "public/docs/regulations/index.html");
const studentRulesIndexPath = join(appRoot, "public/docs/regulations/student_rules/index.html");
const historicalReaderPath = join(
	appRoot,
	"public/docs/regulations/student_rules/doc-c62077b20430/v/2024-current.html",
);
const singleVersionReaderPath = join(
	appRoot,
	"public/docs/regulations/student_rules/single-version-doc.html",
);
const versionFailureReaderPath = join(
	appRoot,
	"public/docs/regulations/student_rules/version-api-failure.html",
);
const gatedReaderPath = join(
	appRoot,
	"public/docs/regulations/scoped_rules/restricted-policy.html",
);
const publicReaderEntryUrl = "/src/testing/e2e-worker/public-docs-reader-entry.tsx";
const gatedBootstrapEntryUrl = "/src/testing/e2e-worker/gated-docs-bootstrap-entry.tsx";
const e2eWorkerPort = Number.parseInt(process.env.CAMPUS_WEB_E2E_WORKER_PORT ?? "27016", 10);
const e2eWorkerOrigin = `http://127.0.0.1:${e2eWorkerPort}`;
const docsVersions = {
	versions: [
		{ isCurrent: true, label: "现行版", versionSlug: "2026-current" },
		{ isCurrent: false, label: "2024 版", versionSlug: "2024-current" },
	],
};
const singleVersionDocsVersions = {
	versions: [{ isCurrent: true, label: "现行版", versionSlug: "2026-current" }],
};

rmSync(fixtureDocsRoot, { force: true, recursive: true });

writeDirectoryPage(docsIndexPath, {
	links: [{ href: "/docs/regulations/", label: "规章制度" }],
	navLabel: "文档目录",
	title: "文档",
});
writeDirectoryPage(regulationsIndexPath, {
	links: [{ href: "/docs/regulations/student_rules/", label: "学生手册" }],
	navLabel: "文档集合目录",
	title: "规章制度",
});
writeDirectoryPage(studentRulesIndexPath, {
	links: [{ href: "/docs/regulations/student_rules/doc-c62077b20430", label: "学生管理规定" }],
	navLabel: "文档列表",
	title: "学生手册",
});
writeReaderPage(publicReaderPath, {
	documentSlug: "doc-c62077b20430",
	isCurrent: true,
	routeSlug: "doc-c62077b20430",
	title: "学生管理规定",
	versionPayload: docsVersions,
	versionLabel: "现行版",
	versionSlug: "2026-current",
});
writeReaderPage(historicalReaderPath, {
	documentSlug: "doc-c62077b20430",
	isCurrent: false,
	routeSlug: "doc-c62077b20430",
	title: "学生管理规定历史版",
	versionPayload: docsVersions,
	versionLabel: "2024 版",
	versionSlug: "2024-current",
});
writeReaderPage(singleVersionReaderPath, {
	documentSlug: "single-version-doc",
	isCurrent: true,
	routeSlug: "single-version-doc",
	title: "单版本制度",
	versionPayload: singleVersionDocsVersions,
	versionLabel: "现行版",
	versionSlug: "2026-current",
});
writeReaderPage(versionFailureReaderPath, {
	documentSlug: "version-api-failure",
	isCurrent: true,
	routeSlug: "version-api-failure",
	title: "版本接口异常制度",
	versionPayload: null,
	versionLabel: "现行版",
	versionSlug: "2026-current",
});
writeGatedReaderPage(gatedReaderPath);

function writeDirectoryPage(outputPath, input) {
	writeHtml(outputPath, [
		"<!doctype html>",
		'<html lang="zh">',
		"<head>",
		'<meta charset="utf-8" />',
		"<title>中央民族大学校园问答</title>",
		"<style>body{margin:0;font-family:sans-serif}.rspress-doc{max-width:760px;margin:0 auto;padding:32px 20px}.docs-category-links ul{display:grid;gap:8px;padding:0;list-style:none}.docs-category-links a{display:block;padding:10px 12px;border:1px solid #d4d4d8;border-radius:8px;text-decoration:none}</style>",
		"</head>",
		"<body>",
		'<div id="__rspress_root">',
		'<main class="rspress-doc">',
		`<h1>${input.title}</h1>`,
		`<nav class="docs-category-links" aria-label="${input.navLabel}">`,
		"<ul>",
		...input.links.map((link) => `<li><a href="${link.href}">${link.label}</a></li>`),
		"</ul>",
		"</nav>",
		"</main>",
		"</div>",
		"</body>",
		"</html>",
	]);
}

function writeReaderPage(outputPath, input) {
	writeHtml(outputPath, [
		"<!doctype html>",
		'<html lang="zh">',
		"<head>",
		'<meta charset="utf-8" />',
		"<title>中央民族大学校园问答</title>",
		"<style>body{margin:0;font-family:sans-serif}.rp-nav__right{display:flex;justify-content:flex-end;padding:8px 12px}.rp-sidebar-menu__left{min-height:40px}.rp-doc-layout__sidebar{display:none}.rp-doc-layout__sidebar--open{display:block}.rspress-doc{max-width:760px;margin:0 auto;padding:32px 20px}.reader-block{padding:8px 0}.docs-reader-highlight{outline:3px solid #2563eb}.docs-protected-search-results{display:grid;gap:8px}.docs-protected-search-result{display:grid;padding:8px;border:1px solid #d4d4d8}</style>",
		"</head>",
		"<body>",
		'<nav aria-label="文档顶栏"><div class="rp-nav__right"><button class="rp-nav-hamburger" type="button">菜单</button></div></nav>',
		'<button class="rp-sidebar-menu__left" type="button" onclick="document.querySelector(\'.rp-doc-layout__sidebar\').classList.toggle(\'rp-doc-layout__sidebar--open\')">目录</button>',
		'<aside class="rp-doc-layout__sidebar"><a href="#scholarship">奖学金申请条件</a><a href="#procedure">处分流程</a></aside>',
		'<button class="rp-sidebar-menu__mask" type="button" onclick="document.querySelector(\'.rp-doc-layout__sidebar\').classList.remove(\'rp-doc-layout__sidebar--open\')">关闭遮罩</button>',
		'<div id="__rspress_root">',
		'<main class="rspress-doc">',
		renderReaderMeta(input),
		`<h1>${input.title}</h1>`,
		'<nav aria-label="本页"><a href="#scholarship">奖学金申请条件</a><a href="#procedure">处分流程</a></nav>',
		'<p><a href="/docs/regulations/student_rules/doc-c62077b20430?hl=root-procedure#procedure">查看处分流程</a></p>',
		'<section><span id="scholarship"></span><h2>奖学金申请条件</h2><div class="reader-block" data-root-unit-id="root-scholarship">奖学金章节正文。</div></section>',
		'<section><span id="procedure"></span><h2>处分流程</h2><div class="reader-block" data-root-unit-id="root-procedure">处分流程正文。</div></section>',
		'<div class="docs-table-scroll"><table><tbody><tr><th>项目</th><th>要求</th></tr><tr><td>奖学金</td><td>无违纪记录</td></tr></tbody></table></div>',
		'<section aria-label="文档搜索"><label>搜索文档<input aria-label="搜索文档" data-public-docs-search /></label><button type="button" data-public-docs-search-button>搜索</button><div data-public-docs-search-results></div></section>',
		"</main>",
		"</div>",
		'<div id="docs-reader-enhancer-root"></div>',
		'<script type="module">',
		'import RefreshRuntime from "/@react-refresh";',
		"RefreshRuntime.injectIntoGlobalHook(window);",
		"window.$RefreshReg$ = () => {};",
		"window.$RefreshSig$ = () => (type) => type;",
		"window.__vite_plugin_react_preamble_installed__ = true;",
		"</script>",
		'<script type="module" src="/@vite/client"></script>',
		`<script type="module" src="${publicReaderEntryUrl}"></script>`,
		"<script>",
		"document.querySelector('[data-public-docs-search-button]').addEventListener('click',()=>{const q=document.querySelector('[data-public-docs-search]').value.trim();const root=document.querySelector('[data-public-docs-search-results]');root.innerHTML=q?'<a href=\"/docs/regulations/student_rules/doc-c62077b20430?hl=root-scholarship#scholarship\">奖学金章节 - 奖学金申请条件</a>':'';});",
		"</script>",
		"</body>",
		"</html>",
	]);
}

function writeGatedReaderPage(outputPath) {
	writeHtml(outputPath, [
		"<!doctype html>",
		'<html lang="zh">',
		"<head>",
		'<meta charset="utf-8" />',
		"<title>受保护文档</title>",
		"<style>body{margin:0;font-family:sans-serif}.reader-bootstrap-article{max-width:760px;margin:0 auto;padding:32px 20px}.reader-block{padding:8px 0}.docs-reader-highlight{outline:3px solid #2563eb}.docs-table-scroll{max-width:100%;overflow-x:auto;border:1px solid #d4d4d8}.docs-table-scroll table{width:max-content;min-width:100%;border-collapse:collapse}.docs-table-scroll td{padding:8px;border:1px solid #d4d4d8}.docs-protected-search-results{display:grid;gap:8px}.docs-protected-search-result{display:grid;padding:8px;border:1px solid #d4d4d8}</style>",
		"</head>",
		"<body>",
		'<div id="__rspress_root">',
		'<div id="gated-docs-bootstrap-root" data-gated-docs-kind="reader"></div>',
		"</div>",
		'<script id="__CAMPUS_RUNTIME_CONFIG__" type="application/json">',
		JSON.stringify({
			accountUrl: `${e2eWorkerOrigin}/account`,
			loginUrl: `${e2eWorkerOrigin}/account/login`,
		}),
		"</script>",
		'<script type="module">',
		'import RefreshRuntime from "/@react-refresh";',
		"RefreshRuntime.injectIntoGlobalHook(window);",
		"window.$RefreshReg$ = () => {};",
		"window.$RefreshSig$ = () => (type) => type;",
		"window.__vite_plugin_react_preamble_installed__ = true;",
		"</script>",
		'<script type="module" src="/@vite/client"></script>',
		`<script type="module" src="${gatedBootstrapEntryUrl}"></script>`,
		"</body>",
		"</html>",
	]);
}

function renderReaderMeta(input) {
	const versionAttribute = input.versionPayload
		? ` data-docs-versions="${escapeHtml(JSON.stringify(input.versionPayload))}"`
		: "";
	return [
		'<section class="document-meta-panel" data-docs-reader-meta="true"',
		' data-docs-corpus="regulations"',
		' data-docs-collection="student_rules"',
		` data-docs-document-slug="${input.documentSlug}"`,
		` data-docs-route-slug="${input.routeSlug}"`,
		` data-docs-version-slug="${input.versionSlug}"`,
		` data-docs-is-current="${input.isCurrent}"`,
		' data-docs-search-visibility="public_current"',
		`${versionAttribute}>`,
		`<p class="document-meta-summary"><span>${input.versionLabel}</span><span>公开</span></p>`,
		'<details class="document-meta-details"><summary>来源详情</summary></details>',
		"</section>",
	].join("");
}

function writeHtml(outputPath, parts) {
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, parts.join(""));
}

function escapeHtml(value) {
	return value
		.replace(/&/gu, "&amp;")
		.replace(/"/gu, "&quot;")
		.replace(/</gu, "&lt;")
		.replace(/>/gu, "&gt;");
}
