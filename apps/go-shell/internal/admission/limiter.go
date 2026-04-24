package admission

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"
)

const DefaultLane = "default"

type Decision string

const (
	DecisionAdmittedImmediate Decision = "admitted_immediate"
	DecisionAdmittedQueued    Decision = "admitted_queued"
	DecisionQueueFull         Decision = "queue_full"
	DecisionQueueTimeout      Decision = "queue_timeout"
	DecisionLaneQueueFull     Decision = "lane_queue_full"
	DecisionLaneQueueTimeout  Decision = "lane_queue_timeout"
	DecisionClientCanceled    Decision = "client_canceled"
	DecisionDraining          Decision = "draining"
)

type Config struct {
	MaxConcurrent int
	QueueCapacity int
	QueueTimeout  time.Duration
	Lanes         map[string]LaneConfig
}

type LaneConfig struct {
	MaxConcurrent int
	QueueCapacity int
	QueueTimeout  time.Duration
}

type Status struct {
	Healthy             bool                  `json:"healthy"`
	Accepting           bool                  `json:"accepting"`
	Draining            bool                  `json:"draining"`
	MaxConcurrent       int                   `json:"max_concurrent_answers"`
	Active              int                   `json:"active_answers"`
	QueueCapacity       int                   `json:"queue_capacity"`
	Queued              int                   `json:"queued_answers"`
	QueueFullCount      int                   `json:"queue_full_count"`
	QueueTimeoutCount   int                   `json:"queue_timeout_count"`
	ClientCanceledCount int                   `json:"client_canceled_count"`
	DrainingCount       int                   `json:"draining_count"`
	SaturatedCount      int                   `json:"saturated_count"`
	Lanes               map[string]LaneStatus `json:"lanes,omitempty"`
}

type LaneStatus struct {
	Healthy             bool `json:"healthy"`
	Accepting           bool `json:"accepting"`
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
	lane         string
	decision     Decision
	waitDuration time.Duration
	once         sync.Once
}

func (l *Lease) Release() {
	if l == nil || l.controller == nil {
		return
	}
	l.once.Do(func() {
		l.controller.release(l.lane)
	})
}

func (l *Lease) Decision() Decision {
	if l == nil {
		return ""
	}
	return l.decision
}

func (l *Lease) Lane() string {
	if l == nil {
		return ""
	}
	return l.lane
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

	laneOrder []string
	lanes     map[string]*laneState

	queueFullCount      int
	queueTimeoutCount   int
	clientCanceledCount int
	drainingCount       int
}

type laneState struct {
	name          string
	maxConcurrent int
	queueCapacity int
	queueTimeout  time.Duration
	active        int
	queue         []*waiter

	queueFullCount      int
	queueTimeoutCount   int
	clientCanceledCount int
	drainingCount       int
}

type waiter struct {
	lane       string
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

	controller := &Controller{
		maxConcurrent: cfg.MaxConcurrent,
		queueCapacity: cfg.QueueCapacity,
		queueTimeout:  cfg.QueueTimeout,
		lanes:         make(map[string]*laneState),
	}
	defaultLaneConfig := LaneConfig{
		MaxConcurrent: cfg.MaxConcurrent,
		QueueCapacity: cfg.QueueCapacity,
		QueueTimeout:  cfg.QueueTimeout,
	}
	if laneCfg, ok := cfg.Lanes[DefaultLane]; ok {
		defaultLaneConfig = laneCfg
	}
	controller.ensureLaneLocked(DefaultLane, defaultLaneConfig)
	for lane, laneCfg := range cfg.Lanes {
		if normalizeLane(lane) == DefaultLane {
			continue
		}
		controller.ensureLaneLocked(lane, laneCfg)
	}
	controller.sortLaneOrderLocked()
	return controller
}

func (c *Controller) Acquire(ctx context.Context) (*Lease, Decision) {
	return c.AcquireLane(ctx, DefaultLane)
}

func (c *Controller) AcquireLane(ctx context.Context, lane string) (*Lease, Decision) {
	lane = normalizeLane(lane)
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		c.recordClientCanceled(lane)
		return nil, DecisionClientCanceled
	}

	c.mu.Lock()
	laneState := c.ensureLaneLocked(lane, LaneConfig{})
	if c.draining {
		c.drainingCount++
		laneState.drainingCount++
		c.mu.Unlock()
		return nil, DecisionDraining
	}
	if c.canAdmitLocked(laneState) {
		c.active++
		laneState.active++
		c.mu.Unlock()
		return c.newLease(lane, DecisionAdmittedImmediate, 0), DecisionAdmittedImmediate
	}
	if c.queuedLocked() >= c.queueCapacity {
		c.queueFullCount++
		laneState.queueFullCount++
		c.mu.Unlock()
		return nil, DecisionQueueFull
	}
	if len(laneState.queue) >= laneState.queueCapacity {
		laneState.queueFullCount++
		c.mu.Unlock()
		return nil, laneQueueFullDecision(lane)
	}

	waiter := &waiter{
		lane:       lane,
		ready:      make(chan struct{}),
		enqueuedAt: time.Now(),
	}
	laneState.queue = append(laneState.queue, waiter)
	c.mu.Unlock()

	timer := time.NewTimer(laneState.queueTimeout)
	defer timer.Stop()

	select {
	case <-waiter.ready:
		return c.leaseFromWaiter(waiter)
	case <-timer.C:
		return c.removeWaiter(waiter, laneQueueTimeoutDecision(lane))
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
	for _, lane := range c.lanes {
		for _, waiter := range lane.queue {
			waiter.decision = DecisionDraining
			close(waiter.ready)
		}
		lane.queue = nil
	}
}

func (c *Controller) Status() Status {
	c.mu.Lock()
	defer c.mu.Unlock()

	lanes := make(map[string]LaneStatus, len(c.lanes))
	acceptingLane := false
	for _, name := range c.laneOrder {
		lane := c.lanes[name]
		accepting := !c.draining &&
			(c.active < c.maxConcurrent || c.queuedLocked() < c.queueCapacity) &&
			(lane.active < lane.maxConcurrent || len(lane.queue) < lane.queueCapacity)
		if accepting {
			acceptingLane = true
		}
		lanes[name] = LaneStatus{
			Healthy:             accepting,
			Accepting:           accepting,
			MaxConcurrent:       lane.maxConcurrent,
			Active:              lane.active,
			QueueCapacity:       lane.queueCapacity,
			Queued:              len(lane.queue),
			QueueFullCount:      lane.queueFullCount,
			QueueTimeoutCount:   lane.queueTimeoutCount,
			ClientCanceledCount: lane.clientCanceledCount,
			DrainingCount:       lane.drainingCount,
			SaturatedCount:      lane.queueFullCount,
		}
	}
	accepting := !c.draining && acceptingLane
	queued := c.queuedLocked()
	return Status{
		Healthy:             accepting,
		Accepting:           accepting,
		Draining:            c.draining,
		MaxConcurrent:       c.maxConcurrent,
		Active:              c.active,
		QueueCapacity:       c.queueCapacity,
		Queued:              queued,
		QueueFullCount:      c.queueFullCount,
		QueueTimeoutCount:   c.queueTimeoutCount,
		ClientCanceledCount: c.clientCanceledCount,
		DrainingCount:       c.drainingCount,
		SaturatedCount:      c.queueFullCount,
		Lanes:               lanes,
	}
}

func (c *Controller) release(lane string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	laneState := c.ensureLaneLocked(lane, LaneConfig{})
	if c.active > 0 {
		c.active--
	}
	if laneState.active > 0 {
		laneState.active--
	}
	c.dispatchLocked()
}

func (c *Controller) dispatchLocked() {
	for !c.draining && c.active < c.maxConcurrent {
		dispatched := false
		for _, name := range c.laneOrder {
			lane := c.lanes[name]
			if c.active >= c.maxConcurrent {
				break
			}
			if lane.active >= lane.maxConcurrent || len(lane.queue) == 0 {
				continue
			}
			next := lane.queue[0]
			lane.queue = lane.queue[1:]
			c.active++
			lane.active++
			next.decision = DecisionAdmittedQueued
			close(next.ready)
			dispatched = true
		}
		if !dispatched {
			return
		}
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
		return c.newLease(waiter.lane, decision, time.Since(waiter.enqueuedAt)), decision
	}
	if decision == DecisionDraining {
		c.drainingCount++
		lane := c.ensureLaneLocked(waiter.lane, LaneConfig{})
		lane.drainingCount++
	}
	return nil, decision
}

func (c *Controller) removeWaiter(waiter *waiter, decision Decision) (*Lease, Decision) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if waiter.decision == DecisionAdmittedQueued {
		return c.newLease(waiter.lane, DecisionAdmittedQueued, time.Since(waiter.enqueuedAt)), DecisionAdmittedQueued
	}
	lane := c.ensureLaneLocked(waiter.lane, LaneConfig{})
	if waiter.decision == DecisionDraining {
		c.drainingCount++
		lane.drainingCount++
		return nil, DecisionDraining
	}

	for index, item := range lane.queue {
		if item == waiter {
			lane.queue = append(lane.queue[:index], lane.queue[index+1:]...)
			break
		}
	}

	switch decision {
	case DecisionQueueTimeout:
		c.queueTimeoutCount++
		lane.queueTimeoutCount++
	case DecisionLaneQueueTimeout:
		lane.queueTimeoutCount++
	case DecisionClientCanceled:
		c.clientCanceledCount++
		lane.clientCanceledCount++
	case DecisionDraining:
		c.drainingCount++
		lane.drainingCount++
	}
	return nil, decision
}

func (c *Controller) recordClientCanceled(lane string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.clientCanceledCount++
	laneState := c.ensureLaneLocked(lane, LaneConfig{})
	laneState.clientCanceledCount++
}

func (c *Controller) newLease(lane string, decision Decision, waitDuration time.Duration) *Lease {
	return &Lease{
		controller:   c,
		lane:         lane,
		decision:     decision,
		waitDuration: waitDuration,
	}
}

func (c *Controller) canAdmitLocked(lane *laneState) bool {
	return !c.draining && c.active < c.maxConcurrent && lane.active < lane.maxConcurrent
}

func (c *Controller) queuedLocked() int {
	queued := 0
	for _, lane := range c.lanes {
		queued += len(lane.queue)
	}
	return queued
}

func (c *Controller) ensureLaneLocked(name string, cfg LaneConfig) *laneState {
	name = normalizeLane(name)
	lane := c.lanes[name]
	if lane != nil {
		return lane
	}
	emptyConfig := cfg.MaxConcurrent == 0 && cfg.QueueCapacity == 0 && cfg.QueueTimeout == 0
	if cfg.MaxConcurrent <= 0 {
		cfg.MaxConcurrent = c.maxConcurrent
	}
	if emptyConfig {
		cfg.QueueCapacity = c.queueCapacity
	} else if cfg.QueueCapacity < 0 {
		cfg.QueueCapacity = c.queueCapacity
	}
	if cfg.QueueTimeout <= 0 {
		cfg.QueueTimeout = c.queueTimeout
	}
	lane = &laneState{
		name:          name,
		maxConcurrent: cfg.MaxConcurrent,
		queueCapacity: cfg.QueueCapacity,
		queueTimeout:  cfg.QueueTimeout,
	}
	c.lanes[name] = lane
	c.laneOrder = append(c.laneOrder, name)
	c.sortLaneOrderLocked()
	return lane
}

func (c *Controller) sortLaneOrderLocked() {
	sort.Strings(c.laneOrder)
}

func normalizeLane(lane string) string {
	normalized := strings.TrimSpace(strings.ToLower(lane))
	if normalized == "" {
		return DefaultLane
	}
	return normalized
}

func laneQueueFullDecision(lane string) Decision {
	if lane == DefaultLane {
		return DecisionQueueFull
	}
	return DecisionLaneQueueFull
}

func laneQueueTimeoutDecision(lane string) Decision {
	if lane == DefaultLane {
		return DecisionQueueTimeout
	}
	return DecisionLaneQueueTimeout
}
