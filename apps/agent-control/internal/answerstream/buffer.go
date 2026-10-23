// Package answerstream owns temporary answer delivery, independently of durable run events.
package answerstream

import (
	"context"
	"errors"
	"sync"
	"time"
)

// Delta.Index is assigned by the producer and never advances the durable event cursor.
type Delta struct {
	RequestID  string    `json:"request_id"`
	MessageID  string    `json:"message_id"`
	Index      int       `json:"index"`
	Text       string    `json:"delta"`
	OccurredAt time.Time `json:"occurred_at"`
}

var ErrUnavailable = errors.New("temporary answer transport unavailable")

type Publisher interface {
	PublishAnswerDelta(context.Context, Delta) error
}
type Reader interface {
	ReadAnswerDeltas(context.Context, string, int) ([]Delta, error)
	WaitForAnswerDeltas(context.Context, string, int) ([]Delta, error)
}

const (
	MaxChunkRunes = 512
	maxItems      = 100
	maxBytes      = 50 * 1024
	maxRuns       = 1024
	retention     = 5 * time.Minute
)

type entry struct {
	deltas  []Delta
	bytes   int
	updated time.Time
}
type Buffer struct {
	mu      sync.Mutex
	runs    map[string]*entry
	waiters map[string]map[chan struct{}]struct{}
	now     func() time.Time
}

func New() *Buffer {
	return &Buffer{runs: map[string]*entry{}, waiters: map[string]map[chan struct{}]struct{}{}, now: time.Now}
}

func (b *Buffer) PublishAnswerDelta(_ context.Context, delta Delta) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := b.now()
	b.expire(now)
	e := b.runs[delta.RequestID]
	if e == nil {
		if len(b.runs) >= maxRuns {
			var oldest string
			for id, item := range b.runs {
				if oldest == "" || item.updated.Before(b.runs[oldest].updated) {
					oldest = id
				}
			}
			delete(b.runs, oldest)
		}
		e = &entry{}
		b.runs[delta.RequestID] = e
	}
	// Notifications and retried sends may repeat a producer index.
	if len(e.deltas) > 0 && delta.Index <= e.deltas[len(e.deltas)-1].Index {
		return nil
	}
	e.deltas = append(e.deltas, delta)
	e.bytes += len(delta.Text)
	e.updated = now
	for len(e.deltas) > 0 && (len(e.deltas) > maxItems || e.bytes > maxBytes) {
		e.bytes -= len(e.deltas[0].Text)
		e.deltas[0] = Delta{}
		e.deltas = e.deltas[1:]
	}
	for ch := range b.waiters[delta.RequestID] {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
	return nil
}
func (b *Buffer) expire(now time.Time) {
	for id, e := range b.runs {
		if now.Sub(e.updated) >= retention {
			delete(b.runs, id)
		}
	}
}
func (b *Buffer) read(id string, after int) []Delta {
	out := []Delta{}
	if e := b.runs[id]; e != nil {
		for _, d := range e.deltas {
			if d.Index > after {
				out = append(out, d)
			}
		}
	}
	return out
}
func (b *Buffer) ReadAnswerDeltas(_ context.Context, id string, after int) ([]Delta, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.expire(b.now())
	return b.read(id, after), nil
}
func (b *Buffer) WaitForAnswerDeltas(ctx context.Context, id string, after int) ([]Delta, error) {
	ch := make(chan struct{}, 1)
	b.mu.Lock()
	if b.waiters[id] == nil {
		b.waiters[id] = map[chan struct{}]struct{}{}
	}
	b.waiters[id][ch] = struct{}{}
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		delete(b.waiters[id], ch)
		if len(b.waiters[id]) == 0 {
			delete(b.waiters, id)
		}
		b.mu.Unlock()
	}()
	for {
		deltas, _ := b.ReadAnswerDeltas(ctx, id, after)
		if len(deltas) > 0 {
			return deltas, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ch:
		}
	}
}
