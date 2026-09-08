package executionpersistence

import (
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Receipt stores share lifecycle transactions with runs while owning all receipt reads and writes.
type InMemoryReceiptStore struct {
	data    *InMemoryRunProjectionStore
	records map[string]execution.AgentInvocationReceipt
}
type PostgresReceiptStore struct{ pool *pgxpool.Pool }

func (s *InMemoryReceiptStore) deleteRunLocked(requestID string) {
	for id, receipt := range s.records {
		if receipt.RequestID == requestID {
			delete(s.records, id)
		}
	}
}
