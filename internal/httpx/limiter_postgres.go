package httpx

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPostgresLimiter shares fixed-window quotas across processes and restarts.
// Keys are hashed so email addresses and IPs are not stored in the quota table.
func NewPostgresLimiter(pool *pgxpool.Pool, log *slog.Logger) *Limiter {
	limiter := NewLimiter()
	limiter.shared = func(key string, limit int, window time.Duration) bool {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		var count int
		err := pool.QueryRow(ctx, `INSERT INTO rate_limits (key, count, expires_at)
    VALUES ($1, 1, now() + $2 * interval '1 millisecond')
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.expires_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
      expires_at = CASE WHEN rate_limits.expires_at <= now() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END
    WHERE rate_limits.expires_at <= now() OR rate_limits.count < $3
    RETURNING count`, limitKey(key), window.Milliseconds(), limit).Scan(&count)
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				log.Error("rate limit storage unavailable", "err", err)
			}
			return false
		}
		return true
	}
	return limiter
}

func limitKey(key string) string {
	digest := sha256.Sum256([]byte(key))
	return hex.EncodeToString(digest[:])
}
