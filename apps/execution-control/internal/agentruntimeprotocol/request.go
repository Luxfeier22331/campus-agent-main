package agentruntimeprotocol

// Request is the Runtime JSON envelope. Its canonical map encoding preserves
// the existing invocation fingerprint independently of Go struct field order.
type Request map[string]any
