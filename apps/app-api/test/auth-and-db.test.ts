// @vitest-environment node

import { registerApiMeSuite } from "./auth-and-db-api-me.suite";
import { registerAppApiAuthConfigSuite } from "./auth-and-db-auth.suite";
import { registerAppApiDatabaseConfigSuite } from "./auth-and-db-database.suite";

registerAppApiDatabaseConfigSuite();
registerAppApiAuthConfigSuite();
registerApiMeSuite();
