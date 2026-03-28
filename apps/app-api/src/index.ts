import { createApp, type AppDependencies } from "./app";
import type { Env } from "./config";
import { createOfficialWebHandoffPublisher } from "./modules/integration";
import {
  buildOfficialWebProjectionProjector,
  createPgOfficialWebProjectionStore,
  type OfficialWebProjectionProjector,
} from "./modules/official-web-projection";
import {
  buildRequestProjectionProjector,
  createPgProjectionStore,
  type RequestProjectionProjector,
} from "./modules/projection";

export type { Env } from "./config";

export interface WorkerRuntimeDependencies extends AppDependencies {
  officialWebProjector?: OfficialWebProjectionProjector;
  requestProjector?: RequestProjectionProjector;
}

export function createWorkerRuntime(
  env: Env,
  dependencies: WorkerRuntimeDependencies = {},
) {
  const requestProjector =
    dependencies.requestProjector ??
    buildRequestProjectionProjector({
      store: createPgProjectionStore(env),
    });
  const officialWebProjector =
    dependencies.officialWebProjector ??
    buildOfficialWebProjectionProjector({
      handoffPublisher: createOfficialWebHandoffPublisher(env),
      store: createPgOfficialWebProjectionStore(env),
    });

  return {
    fetch(request: Request): Promise<Response> | Response {
      return createApp(env, dependencies).fetch(request, env);
    },
    async scheduled(): Promise<void> {
      const requestResult = await requestProjector.drain();
      const officialWebResult = await officialWebProjector.drain();
      if (requestResult.processed > 0) {
        console.info(
          JSON.stringify({
            failed: requestResult.failed,
            processed: requestResult.processed,
            source: "app-api.request-projection-projector",
          }),
        );
      }
      if (requestResult.failed > 0) {
        console.error(
          JSON.stringify({
            failed: requestResult.failed,
            processed: requestResult.processed,
            source: "app-api.request-projection-projector",
          }),
        );
      }
      if (officialWebResult.processed > 0 || officialWebResult.abandoned > 0) {
        console.info(
          JSON.stringify({
            abandoned: officialWebResult.abandoned,
            failed: officialWebResult.failed,
            processed: officialWebResult.processed,
            source: "app-api.official-web-projection-projector",
          }),
        );
      }
      if (officialWebResult.failed > 0) {
        console.error(
          JSON.stringify({
            abandoned: officialWebResult.abandoned,
            failed: officialWebResult.failed,
            processed: officialWebResult.processed,
            source: "app-api.official-web-projection-projector",
          }),
        );
      }
    },
  };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    return createWorkerRuntime(env).fetch(request);
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await createWorkerRuntime(env).scheduled();
  },
};
