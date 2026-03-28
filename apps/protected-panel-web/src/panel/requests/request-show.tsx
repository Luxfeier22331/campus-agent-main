import {
  DateField,
  FunctionField,
  Show,
  SimpleShowLayout,
  TextField,
} from "react-admin";

import type { RequestProjectionRecord } from "../types";
import { formatDuration, formatScope } from "./request-formatters";

export function RequestShowPage() {
  return (
    <Show title="Request Detail">
      <SimpleShowLayout>
        <TextField label="Request ID" source="requestId" />
        <TextField label="Trace ID" source="traceId" />
        <TextField label="Status" source="status" />
        <TextField label="Surface" source="surface" />
        <TextField label="Conversation" source="conversationId" />
        <FunctionField
          label="Actor"
          render={(record: RequestProjectionRecord) =>
            record.principalLabel || record.principalId
          }
        />
        <TextField label="Actor Type" source="principalType" />
        <FunctionField
          label="Capability"
          render={(record: RequestProjectionRecord) =>
            record.requestedCapability || "Unspecified"
          }
        />
        <FunctionField
          label="Requested Scope"
          render={(record: RequestProjectionRecord) => formatScope(record.requestedScope)}
        />
        <TextField label="Selected Target" source="selectedTarget" />
        <FunctionField
          label="Question Preview"
          render={(record: RequestProjectionRecord) => record.questionPreview}
        />
        <FunctionField
          label="Answer Preview"
          render={(record: RequestProjectionRecord) => record.answerPreview || "No answer preview"}
        />
        <FunctionField
          label="Error Code"
          render={(record: RequestProjectionRecord) => record.errorCode || "None"}
        />
        <FunctionField
          label="Source Documents"
          render={(record: RequestProjectionRecord) =>
            record.sourceDocIds.length > 0 ? record.sourceDocIds.join(", ") : "None"
          }
        />
        <FunctionField
          label="Duration"
          render={(record: RequestProjectionRecord) => formatDuration(record.durationMs)}
        />
        <DateField label="Started" showTime source="startedAt" />
        <DateField emptyText="Pending" label="Completed" showTime source="completedAt" />
        <DateField label="Projected" showTime source="projectedAt" />
      </SimpleShowLayout>
    </Show>
  );
}
