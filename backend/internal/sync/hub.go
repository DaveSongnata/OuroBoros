package sync

import (
	"context"
	"log"
	"sync"

	"github.com/redis/go-redis/v9"
)

// Hub manages SSE clients and broadcasts version updates via Redis Pub/Sub.
type Hub struct {
	rdb     *redis.Client
	mu      sync.RWMutex
	clients map[string]map[chan int64]struct{} // tenant_id -> set of channels
}

func NewHub(rdb *redis.Client) *Hub {
	return &Hub{
		rdb:     rdb,
		clients: make(map[string]map[chan int64]struct{}),
	}
}

// Subscribe registers an SSE client for a tenant. Returns a channel that
// receives version numbers and an unsubscribe function.
func (h *Hub) Subscribe(tenantID string) (<-chan int64, func()) {
	ch := make(chan int64, 16)
	h.mu.Lock()
	if h.clients[tenantID] == nil {
		h.clients[tenantID] = make(map[chan int64]struct{})
	}
	h.clients[tenantID][ch] = struct{}{}
	h.mu.Unlock()

	unsub := func() {
		h.mu.Lock()
		delete(h.clients[tenantID], ch)
		if len(h.clients[tenantID]) == 0 {
			delete(h.clients, tenantID)
		}
		h.mu.Unlock()
		close(ch)
	}
	return ch, unsub
}

// Publish increments the tenant version in Redis and broadcasts to Pub/Sub.
// DEPRECATED: Use NextVersion + Notify to avoid the race where SSE fires before tx.Commit.
func (h *Hub) Publish(ctx context.Context, tenantID string) (int64, error) {
	newVersion, err := h.rdb.HIncrBy(ctx, "tenant:"+tenantID+":version", "v", 1).Result()
	if err != nil {
		return 0, err
	}
	h.rdb.Publish(ctx, "sync:"+tenantID, newVersion)
	return newVersion, nil
}

// NextVersion increments the tenant version in Redis and returns it.
// Call BEFORE tx.Commit() to get the version for sync_log.
func (h *Hub) NextVersion(ctx context.Context, tenantID string) (int64, error) {
	return h.rdb.HIncrBy(ctx, "tenant:"+tenantID+":version", "v", 1).Result()
}

// Notify broadcasts a version update to SSE clients via Redis Pub/Sub.
// Call AFTER tx.Commit() so data is available when clients fetch deltas.
func (h *Hub) Notify(ctx context.Context, tenantID string, version int64) {
	h.rdb.Publish(ctx, "sync:"+tenantID, version)
}

// GetVersion returns the current version for a tenant from Redis.
func (h *Hub) GetVersion(ctx context.Context, tenantID string) (int64, error) {
	v, err := h.rdb.HGet(ctx, "tenant:"+tenantID+":version", "v").Int64()
	if err == redis.Nil {
		return 0, nil
	}
	return v, err
}

// Run subscribes to all tenant sync channels via Redis Pub/Sub pattern
// and fans out version updates to connected SSE clients.
func (h *Hub) Run(ctx context.Context) {
	pubsub := h.rdb.PSubscribe(ctx, "sync:*")
	defer pubsub.Close()

	log.Println("[hub] listening for sync events on Redis Pub/Sub")

	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			// Channel name is "sync:{tenant_id}"
			tenantID := msg.Channel[len("sync:"):]
			var version int64
			// Parse version from message payload
			if n, err := parseInt64(msg.Payload); err == nil {
				version = n
			} else {
				continue
			}

			h.mu.RLock()
			clients := h.clients[tenantID]
			for ch := range clients {
				select {
				case ch <- version:
				default:
					// drop if client is too slow
				}
			}
			h.mu.RUnlock()
		}
	}
}

func parseInt64(s string) (int64, error) {
	var n int64
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, &parseError{s}
		}
		n = n*10 + int64(c-'0')
	}
	return n, nil
}

type parseError struct{ s string }

func (e *parseError) Error() string { return "invalid int: " + e.s }
