import { createApp } from "./app";
import type { Env } from "./config";
import { buildRequestProjectionProjector, createPgProjectionStore } from "./modules/projection";

export type { Env } from "./config";

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    return createApp(env).fetch(request, env);
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const projector = buildRequestProjectionProjector({
      store: createPgProjectionStore(env),
    });

    const result = await projector.drain();
    if (result.processed > 0) {
      console.info(
        JSON.stringify({
          failed: result.failed,
          processed: result.processed,
          source: "app-api.request-projection-projector",
        }),
      );
    }
    if (result.failed > 0) {
      console.error(
        JSON.stringify({
          failed: result.failed,
          processed: result.processed,
          source: "app-api.request-projection-projector",
        }),
      );
    }
  },
};
