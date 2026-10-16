import { Ajv2020 } from "ajv/dist/2020.js";
import { assert, describe, expect, it } from "vitest";
import fixtures from "../fixtures/agent-runtime-control.v1.json" with { type: "json" };
import schema from "../schemas/agent-runtime-control.v1.schema.json" with { type: "json" };

const ajv = new Ajv2020({ strict: false, validateFormats: false });
ajv.addSchema(schema);
describe("Runtime Control wire fixtures", () => {
	for (const fixture of fixtures) {
		it(fixture.name, () => {
			const validate = ajv.getSchema(`${schema.$id}#/$defs/${fixture.schema}`);
			assert(validate);
			expect(validate(fixture.value), JSON.stringify(validate.errors)).toBe(fixture.valid);
		});
	}
});
