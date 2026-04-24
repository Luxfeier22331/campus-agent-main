package admission

import (
	"context"
	"sync"
	"time"
)

type Decision string

const (
	DecisionAdmittedImmediate Decision = "admitted_immediate"
	DecisionAdmittedQueued    Decision = "admitted_queued"
	DecisionQueueFull         Decision = "queue_full"
	DecisionQueueTimeout      Decision = "queue_timeout"
	DecisionClientCanceled    Decision = "client_canceled"
	DecisionDraining          Decision = "draining"
)

type Config struct {
	MaxConcurrent int
	QueueCapacity int
	QueueTimeout  time.Duration
}

type Status struct {
	Healthy             bool `json:"healthy"`
	Accepting           bool `json:"accepting"`
	Draining            bool `json:"draining"`
	MaxConcurrent       int  `json:"max_concurrent_answers"`
	Active              int  `json:"active_answers"`
	QueueCapacity       int  `json:"queue_capacity"`
	Queued              int  `json:"queued_answers"`
	QueueFullCount      int  `json:"queue_full_count"`
	QueueTimeoutCount   int  `json:"queue_timeout_count"`
	ClientCanceledCount int  `json:"client_canceled_count"`
	DrainingCount       int  `json:"draining_count"`
	SaturatedCount      int  `json:"saturated_count"`
}

type Lease struct {
	controller   *Controller
	decision     Decision
	waitDuration time.Duration
	once         sync.Once
}

func (l *Lease) Release() {
	if l == nil || l.controller == nil {
		return
	}
	l.once.Do(l.controller.release)
}

func (l *Lease) Decision() Decision {
	if l == nil {
		return ""
	}
	return l.decision
}

func (l *Lease) WaitDuration() time.Duration {
	if l == nil {
		return 0
	}
	return l.waitDuration
}

type Controller struct {
	mu sync.Mutex

	maxConcurrent int
	queueCapacity int
	queueTimeout  time.Duration
	active        int
	draining      bool
	queue         []*waiter

	queueFullCount      int
	queueTimeoutCount   int
	clientCanceledCount int
	drainingCount       int
}

type waiter struct {
	ready      chan struct{}
	enqueuedAt time.Time
	decision   Decision
}

func NewController(cfg Config) *Controller {
	if cfg.MaxConcurrent <= 0 {
		cfg.MaxConcurrent = 1
	}
	if cfg.QueueCapacity < 0 {
		cfg.QueueCapacity = 0
	}
	if cfg.QueueTimeout <= 0 {
		cfg.QueueTimeout = time.Second
	}

	return &Controller{
		maxConcurrent: cfg.MaxConcurrent,
		queueCapacity: cfg.QueueCapacity,
		queueTimeout:  cfg.QueueTimeout,
	}
}

func (c *Controller) Acquire(ctx context.Context) (*Lease, Decision) {
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		c.recordClientCanceled()
		return nil, DecisionClientCanceled
	}

	c.mu.Lock()
	if c.draining {
		c.drainingCount++
		c.mu.Unlock()
		return nil, DecisionDraining
	}
	if c.active < c.maxConcurrent {
		c.active++
		c.mu.Unlock()
		return c.newLease(DecisionAdmittedImmediate, 0), DecisionAdmittedImmediate
	}
	if len(c.queue) >= c.queueCapacity {
		c.queueFullCount++
		c.mu.Unlock()
		return nil, DecisionQueueFull
	}

	waiter := &waiter{
		ready:      make(chan struct{}),
		enqueuedAt: time.Now(),
	}
	c.queue = append(c.queue, waiter)
	c.mu.Unlock()

	timer := time.NewTimer(c.queueTimeout)
	defer timer.Stop()

	select {
	case <-waiter.ready:
		return c.leaseFromWaiter(waiter)
	case <-timer.C:
		return c.removeWaiter(waiter, DecisionQueueTimeout)
	case <-ctx.Done():
		return c.removeWaiter(waiter, DecisionClientCanceled)
	}
}

func (c *Controller) StartDraining() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.draining {
		return
	}
	c.draining = true
	for _, waiter := range c.queue {
		waiter.decision = DecisionDraining
		close(waiter.ready)
	}
	c.queue = nil
}

func (c *Controller) Status() Status {
	c.mu.Lock()
	defer c.mu.Unlock()

	accepting := !c.draining && (c.active < c.maxConcurrent || len(c.queue) < c.queueCapacity)
	return Status{
		Healthy:             accepting,
		Accepting:           accepting,
		Draining:            c.draining,
		MaxConcurrent:       c.maxConcurrent,
		Active:              c.active,
		QueueCapacity:       c.queueCapacity,
		Queued:              len(c.queue),
		QueueFullCount:      c.queueFullCount,
		QueueTimeoutCount:   c.queueTimeoutCount,
		ClientCanceledCount: c.clientCanceledCount,
		DrainingCount:       c.drainingCount,
		SaturatedCount:      c.queueFullCount,
	}
}

func (c *Controller) release() {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.active > 0 {
		c.active--
	}
	c.dispatchLocked()
}

func (c *Controller) dispatchLocked() {
	for !c.draining && c.active < c.maxConcurrent && len(c.queue) > 0 {
		next := c.queue[0]
		c.queue = c.queue[1:]
		c.active++
		next.decision = DecisionAdmittedQueued
		close(next.ready)
	}
}

func (c *Controller) leaseFromWaiter(waiter *waiter) (*Lease, Decision) {
	c.mu.Lock()
	defer c.mu.Unlock()

	decision := waiter.decision
	if decision == "" {
		decision = DecisionClientCanceled
	}
	if decision == DecisionAdmittedQueued {
		return c.newLease(decision, time.Since(waiter.enqueuedAt)), decision
	}
	if decision == DecisionDraining {
		c.drainingCount++
	}
	return nil, decision
}

func (c *Controller) removeWaiter(waiter *waiter, decision Decision) (*Lease, Decision) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if waiter.decision == DecisionAdmittedQueued {
		return c.newLease(DecisionAdmittedQueued, time.Since(waiter.enqueuedAt)), DecisionAdmittedQueued
	}
	if waiter.decision == DecisionDraining {
		c.drainingCount++
		return nil, DecisionDraining
	}

	for index, item := range c.queue {
		if item == waiter {
			c.queue = append(c.queue[:index], c.queue[index+1:]...)
			break
		}
	}

	switch decision {
	case DecisionQueueTimeout:
		c.queueTimeoutCount++
	case DecisionClientCanceled:
		c.clientCanceledCount++
	case DecisionDraining:
		c.drainingCount++
	}
	return nil, decision
}

func (c *Controller) recordClientCanceled() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.clientCanceledCount++
}

func (c *Controller) newLease(decision Decision, waitDuration time.Duration) *Lease {
	return &Lease{
		controller:   c,
		decision:     decision,
		waitDuration: waitDuration,
	}
}
