package bridge

import (
	"sync"
	"time"
)

type CircuitState string

const (
	CircuitClosed   CircuitState = "closed"
	CircuitOpen     CircuitState = "open"
	CircuitHalfOpen CircuitState = "half_open"
)

type CircuitBreakerConfig struct {
	FailureThreshold int
	OpenDuration     time.Duration
	Now              func() time.Time
}

type CircuitSnapshot struct {
	State               string `json:"state"`
	ConsecutiveFailures int    `json:"consecutive_failures"`
	OpenUntil           string `json:"open_until"`
	OpenCount           uint64 `json:"open_count"`
	RejectedCount       uint64 `json:"rejected_count"`
}

type CircuitBreaker struct {
	mu sync.Mutex

	failureThreshold int
	openDuration     time.Duration
	now              func() time.Time

	state                 CircuitState
	consecutiveFailures   int
	openUntil             time.Time
	halfOpenProbeInFlight bool
	openCount             uint64
	rejectedCount         uint64
}

func NewCircuitBreaker(config CircuitBreakerConfig) *CircuitBreaker {
	failureThreshold := config.FailureThreshold
	if failureThreshold <= 0 {
		failureThreshold = 5
	}
	openDuration := config.OpenDuration
	if openDuration <= 0 {
		openDuration = 10 * time.Second
	}
	now := config.Now
	if now == nil {
		now = time.Now
	}
	return &CircuitBreaker{
		failureThreshold: failureThreshold,
		openDuration:     openDuration,
		now:              now,
		state:            CircuitClosed,
	}
}

func (b *CircuitBreaker) Allow() bool {
	if b == nil {
		return true
	}
	b.mu.Lock()
	defer b.mu.Unlock()

	now := b.now().UTC()
	if b.state == CircuitOpen {
		if now.Before(b.openUntil) {
			b.rejectedCount++
			return false
		}
		b.state = CircuitHalfOpen
		b.halfOpenProbeInFlight = false
	}
	if b.state == CircuitHalfOpen {
		if b.halfOpenProbeInFlight {
			b.rejectedCount++
			return false
		}
		b.halfOpenProbeInFlight = true
		return true
	}
	return true
}

func (b *CircuitBreaker) RecordSuccess() {
	if b == nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()

	b.state = CircuitClosed
	b.consecutiveFailures = 0
	b.openUntil = time.Time{}
	b.halfOpenProbeInFlight = false
}

func (b *CircuitBreaker) RecordFailure() {
	if b == nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.state == CircuitHalfOpen {
		b.openLocked()
		return
	}
	b.consecutiveFailures++
	if b.consecutiveFailures >= b.failureThreshold {
		b.openLocked()
	}
}

func (b *CircuitBreaker) Snapshot() CircuitSnapshot {
	if b == nil {
		return CircuitSnapshot{State: string(CircuitClosed)}
	}
	b.mu.Lock()
	defer b.mu.Unlock()

	return CircuitSnapshot{
		State:               string(b.state),
		ConsecutiveFailures: b.consecutiveFailures,
		OpenUntil:           formatCircuitTime(b.openUntil),
		OpenCount:           b.openCount,
		RejectedCount:       b.rejectedCount,
	}
}

func (b *CircuitBreaker) openLocked() {
	b.state = CircuitOpen
	b.openUntil = b.now().UTC().Add(b.openDuration)
	b.halfOpenProbeInFlight = false
	b.openCount++
}

func formatCircuitTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}
