export function goDecodeHelpers({
	executionStatuses,
	stageTimingFields,
	toolIds,
}: {
	executionStatuses: string[];
	stageTimingFields: string[];
	toolIds: string[];
}): string {
	const toolIdCases = toolIds.map((value) => `ToolID${goConstSuffix(value)}`).join(", ");
	const executionStatusCases = executionStatuses
		.map((value) => `ExecutionStatus${goConstSuffix(value)}`)
		.join(", ");
	const stageTimingFieldCases = stageTimingFields
		.map((value) => `StageTimingField${goConstSuffix(value)}`)
		.join(",\n\t\t");
	const template = `
func DecodeExecutionPayloadWireJSON(data []byte) (ExecutionPayloadWire, error) {
\tvar wire ExecutionPayloadWire
\tif err := decodeStrictJSON(data, &wire); err != nil {
\t\treturn wire, err
\t}
\tif err := wire.Validate(); err != nil {
\t\treturn wire, err
\t}
\treturn wire, nil
}

func DecodeExecutionRunCreateRequestWireJSON(data []byte) (ExecutionRunCreateRequestWire, error) {
\tvar wire ExecutionRunCreateRequestWire
\tif err := requireJSONObjectFields(data, []string{"personal_memory_recall_allowed"}); err != nil {
\t\treturn wire, err
\t}
\tif err := decodeStrictJSON(data, &wire); err != nil {
\t\treturn wire, err
\t}
\tif err := wire.Validate(); err != nil {
\t\treturn wire, err
\t}
\treturn wire, nil
}

func DecodeToolExecutionResponseWireJSON(data []byte) (ToolExecutionResponseWire, error) {
\tvar wire ToolExecutionResponseWire
\tif err := requireJSONObjectFields(data, []string{
\t\t"status",
\t\t"answer_text",
\t\t"result",
\t\t"error",
\t\t"model_usage",
\t}); err != nil {
\t\treturn wire, err
\t}
\tif err := decodeStrictJSON(data, &wire); err != nil {
\t\treturn wire, err
\t}
\tif err := wire.Validate(); err != nil {
\t\treturn wire, err
\t}
\treturn wire, nil
}

func decodeStrictJSON(data []byte, target any) error {
\tdecoder := json.NewDecoder(bytes.NewReader(data))
\tdecoder.DisallowUnknownFields()
\tif err := decoder.Decode(target); err != nil {
\t\treturn err
\t}
\tvar trailing any
\tif err := decoder.Decode(&trailing); err != io.EOF {
\t\treturn fmt.Errorf("unexpected trailing JSON content")
\t}
\treturn nil
}

func requireJSONObjectFields(data []byte, fields []string) error {
\tvar payload map[string]json.RawMessage
\tif err := json.Unmarshal(data, &payload); err != nil {
\t\treturn err
\t}
\tif payload == nil {
\t\treturn fmt.Errorf("expected JSON object")
\t}
\tfor _, field := range fields {
\t\tif _, ok := payload[field]; !ok {
\t\t\treturn fmt.Errorf("%s is required", field)
\t\t}
\t}
\treturn nil
}

func (wire ExecutionPayloadWire) Validate() error {
\tif wire.ExecutionContractVersion != ExecutionContractVersion {
\t\treturn fmt.Errorf("execution_contract_version must be %s", ExecutionContractVersion)
\t}
\tif wire.ResponseContract != ResponseContract {
\t\treturn fmt.Errorf("response_contract must be %s", ResponseContract)
\t}
\tif wire.UserGoal == "" {
\t\treturn fmt.Errorf("user_goal is required")
\t}
\tif wire.RequestID == "" {
\t\treturn fmt.Errorf("request_id is required")
\t}
\tif wire.ConversationID == "" {
\t\treturn fmt.Errorf("conversation_id is required")
\t}
\tif wire.Context == nil {
\t\treturn fmt.Errorf("context is required")
\t}
\tif _, ok := wire.Context["profile_memory"]; ok {
\t\treturn fmt.Errorf("context.profile_memory is not an active online recall field")
\t}
\treturn nil
}

func (wire ExecutionRunCreateRequestWire) Validate() error {
\tif wire.ConversationID == "" {
\t\treturn fmt.Errorf("conversation_id is required")
\t}
\tif wire.RequestID == "" {
\t\treturn fmt.Errorf("request_id is required")
\t}
\tif !ValidExecutionRequestID(wire.RequestID) {
\t\treturn fmt.Errorf("request_id must match %s", ExecutionRequestIDPattern)
\t}
\tif wire.OwnerUserID == "" {
\t\treturn fmt.Errorf("owner_user_id is required")
\t}
\tif wire.Surface == "" {
\t\treturn fmt.Errorf("surface is required")
\t}
\tif err := wire.Metadata.Validate(wire.RequestID); err != nil {
\t\treturn fmt.Errorf("metadata: %w", err)
\t}
\treturn nil
}

func (wire ExecutionRunMetadataWire) Validate(requestID string) error {
\tif !ValidExecutionRequestID(requestID) {
\t\treturn fmt.Errorf("request_id must match %s", ExecutionRequestIDPattern)
\t}
\tif wire.ExecutionContractVersion != ExecutionContractVersion {
\t\treturn fmt.Errorf("execution_contract_version must be %s", ExecutionContractVersion)
\t}
\texpectedRef := "app-api://execution-inputs/" + requestID
\tif wire.ExecutionInputRef != expectedRef {
\t\treturn fmt.Errorf("execution_input_ref must be %s", expectedRef)
\t}
\tif !isLowerHexSHA256(wire.ExecutionInputSHA256) {
\t\treturn fmt.Errorf("execution_input_sha256 must be 64 lowercase hexadecimal characters")
\t}
\treturn nil
}

func isLowerHexSHA256(value string) bool {
\tif len(value) != 64 {
\t\treturn false
\t}
\tfor _, character := range value {
\t\tif (character < '0' || character > '9') && (character < 'a' || character > 'f') {
\t\t\treturn false
\t\t}
\t}
\treturn true
}

func (wire ToolExecutionResponseWire) Validate() error {
\tif !wire.Status.Valid() {
\t\treturn fmt.Errorf("status is invalid")
\t}
\tif wire.ModelUsage.InputTokens < 0 || wire.ModelUsage.CachedInputTokens < 0 ||
\t\twire.ModelUsage.OutputTokens < 0 || wire.ModelUsage.TotalTokens < 0 ||
\t\twire.ModelUsage.CachedInputTokens > wire.ModelUsage.InputTokens ||
\t\twire.ModelUsage.TotalTokens != wire.ModelUsage.InputTokens+wire.ModelUsage.OutputTokens {
\t\treturn fmt.Errorf("model_usage is invalid")
\t}
\tif wire.Error != nil {
\t\tif code, ok := wire.Error["code"].(string); !ok || code == "" {
\t\t\treturn fmt.Errorf("error.code is required")
\t\t}
\t\tif message, ok := wire.Error["message"].(string); !ok || message == "" {
\t\t\treturn fmt.Errorf("error.message is required")
\t\t}
\t\tif _, ok := wire.Error["retryable"].(bool); !ok {
\t\t\treturn fmt.Errorf("error.retryable is required")
\t\t}
\t}
\tif wire.StageTiming != nil {
\t\tif err := wire.StageTiming.Validate(); err != nil {
\t\t\treturn fmt.Errorf("stage_timing: %w", err)
\t\t}
\t}
\treturn nil
}

func (wire StageTimingWire) Validate() error {
\tfor field, durationMs := range wire {
\t\tif !field.Valid() {
\t\t\treturn fmt.Errorf("%s is not an allowed stage timing field", field)
\t\t}
\t\tif durationMs < 0 || math.IsNaN(durationMs) || math.IsInf(durationMs, 0) {
\t\t\treturn fmt.Errorf("%s must be a finite non-negative duration", field)
\t\t}
\t}
\treturn nil
}

func (value ToolID) Valid() bool {
\tswitch value {
\tcase __TOOL_ID_CASES__:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value ExecutionStatus) Valid() bool {
\tswitch value {
\tcase __EXECUTION_STATUS_CASES__:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

func (value StageTimingField) Valid() bool {
\tswitch value {
\tcase __STAGE_TIMING_FIELD_CASES__:
\t\treturn true
\tdefault:
\t\treturn false
\t}
}

`;
	const result = template
		.replace("__TOOL_ID_CASES__", toolIdCases)
		.replace("__EXECUTION_STATUS_CASES__", executionStatusCases)
		.replace("__STAGE_TIMING_FIELD_CASES__", stageTimingFieldCases);
	return result;
}

export function goConstSuffix(value: string): string {
	return value
		.replaceAll(".", "-")
		.replaceAll("_", "-")
		.split("-")
		.filter(Boolean)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join("");
}
