export { account, session, user, verification } from "./auth";
export { conversations, messages } from "./chat";
export { requestProjection } from "./operator";
export { projectionOutbox, requestExecution } from "./runtime";

import { account, session, user, verification } from "./auth";
import { conversations, messages } from "./chat";
import { requestProjection } from "./operator";
import { projectionOutbox, requestExecution } from "./runtime";

export const appApiSchema = {
  user,
  session,
  account,
  verification,
  conversations,
  messages,
  requestExecution,
  projectionOutbox,
  requestProjection,
};
