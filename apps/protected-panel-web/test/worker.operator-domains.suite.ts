import { registerWorkerOperatorDomainsSuitePart01 } from "./worker.operator-domains.part01.suite";
import { registerWorkerOperatorDomainsSuitePart02 } from "./worker.operator-domains.part02.suite";
import { registerWorkerOperatorDomainsSuitePart03 } from "./worker.operator-domains.part03.suite";
import { registerWorkerOperatorDomainsSuitePart04 } from "./worker.operator-domains.part04.suite";

export function registerWorkerOperatorDomainsSuite() {
	registerWorkerOperatorDomainsSuitePart01();
	registerWorkerOperatorDomainsSuitePart02();
	registerWorkerOperatorDomainsSuitePart03();
	registerWorkerOperatorDomainsSuitePart04();
}
