import { registerDataProviderOfficialWebSuitePart01 } from "./data-provider.official-web.part01.suite";
import { registerDataProviderOfficialWebSuitePart02 } from "./data-provider.official-web.part02.suite";

export function registerDataProviderOfficialWebSuite() {
	registerDataProviderOfficialWebSuitePart01();
	registerDataProviderOfficialWebSuitePart02();
}
