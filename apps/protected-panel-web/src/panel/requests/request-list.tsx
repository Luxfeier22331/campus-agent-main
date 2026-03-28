import {
  Datagrid,
  DateField,
  FunctionField,
  List,
  SelectInput,
  ShowButton,
  TextField,
  TextInput,
} from "react-admin";

import type { RequestProjectionRecord } from "../types";
import { formatDuration, formatScope } from "./request-formatters";

const requestFilters = [
  <TextInput alwaysOn key="requestId" label="Request ID" source="requestId" />,
  <SelectInput
    choices={[
      { id: "accepted", name: "Accepted" },
      { id: "completed", name: "Completed" },
      { id: "needs_clarification", name: "Needs clarification" },
      { id: "no_answer", name: "No answer" },
      { id: "error", name: "Error" },
    ]}
    emptyText="All statuses"
    key="status"
    label="Status"
    source="status"
  />,
  <TextInput key="surface" label="Surface" source="surface" />,
  <TextInput key="conversationId" label="Conversation" source="conversationId" />,
];

export function RequestListPage() {
  return (
    <List
      emptyWhileLoading
      filters={requestFilters}
      perPage={20}
      sort={{ field: "startedAt", order: "DESC" }}
      title="Requests"
    >
      <Datagrid bulkActionButtons={false} rowClick="show">
        <TextField label="Request" source="requestId" />
        <FunctionField
          label="Actor"
          render={(record: RequestProjectionRecord) =>
            record.principalLabel || record.principalId
          }
        />
        <TextField label="Surface" source="surface" />
        <TextField label="Status" source="status" />
        <FunctionField
          label="Capability"
          render={(record: RequestProjectionRecord) =>
            record.requestedCapability || "Unspecified"
          }
        />
        <FunctionField
          label="Scope"
          render={(record: RequestProjectionRecord) => formatScope(record.requestedScope)}
        />
        <FunctionField
          label="Question"
          render={(record: RequestProjectionRecord) => record.questionPreview}
        />
        <FunctionField
          label="Duration"
          render={(record: RequestProjectionRecord) => formatDuration(record.durationMs)}
        />
        <DateField label="Started" showTime source="startedAt" />
        <ShowButton />
      </Datagrid>
    </List>
  );
}
