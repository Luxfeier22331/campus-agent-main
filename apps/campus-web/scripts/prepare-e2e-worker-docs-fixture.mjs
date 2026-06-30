import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(fileURLToPath(import.meta.url)).replace(/[/\\]scripts$/u, "");

const docsPath = join(appRoot, "public/docs/regulations/student_rules/doc-c62077b20430.html");
const versionedDocsPath = join(
	appRoot,
	"public/docs/regulations/student_rules/doc-c62077b20430/v/2024-current.html",
);
const gatedReaderPath = join(
	appRoot,
	"public/docs/regulations/scoped_rules/restricted-policy.html",
);
const gatedBootstrapEntryPath = join(appRoot, "e2e-worker/fixtures/gated-docs-bootstrap-entry.tsx");
const gatedBootstrapEntryUrl = `/@fs/${gatedBootstrapEntryPath.replace(/\\/gu, "/")}`;

mkdirSync(dirname(docsPath), { recursive: true });
writeFileSync(
	docsPath,
	[
		"<!doctype html>",
		'<html lang="zh">',
		"<head>",
		'<meta charset="utf-8" />',
		"<title>中央民族大学校园问答</title>",
		"</head>",
		"<body>",
		'<div id="__rspress_root">Rspress canonical reader</div>',
		"</body>",
		"</html>",
	].join(""),
);

mkdirSync(dirname(versionedDocsPath), { recursive: true });
writeFileSync(
	versionedDocsPath,
	[
		"<!doctype html>",
		'<html lang="zh">',
		"<head>",
		'<meta charset="utf-8" />',
		"<title>中央民族大学校园问答</title>",
		"</head>",
		"<body>",
		'<div id="__rspress_root">Rspress versioned reader</div>',
		"</body>",
		"</html>",
	].join(""),
);

mkdirSync(dirname(gatedReaderPath), { recursive: true });
writeFileSync(
	gatedReaderPath,
	[
		"<!doctype html>",
		'<html lang="zh">',
		"<head>",
		'<meta charset="utf-8" />',
		"<title>受保护文档</title>",
		"</head>",
		"<body>",
		'<div id="__rspress_root">',
		'<div id="gated-docs-bootstrap-root" data-gated-docs-kind="reader"></div>',
		"</div>",
		'<script id="__CAMPUS_RUNTIME_CONFIG__" type="application/json">',
		JSON.stringify({
			accountUrl: "http://127.0.0.1:27016/account",
			loginUrl: "http://127.0.0.1:27016/account/login",
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
	].join(""),
);
