import { describe, expect, it } from "vitest";

import {
  buildOfficialWebRunShowPath,
  buildOfficialWebSiteShowPath,
} from "../src/panel/official-web/official-web-routes";

describe("protected panel official web routes", () => {
  it("encodes official web identifiers as single route segments", () => {
    expect(buildOfficialWebRunShowPath("run/01?debug=true#frag")).toBe(
      "/officialWebRuns/run%2F01%3Fdebug%3Dtrue%23frag/show",
    );
    expect(buildOfficialWebSiteShowPath("site/01?debug=true#frag")).toBe(
      "/officialWebSites/site%2F01%3Fdebug%3Dtrue%23frag/show",
    );
  });
});
