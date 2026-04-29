import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import mainSource from "../src/main.tsx?raw";
import appSource from "../src/panel/app.tsx?raw";
import auditPageSource from "../src/panel/pages/audit-page.tsx?raw";
import costPageSource from "../src/panel/pages/cost-page.tsx?raw";
import delayedDomainPageSource from "../src/panel/pages/delayed-domain-page.tsx?raw";
import overviewPageSource from "../src/panel/pages/overview-page.tsx?raw";
import qualityPageSource from "../src/panel/pages/quality-page.tsx?raw";
import requestShowSource from "../src/panel/requests/request-show.tsx?raw";

function readOptionalSource(relativePath: string) {
	try {
		return readFileSync(new URL(relativePath, import.meta.url), "utf8");
	} catch {
		return "";
	}
}

const safetyPageSource = readOptionalSource("../src/panel/pages/safety-page.tsx");
describe("protected panel loading effects", () => {
	it("does not use useEffectEvent for render-driven overview loading", () => {
		expect(overviewPageSource).not.toContain("useEffectEvent");
	});

	it("does not use useEffectEvent for request observability loading", () => {
		expect(requestShowSource).not.toContain("useEffectEvent");
	});

	it("does not use useEffectEvent for quality domain loading", () => {
		expect(qualityPageSource).not.toContain("useEffectEvent");
	});

	it("does not depend on the react-admin dataProvider proxy identity for overview loading", () => {
		expect(overviewPageSource).not.toContain("}, [dataProvider]);");
	});

	it("does not depend on the react-admin dataProvider proxy identity for request observability loading", () => {
		expect(requestShowSource).not.toContain("}, [dataProvider, record?.requestId]);");
	});

	it("does not depend on the react-admin dataProvider proxy identity for quality domain loading", () => {
		expect(qualityPageSource).not.toContain("}, [dataProvider]);");
	});

	it("does not lazily split protected panel route pages behind access-protected chunk requests", () => {
		expect(appSource).not.toContain("const OverviewPage = lazy(");
		expect(appSource).not.toContain("withPanelPageSuspense(");
	});

	it("pins the panel to direct chinese copy without react-admin i18n provider", () => {
		expect(appSource).toContain("disableTelemetry");
		expect(appSource).not.toContain("i18nProvider=");
	});

	it("provides explicit app bar titles for custom panel routes", () => {
		expect(overviewPageSource).toContain("<Title title={PANEL_COPY.menu.overview} />");
		expect(delayedDomainPageSource).toContain("<Title title={domain} />");
	});

	it("uses query-driven overview loading instead of a hand-rolled getOverview ref loop", () => {
		expect(overviewPageSource).toContain("useQueries(");
		expect(overviewPageSource).not.toContain(
			"const getOverviewRef = useRef(dataProvider.getOverview);",
		);
		expect(overviewPageSource).not.toContain("getOverviewRef.current({");
	});

	it("uses query-driven quality loading instead of direct fetch calls", () => {
		expect(qualityPageSource).toContain("useQueries(");
		expect(qualityPageSource).toContain("useQuery(");
		expect(qualityPageSource).toContain("listOperatorQualityEvalCandidates");
		expect(qualityPageSource).not.toContain("fetch(");
	});

	it("uses query-driven safety loading without fake CRUD resource fallback", () => {
		expect(safetyPageSource).toContain("useQueries(");
		expect(safetyPageSource).toContain("useQuery(");
		expect(safetyPageSource).toContain("getOperatorSafetySummary");
		expect(safetyPageSource).toContain("listOperatorSafetyAnomalies");
		expect(safetyPageSource).not.toContain("fetch(");
		expect(safetyPageSource).not.toContain('getList("operatorSafetyAnomalies"');
		expect(safetyPageSource).not.toContain('resource="operatorSafetyAnomalies"');
	});

	it("uses query-driven cost loading without fake CRUD or hand-rolled fetch calls", () => {
		expect(costPageSource).toContain("useQueries(");
		expect(costPageSource).toContain("getOperatorCostSummary");
		expect(costPageSource).toContain("getOperatorCostTimeseries");
		expect(costPageSource).not.toContain("useEffectEvent");
		expect(costPageSource).not.toContain("fetch(");
		expect(costPageSource).not.toContain("modelName");
		expect(costPageSource).not.toContain('getList("operatorCost"');
		expect(costPageSource).not.toContain('resource="operatorCost"');
	});

	it("uses query-driven audit loading without fake CRUD or hand-rolled fetch calls", () => {
		expect(auditPageSource).toContain("useQuery(");
		expect(auditPageSource).toContain("listOperatorAudit");
		expect(auditPageSource).toContain("getOperatorAuditEvent");
		expect(auditPageSource).not.toContain("useEffectEvent");
		expect(auditPageSource).not.toContain("fetch(");
		expect(auditPageSource).not.toContain('getList("operatorAudit"');
		expect(auditPageSource).not.toContain('resource="operatorAudit"');
	});

	it("does not lazily split the protected panel app entry", () => {
		expect(mainSource).not.toContain("const ProtectedPanelAdminApp = lazy(");
		expect(mainSource).not.toContain('await import("./panel/app")');
	});
});
