import { describe, expect, it } from "vitest";

import { buildRequestShowPath } from "../src/panel/requests/request-routes";

describe("protected panel request routes", () => {
  it("encodes request identifiers as a single route segment", () => {
    expect(buildRequestShowPath("req/01?debug=true#frag")).toBe(
      "/requests/req%2F01%3Fdebug%3Dtrue%23frag/show",
    );
  });
});
