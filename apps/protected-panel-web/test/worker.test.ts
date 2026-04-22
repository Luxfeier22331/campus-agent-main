import "./data-provider.test";
import "./audit-domain.test";
import "./cost-domain.test";
import "./overview-domain.test";
import "./panel-shell-copy-regression.test";
import "./quality-domain.test";
import "./safety-domain.test";

import { describe } from "vitest";

import { registerWorkerOperatorDomainsSuite } from "./worker.operator-domains.suite";
import { registerWorkerOverviewAdmissionSuite } from "./worker.overview-admission.suite";
import { registerWorkerReadinessSuite } from "./worker.readiness.suite";
import { registerWorkerRequestProxySuite } from "./worker.request-proxy.suite";
import { registerWorkerRuntimeConfigSuite } from "./worker.runtime-config.suite";
import { registerWorkerShellAssetsSuite } from "./worker.shell-assets.suite";

describe("protected panel web worker shell", () => {
	registerWorkerRuntimeConfigSuite();
	registerWorkerReadinessSuite();
	registerWorkerShellAssetsSuite();
	registerWorkerOverviewAdmissionSuite();
	registerWorkerRequestProxySuite();
	registerWorkerOperatorDomainsSuite();
});
