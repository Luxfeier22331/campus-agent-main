// @vitest-environment node

import { registerOperatorQueryRequestDetailSuite } from "./operator-query.route.request-detail.suite";
import { registerOperatorQueryRequestsListSuite } from "./operator-query.route.requests-list.suite";
import { registerOperatorQueryRetiredRoutesSuite } from "./operator-query.route.retired.suite";
import { registerOperatorQueryRuntimeHealthSuite } from "./operator-query.route.runtime-health.suite";
import { registerOperatorQueryRuntimeOpsSuite } from "./operator-query.route.runtime-ops.suite";

registerOperatorQueryRequestsListSuite();
registerOperatorQueryRequestDetailSuite();
registerOperatorQueryRuntimeHealthSuite();
registerOperatorQueryRuntimeOpsSuite();
registerOperatorQueryRetiredRoutesSuite();
