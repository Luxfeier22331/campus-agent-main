package admission

import (
	"sync"
)

type Status struct {
	Healthy        bool `json:"healthy"`
	MaxConcurrent  int  `json:"max_concurrent_answers"`
	Active         int  `json:"active_answers"`
	SaturatedCount int  `json:"saturated_count"`
}

type Limiter struct {
	slots chan struct{}

	mu             sync.Mutex
	active         int
	saturatedCount int
}

func NewLimiter(maxConcurrent int) *Limiter {
	if maxConcurrent <= 0 {
		maxConcurrent = 1
	}

	return &Limiter{
		slots: make(chan struct{}, maxConcurrent),
	}
}

func (l *Limiter) TryAcquire() (func(), bool) {
	select {
	case l.slots <- struct{}{}:
		l.mu.Lock()
		l.active++
		l.mu.Unlock()
		var once sync.Once
		return func() {
			once.Do(func() {
				<-l.slots
				l.mu.Lock()
				if l.active > 0 {
					l.active--
				}
				l.mu.Unlock()
			})
		}, true
	default:
		l.mu.Lock()
		l.saturatedCount++
		l.mu.Unlock()
		return func() {}, false
	}
}

func (l *Limiter) Status() Status {
	l.mu.Lock()
	defer l.mu.Unlock()

	maxConcurrent := cap(l.slots)
	return Status{
		Healthy:        l.active < maxConcurrent,
		MaxConcurrent:  maxConcurrent,
		Active:         l.active,
		SaturatedCount: l.saturatedCount,
	}
}
