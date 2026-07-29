package execution

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

func (s *PostgresRunProjectionStore) WaitForRunEventsAfter(
	ctx context.Context,
	runID string,
	afterSequence int64,
) ([]DurableRunEvent, error) {
	if err := s.ensureRunEventListener(ctx); err != nil {
		return nil, err
	}
	waiter := make(chan struct{}, 1)
	s.eventMu.Lock()
	if s.closed {
		s.eventMu.Unlock()
		return nil, fmt.Errorf("run projection store is closed")
	}
	if s.eventListenerErr != nil {
		err := s.eventListenerErr
		s.eventMu.Unlock()
		return nil, err
	}
	if s.eventWaiters[runID] == nil {
		s.eventWaiters[runID] = map[chan struct{}]struct{}{}
	}
	s.eventWaiters[runID][waiter] = struct{}{}
	s.eventMu.Unlock()
	defer s.removeRunEventWaiter(runID, waiter)

	for {
		events, err := s.ListRunEventsAfter(ctx, runID, afterSequence)
		if err != nil || len(events) > 0 {
			return events, err
		}
		s.eventMu.Lock()
		listenerErr := s.eventListenerErr
		closed := s.closed
		s.eventMu.Unlock()
		if listenerErr != nil {
			return nil, listenerErr
		}
		if closed {
			return nil, fmt.Errorf("run projection store is closed")
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-waiter:
		}
	}
}

func (s *PostgresRunProjectionStore) ensureRunEventListener(ctx context.Context) error {
	s.eventMu.Lock()
	defer s.eventMu.Unlock()
	if s.closed {
		return fmt.Errorf("run projection store is closed")
	}
	if s.eventListenerErr != nil {
		return s.eventListenerErr
	}
	if s.eventListenerActive {
		return nil
	}
	connection, err := s.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire run event listener connection: %w", err)
	}
	if _, err := connection.Exec(ctx, "listen "+runEventNotificationChannel); err != nil {
		connection.Release()
		return fmt.Errorf("listen for run events: %w", err)
	}
	listenerCtx, cancel := context.WithCancel(context.Background())
	s.eventListenerActive = true
	s.eventListenerCancel = cancel
	s.eventListenerDone = make(chan struct{})
	go s.listenForRunEvents(listenerCtx, connection)
	return nil
}

func (s *PostgresRunProjectionStore) listenForRunEvents(
	ctx context.Context,
	connection *pgxpool.Conn,
) {
	defer connection.Release()
	defer func() {
		s.eventMu.Lock()
		s.eventListenerActive = false
		done := s.eventListenerDone
		s.eventMu.Unlock()
		close(done)
	}()
	for {
		notification, err := connection.Conn().WaitForNotification(ctx)
		if err != nil {
			s.eventMu.Lock()
			if s.closed {
				s.eventListenerErr = fmt.Errorf("run projection store is closed")
			} else {
				s.eventListenerErr = fmt.Errorf("listen for run events: %w", err)
			}
			s.notifyPostgresRunEventWaitersLocked("")
			s.eventMu.Unlock()
			return
		}
		s.eventMu.Lock()
		s.notifyPostgresRunEventWaitersLocked(notification.Payload)
		s.eventMu.Unlock()
	}
}

func (s *PostgresRunProjectionStore) notifyPostgresRunEventWaitersLocked(runID string) {
	if runID == "" {
		for waiterRunID := range s.eventWaiters {
			s.notifyPostgresRunEventWaitersLocked(waiterRunID)
		}
		return
	}
	for waiter := range s.eventWaiters[runID] {
		select {
		case waiter <- struct{}{}:
		default:
		}
	}
}

func (s *PostgresRunProjectionStore) removeRunEventWaiter(runID string, waiter chan struct{}) {
	s.eventMu.Lock()
	defer s.eventMu.Unlock()
	delete(s.eventWaiters[runID], waiter)
	if len(s.eventWaiters[runID]) == 0 {
		delete(s.eventWaiters, runID)
	}
}
