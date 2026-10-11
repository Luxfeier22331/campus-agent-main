package execution

// ModelOutputDiagnostic is an optional Ops-only snapshot. It is not part of
// invocation receipts, workflow results or the immutable result payload.
type ModelOutputDiagnostic struct {
	SchemaVersion     int     `json:"schema_version"`
	Text              string  `json:"text"`
	OriginalUTF8Bytes int     `json:"original_utf8_bytes"`
	Truncated         bool    `json:"truncated"`
	ValidationStage   string  `json:"validation_stage"`
	ValidationMessage string  `json:"validation_message"`
	OutputSchema      string  `json:"output_schema"`
	FinishReason      *string `json:"finish_reason"`
}

func (d ModelOutputDiagnostic) Valid() bool {
	return d.SchemaVersion == 1 && len(d.Text) <= 64*1024 &&
		d.OriginalUTF8Bytes >= len(d.Text) && d.Truncated == (d.OriginalUTF8Bytes > len(d.Text)) &&
		(d.ValidationStage == "json_parse" || d.ValidationStage == "schema_validation") &&
		len([]rune(d.ValidationMessage)) <= 1024 && len(d.OutputSchema) <= 128 &&
		(d.FinishReason == nil || len(*d.FinishReason) <= 128)
}
