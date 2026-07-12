import { describe, expect, it } from "vitest";

import packageManifest from "../package.json" with { type: "json" };
import workerSource from "../src/index/worker.ts?raw";
import appSource from "../src/panel/app.tsx?raw";
import providerConfigSource from "../src/panel/operations/provider-config/page.tsx?raw";

describe("minimal Operator Console shell contract", () => {
	it("does not ship react-admin or MUI as the operator shell foundation", () => {
		expect(packageManifest.dependencies).not.toHaveProperty("react-admin");
		expect(packageManifest.dependencies).not.toHaveProperty("@mui/material");
		expect(packageManifest.dependencies).not.toHaveProperty("@mui/icons-material");
		expect(packageManifest.dependencies).not.toHaveProperty("@mui/x-charts");
		expect(packageManifest.dependencies).not.toHaveProperty("@emotion/react");
		expect(packageManifest.dependencies).not.toHaveProperty("@emotion/styled");
	});

	it("keeps offline eval and broad governance pages out of the online nav", () => {
		expect(appSource).toContain('label: "请求与运行"');
		expect(appSource).toContain('label: "模型服务配置"');
		expect(appSource).not.toContain('label: "总览"');
		expect(appSource).not.toContain('label: "官网采集"');
		expect(appSource).not.toContain('label: "食堂运营"');
		expect(appSource).not.toContain('label: "审计"');
		expect(appSource).not.toContain("/observability/overview");
		expect(appSource).not.toContain("/observability/audit");
		expect(appSource).not.toContain("/official-web");
		expect(appSource).not.toContain("/operations/dining");
		expect(appSource).not.toContain("/observability/eval-coverage");
		expect(appSource).not.toContain("/observability/intent");
		expect(appSource).not.toContain("/observability/cost");
		expect(appSource).not.toContain("/observability/safety");
		expect(appSource).not.toContain("OfficialWebPage");
		expect(appSource).not.toContain("DiningWorkspacePage");
		expect(appSource).not.toContain("AuditPage");
		expect(appSource).not.toContain("EvalCoveragePage");
		expect(appSource).not.toContain("IntentPage");
		expect(appSource).not.toContain("CostPage");
		expect(appSource).not.toContain("SafetyPage");
	});

	it("does not expose a fake domain readiness matrix from the Worker overview", () => {
		expect(workerSource).not.toContain("panel_domains");
		expect(workerSource).not.toContain("operator_console_domains");
		expect(workerSource).not.toContain('overview: "ready"');
		expect(workerSource).not.toContain('audit: "ready"');
	});

	it("does not keep hidden proxy prefixes for pages that are not in the minimal panel", () => {
		expect(workerSource).not.toContain('prefix: "/api/requests/"');
		expect(workerSource).not.toContain("/api/ops/dining");
		expect(workerSource).not.toContain("/api/official-web");
		expect(workerSource).not.toContain("/api/operator/audit");
	});

	it("uses mature UI primitives instead of local form and table widgets", () => {
		expect(appSource).not.toContain("TableWrap");
		expect(appSource).not.toContain(" Td,");
		expect(appSource).not.toContain(" Th,");
		expect(providerConfigSource).not.toContain("<select");
		expect(providerConfigSource).not.toContain("<input");
		expect(providerConfigSource).not.toContain("<button");
		expect(providerConfigSource).not.toContain("ops-primary-button");
		expect(providerConfigSource).not.toContain("ops-secondary-button");
		expect(providerConfigSource).not.toContain("ops-table");
		expect(packageManifest.dependencies).toHaveProperty("react-hook-form");
		expect(packageManifest.dependencies).toHaveProperty("zod");
		expect(packageManifest.dependencies).toHaveProperty("@hookform/resolvers");
	});
});
