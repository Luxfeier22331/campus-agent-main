package admission

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"
)

const DefaultGroup = "default"

type Decision string

const (
	DecisionAdmittedImmediate Decision = "admitted_immediate"
	DecisionAdmittedQueued    Decision = "admitted_queued"
	DecisionQueueFull         Decision = "queue_full"
	DecisionQueueTimeout      Decision = "queue_timeout"
	DecisionGroupQueueFull    Decision = "group_queue_full"
	DecisionGroupQueueTimeout Decision = "group_queue_timeout"
	DecisionClientCanceled    Decision = "client_canceled"
	DecisionDraining          Decision = "draining"
)

type Config struct {
	MaxConcurrent int
	QueueCapacity int
	QueueTimeout  time.Duration
	Groups        map[string]GroupConfig
}

type GroupConfig struct {
	MaxConcurrent int
	QueueCapacity int
	QueueTimeout  time.Duration
}

type Status struct {
	Healthy             bool                   `json:"healthy"`
	Accepting           bool                   `json:"accepting"`
	Draining            bool                   `json:"draining"`
	MaxConcurrent       int                    `json:"max_concurrent_answers"`
	Active              int                    `json:"active_answers"`
	QueueCapacity       int                    `json:"queue_capacity"`
	Queued              int                    `json:"queued_answers"`
	QueueFullCount      int                    `json:"queue_full_count"`
	QueueTimeoutCount   int                    `json:"queue_timeout_count"`
	ClientCanceledCount int                    `json:"client_canceled_count"`
	DrainingCount       int                    `json:"draining_count"`
	SaturatedCount      int                    `json:"saturated_count"`
	Groups              map[string]GroupStatus `json:"groups,omitempty"`
}

type GroupStatus struct {
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
	group        string
	decision     Decision
	waitDuration time.Duration
	once         sync.Once
}

func (l *Lease) Release() {
	if l == nil || l.controller == nil {
		return
	}
	l.once.Do(func() {
		l.controller.release(l.group)
	})
}

func (l *Lease) Decision() Decision {
	if l == nil {
		return ""
	}
	return l.decision
}

func (l *Lease) Group() string {
	if l == nil {
		return ""
	}
	return l.group
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

	groupOrder        []string
	groups            map[string]*groupState
	nextDispatchIndex int

	queueFullCount      int
	queueTimeoutCount   int
	clientCanceledCount int
	drainingCount       int
}

type groupState struct {
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
	group      string
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
		groups:        make(map[string]*groupState),
	}
	defaultGroupConfig := GroupConfig{
		MaxConcurrent: cfg.MaxConcurrent,
		QueueCapacity: cfg.QueueCapacity,
		QueueTimeout:  cfg.QueueTimeout,
	}
	if groupCfg, ok := cfg.Groups[DefaultGroup]; ok {
		defaultGroupConfig = groupCfg
	}
	controller.ensureGroupLocked(DefaultGroup, defaultGroupConfig)
	for group, groupCfg := range cfg.Groups {
		if normalizeGroup(group) == DefaultGroup {
			continue
		}
		controller.ensureGroupLocked(group, groupCfg)
	}
	controller.sortGroupOrderLocked()
	return controller
}

func (c *Controller) Acquire(ctx context.Context) (*Lease, Decision) {
	return c.AcquireGroup(ctx, DefaultGroup)
}

func (c *Controller) AcquireGroup(ctx context.Context, group string) (*Lease, Decision) {
	group = normalizeGroup(group)
	if ctx == nil {
		ctx = context.Background()
	}
	if ctx.Err() != nil {
		c.recordClientCanceled(group)
		return nil, DecisionClientCanceled
	}

	c.mu.Lock()
	groupState := c.ensureGroupLocked(group, GroupConfig{})
	if c.draining {
		c.drainingCount++
		groupState.drainingCount++
		c.mu.Unlock()
		return nil, DecisionDraining
	}
	if c.canAdmitLocked(groupState) {
		c.active++
		groupState.active++
		c.mu.Unlock()
		return c.newLease(group, DecisionAdmittedImmediate, 0), DecisionAdmittedImmediate
	}
	if c.queuedLocked() >= c.queueCapacity {
		c.queueFullCount++
		groupState.queueFullCount++
		c.mu.Unlock()
		return nil, DecisionQueueFull
	}
	if len(groupState.queue) >= groupState.queueCapacity {
		groupState.queueFullCount++
		c.mu.Unlock()
		return nil, groupQueueFullDecision(group)
	}

	waiter := &waiter{
		group:      group,
		ready:      make(chan struct{}),
		enqueuedAt: time.Now(),
	}
	groupState.queue = append(groupState.queue, waiter)
	c.mu.Unlock()

	timer := time.NewTimer(groupState.queueTimeout)
	defer timer.Stop()

	select {
	case <-waiter.ready:
		return c.leaseFromWaiter(waiter)
	case <-timer.C:
		return c.removeWaiter(waiter, groupQueueTimeoutDecision(group))
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
	for _, group := range c.groups {
		for _, waiter := range group.queue {
			waiter.decision = DecisionDraining
			close(waiter.ready)
		}
		group.queue = nil
	}
}

func (c *Controller) Status() Status {
	c.mu.Lock()
	defer c.mu.Unlock()

	groups := make(map[string]GroupStatus, len(c.groups))
	acceptingGroup := false
	for _, name := range c.groupOrder {
		group := c.groups[name]
		accepting := !c.draining &&
			(c.active < c.maxConcurrent || c.queuedLocked() < c.queueCapacity) &&
			(group.active < group.maxConcurrent || len(group.queue) < group.queueCapacity)
		if accepting {
			acceptingGroup = true
		}
		groups[name] = GroupStatus{
			Healthy:             accepting,
			Accepting:           accepting,
			MaxConcurrent:       group.maxConcurrent,
			Active:              group.active,
			QueueCapacity:       group.queueCapacity,
			Queued:              len(group.queue),
			QueueFullCount:      group.queueFullCount,
			QueueTimeoutCount:   group.queueTimeoutCount,
			ClientCanceledCount: group.clientCanceledCount,
			DrainingCount:       group.drainingCount,
			SaturatedCount:      group.queueFullCount,
		}
	}
	accepting := !c.draining && acceptingGroup
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
		Groups:              groups,
	}
}

func (c *Controller) release(group string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	groupState := c.ensureGroupLocked(group, GroupConfig{})
	if c.active > 0 {
		c.active--
	}
	if groupState.active > 0 {
		groupState.active--
	}
	c.dispatchLocked()
}

func (c *Controller) dispatchLocked() {
	for !c.draining && c.active < c.maxConcurrent {
		dispatched := false
		if len(c.groupOrder) == 0 {
			return
		}
		if c.nextDispatchIndex >= len(c.groupOrder) {
			c.nextDispatchIndex = 0
		}
		for offset := range c.groupOrder {
			index := (c.nextDispatchIndex + offset) % len(c.groupOrder)
			name := c.groupOrder[index]
			group := c.groups[name]
			if c.active >= c.maxConcurrent {
				break
			}
			if group.active >= group.maxConcurrent || len(group.queue) == 0 {
				continue
			}
			next := group.queue[0]
			group.queue = group.queue[1:]
			c.active++
			group.active++
			next.decision = DecisionAdmittedQueued
			close(next.ready)
			c.nextDispatchIndex = (index + 1) % len(c.groupOrder)
			dispatched = true
			break
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
		return c.newLease(waiter.group, decision, time.Since(waiter.enqueuedAt)), decision
	}
	if decision == DecisionDraining {
		c.drainingCount++
		group := c.ensureGroupLocked(waiter.group, GroupConfig{})
		group.drainingCount++
	}
	return nil, decision
}

func (c *Controller) removeWaiter(waiter *waiter, decision Decision) (*Lease, Decision) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if waiter.decision == DecisionAdmittedQueued {
		return c.newLease(waiter.group, DecisionAdmittedQueued, time.Since(waiter.enqueuedAt)), DecisionAdmittedQueued
	}
	group := c.ensureGroupLocked(waiter.group, GroupConfig{})
	if waiter.decision == DecisionDraining {
		c.drainingCount++
		group.drainingCount++
		return nil, DecisionDraining
	}

	for index, item := range group.queue {
		if item == waiter {
			group.queue = append(group.queue[:index], group.queue[index+1:]...)
			break
		}
	}

	switch decision {
	case DecisionQueueTimeout:
		c.queueTimeoutCount++
		group.queueTimeoutCount++
	case DecisionGroupQueueTimeout:
		group.queueTimeoutCount++
	case DecisionClientCanceled:
		c.clientCanceledCount++
		group.clientCanceledCount++
	case DecisionDraining:
		c.drainingCount++
		group.drainingCount++
	}
	return nil, decision
}

func (c *Controller) recordClientCanceled(group string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.clientCanceledCount++
	groupState := c.ensureGroupLocked(group, GroupConfig{})
	groupState.clientCanceledCount++
}

func (c *Controller) newLease(group string, decision Decision, waitDuration time.Duration) *Lease {
	return &Lease{
		controller:   c,
		group:        group,
		decision:     decision,
		waitDuration: waitDuration,
	}
}

func (c *Controller) canAdmitLocked(group *groupState) bool {
	return !c.draining && c.active < c.maxConcurrent && group.active < group.maxConcurrent
}

func (c *Controller) queuedLocked() int {
	queued := 0
	for _, group := range c.groups {
		queued += len(group.queue)
	}
	return queued
}

func (c *Controller) ensureGroupLocked(name string, cfg GroupConfig) *groupState {
	name = normalizeGroup(name)
	group := c.groups[name]
	if group != nil {
		return group
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
	group = &groupState{
		name:          name,
		maxConcurrent: cfg.MaxConcurrent,
		queueCapacity: cfg.QueueCapacity,
		queueTimeout:  cfg.QueueTimeout,
	}
	c.groups[name] = group
	c.groupOrder = append(c.groupOrder, name)
	c.sortGroupOrderLocked()
	return group
}

func (c *Controller) sortGroupOrderLocked() {
	sort.Strings(c.groupOrder)
	if c.nextDispatchIndex >= len(c.groupOrder) {
		c.nextDispatchIndex = 0
	}
}

func normalizeGroup(group string) string {
	normalized := strings.TrimSpace(strings.ToLower(group))
	if normalized == "" {
		return DefaultGroup
	}
	return normalized
}

func groupQueueFullDecision(group string) Decision {
	if group == DefaultGroup {
		return DecisionQueueFull
	}
	return DecisionGroupQueueFull
}

func groupQueueTimeoutDecision(group string) Decision {
	if group == DefaultGroup {
		return DecisionQueueTimeout
	}
	return DecisionGroupQueueTimeout
}
