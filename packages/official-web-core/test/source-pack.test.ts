import { describe } from "vitest";

import { registerOfficialWebSourcePackPart01 } from "./source-pack.part01.suite";
import { registerOfficialWebSourcePackPart02 } from "./source-pack.part02.suite";

describe("official web source pack config", () => {
	registerOfficialWebSourcePackPart01();
	registerOfficialWebSourcePackPart02();
});
