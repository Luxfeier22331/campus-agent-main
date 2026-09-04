package executionpersistence

import (
	"context"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"

	"github.com/jackc/pgx/v5/pgxpool"
)

func (s *PostgresRunProjectionStore) WaitForRunEventsAfter(
	ctx context.Context,
	requestID string,
	afterSequence int64,
) ([]execution.DurableRunEvent, error) {
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
	if s.eventWaiters[requestID] == nil {
		s.eventWaiters[requestID] = map[chan struct{}]struct{}{}
	}
	s.eventWaiters[requestID][waiter] = struct{}{}
	s.eventMu.Unlock()
	defer s.removeRunEventWaiter(requestID, waiter)

	for {
		events, err := s.ListRunEventsAfter(ctx, requestID, afterSequence)
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
	if s.eventListenerActive {
		if s.eventListenerErr != nil {
			return s.eventListenerErr
		}
		return nil
	}
	// A listener failure only applies to the listener generation that exited.
	// Consume it before attempting to establish the next generation so a
	// transient connection error cannot permanently poison the store.
	s.eventListenerErr = nil
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
	done := make(chan struct{})
	s.eventListenerDone = done
	go s.listenForRunEvents(listenerCtx, connection, done)
	return nil
}

func (s *PostgresRunProjectionStore) listenForRunEvents(
	ctx context.Context,
	connection *pgxpool.Conn,
	done chan struct{},
) {
	defer func() {
		connection.Release()
		s.eventMu.Lock()
		if s.eventListenerDone == done {
			s.eventListenerActive = false
			s.eventListenerCancel = nil
			s.eventListenerDone = nil
		}
		if done != nil {
			close(done)
		}
		s.eventMu.Unlock()
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

func (s *PostgresRunProjectionStore) notifyPostgresRunEventWaitersLocked(requestID string) {
	if requestID == "" {
		for waiterRunID := range s.eventWaiters {
			s.notifyPostgresRunEventWaitersLocked(waiterRunID)
		}
		return
	}
	for waiter := range s.eventWaiters[requestID] {
		select {
		case waiter <- struct{}{}:
		default:
		}
	}
}

func (s *PostgresRunProjectionStore) removeRunEventWaiter(requestID string, waiter chan struct{}) {
	s.eventMu.Lock()
	defer s.eventMu.Unlock()
	delete(s.eventWaiters[requestID], waiter)
	if len(s.eventWaiters[requestID]) == 0 {
		delete(s.eventWaiters, requestID)
	}
}
