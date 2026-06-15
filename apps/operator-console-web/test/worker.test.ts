import "./data-provider.test";
import "./audit-domain.test";
import "./cost-domain.test";
import "./official-web-release-task-ui.test";
import "./overview-domain.test";
import "./panel-shell-copy-regression.test";
import "./quality-domain.test";
import "./safety-domain.test";

import { describe } from "vitest";
import { registerWorkerDiningOpsProxySuite } from "./worker.dining-ops-proxy.suite";
import { registerWorkerOperatorDomainsSuite } from "./worker.operator-domains.suite";
import { registerWorkerOverviewAdmissionSuite } from "./worker.overview-admission.suite";
import { registerWorkerReadinessSuite } from "./worker.readiness.suite";
import { registerWorkerRequestProxySuite } from "./worker.request-proxy.suite";
import { registerWorkerRuntimeConfigSuite } from "./worker.runtime-config.suite";
import { registerWorkerShellAssetsSuite } from "./worker.shell-assets.suite";

describe("Operator Console web worker shell", () => {
	registerWorkerRuntimeConfigSuite();
	registerWorkerReadinessSuite();
	registerWorkerShellAssetsSuite();
	registerWorkerOverviewAdmissionSuite();
	registerWorkerRequestProxySuite();
	registerWorkerDiningOpsProxySuite();
	registerWorkerOperatorDomainsSuite();
});
