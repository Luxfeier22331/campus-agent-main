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

    await projector.drain();
  },
};
