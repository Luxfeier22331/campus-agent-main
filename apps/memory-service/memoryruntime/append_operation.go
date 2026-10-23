package memoryruntime

// AppendOperation is the remote retain task, not an individual HTTP attempt.
type AppendOperation struct {
	OperationID string
	Status      string
	ErrorCode   string
	ErrorDetail string
	HTTPStatus  int
}

// CommandOperation is the provider-side state of a memory_add command.
// processing and unknown are non-terminal: neither permits a second business
// write or an owner generation drain.
type CommandOperation struct {
	OperationID string
	Status      string
	ErrorCode   string
	ErrorDetail string
	HTTPStatus  int
}
