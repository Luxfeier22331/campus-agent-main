package memoryruntime

// AppendOperation is the remote retain task, not an individual HTTP attempt.
type AppendOperation struct {
	OperationID string
	Status      string
	ErrorCode   string
	ErrorDetail string
	HTTPStatus  int
}
