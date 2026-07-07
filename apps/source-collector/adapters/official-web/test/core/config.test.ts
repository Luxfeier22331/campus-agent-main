import { describe } from "vitest";

import { registerOfficialWebConfigPart01 } from "./config.part01.suite";
import { registerOfficialWebConfigPart02 } from "./config.part02.suite";

describe("official-web adapter core config loading", () => {
	registerOfficialWebConfigPart01();
	registerOfficialWebConfigPart02();
});
