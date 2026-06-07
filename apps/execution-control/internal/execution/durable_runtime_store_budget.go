//go:build retired_pg_lease

package execution

import "context"

func (s *InMemoryDurableRuntimeStore) UpsertLaneBudget(
	_ context.Context,
	budget LaneBudget,
) error {
	if err := validateLaneBudget(budget); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.laneBudgets[budget.Lane] = budget
	return nil
}

func (s *InMemoryDurableRuntimeStore) UpsertWorkerHeartbeat(
	_ context.Context,
	heartbeat WorkerHeartbeat,
) error {
	if err := validateWorkerHeartbeat(heartbeat); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.workerHeartbeats[heartbeat.WorkerID] = cloneWorkerHeartbeat(heartbeat)
	return nil
}
