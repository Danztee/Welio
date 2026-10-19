package httpx

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type requestMetaKey struct{}

type RequestMeta struct {
	Origin        string
	IP            string
	UserAgent     string
	AccessCookie  string
	RefreshCookie string
}

func RequestMetaMiddleware(next http.Handler) http.Handler {
	return RequestMetaMiddlewareWithClientIP(ClientIP(false))(next)
}

func RequestMetaMiddlewareWithClientIP(clientIP func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := ""
			if clientIP != nil {
				ip = clientIP(r)
			}
			meta := RequestMeta{Origin: r.Header.Get("Origin"), IP: ip, UserAgent: truncate(r.UserAgent(), 400)}
			if cookie, err := r.Cookie("welio_access"); err == nil {
				meta.AccessCookie = cookie.Value
			}
			if cookie, err := r.Cookie("welio_refresh"); err == nil {
				meta.RefreshCookie = cookie.Value
			}
			ctx := context.WithValue(r.Context(), requestMetaKey{}, meta)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ClientIP trusts proxy-provided addresses only when the process is explicitly
// configured to run behind a network-restricted, trusted proxy.
func ClientIP(trustProxy bool) func(*http.Request) string {
	return func(r *http.Request) string {
		if trustProxy {
			if ip := net.ParseIP(strings.TrimSpace(r.Header.Get("CF-Connecting-IP"))); ip != nil {
				return ip.String()
			}
			if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
				first, _, _ := strings.Cut(forwarded, ",")
				if ip := net.ParseIP(strings.TrimSpace(first)); ip != nil {
					return ip.String()
				}
			}
		}
		ip := strings.TrimSpace(r.RemoteAddr)
		if host, _, err := net.SplitHostPort(ip); err == nil {
			ip = host
		}
		if parsed := net.ParseIP(ip); parsed != nil {
			return parsed.String()
		}
		return "unknown"
	}
}

func RequestMetaFrom(ctx context.Context) RequestMeta {
	meta, _ := ctx.Value(requestMetaKey{}).(RequestMeta)
	return meta
}

func truncate(value string, length int) string {
	if len(value) > length {
		return value[:length]
	}
	return value
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *statusWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

type flushableStatusWriter struct {
	*statusWriter
	flusher http.Flusher
}

func (w *flushableStatusWriter) Flush() {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	w.flusher.Flush()
}

func observeResponseWriter(w http.ResponseWriter) (*statusWriter, http.ResponseWriter) {
	observed := &statusWriter{ResponseWriter: w}
	if flusher, ok := w.(http.Flusher); ok {
		return observed, &flushableStatusWriter{statusWriter: observed, flusher: flusher}
	}
	return observed, observed
}

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSpace(r.Header.Get("X-Request-Id"))
		if id == "" || len(id) > 128 || strings.ContainsAny(id, "\r\n") {
			id = uuid.NewString()
		}
		w.Header().Set("X-Request-Id", id)
		ctx := context.WithValue(r.Context(), requestIDKey{}, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func Logger(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			started := time.Now()
			observed, wrapped := observeResponseWriter(w)
			next.ServeHTTP(wrapped, r)
			status := observed.status
			if status == 0 {
				status = http.StatusOK
			}
			log.Info("http request", "request_id", RequestIDFrom(r.Context()), "method", r.Method,
				"path", r.URL.Path, "status", status, "duration_ms", time.Since(started).Milliseconds())
		})
	}
}

func Recover(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			observed, wrapped := observeResponseWriter(w)
			defer func() {
				if recovered := recover(); recovered != nil {
					log.Error("recovered HTTP panic", "request_id", RequestIDFrom(r.Context()), "panic", recovered)
					if observed.status == 0 {
						WriteProblem(wrapped, r, E(http.StatusInternalServerError, "internal", internalMessage))
					}
				}
			}()
			next.ServeHTTP(wrapped, r)
		})
	}
}

func SecurityHeaders(secure bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
			w.Header().Set("Cache-Control", "no-store")
			if secure {
				w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			next.ServeHTTP(w, r)
		})
	}
}

func CORS(origins []string) func(http.Handler) http.Handler {
	return CORSExceptPathPrefix(origins, "")
}

// CORSExceptPathPrefix leaves a route family to its own CORS policy. This is
// useful for public protocols with a distinct origin allow-list, such as MCP.
func CORSExceptPathPrefix(origins []string, bypassPrefix string) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		allowed[origin] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if bypassPrefix != "" && strings.HasPrefix(r.URL.Path, bypassPrefix) {
				next.ServeHTTP(w, r)
				return
			}
			origin := strings.TrimSuffix(r.Header.Get("Origin"), "/")
			if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions &&
				r.Header.Get("Authorization") == "" && (hasCookie(r, "welio_access") || hasCookie(r, "welio_refresh")) {
				if origin == "" || strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "cross-site") {
					WriteProblem(w, r, E(http.StatusForbidden, "origin_required", "This browser request could not be verified."))
					return
				}
			}
			if origin != "" {
				if _, ok := allowed[origin]; !ok {
					WriteProblem(w, r, E(http.StatusForbidden, "origin_not_allowed", "This request origin is not allowed."))
					return
				}
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Add("Vary", "Origin")
			}
			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Request-Id, X-Welio-Workspace")
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func hasCookie(r *http.Request, name string) bool {
	_, err := r.Cookie(name)
	return err == nil
}

func MaxBodyBytes(limit int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, limit)
			next.ServeHTTP(w, r)
		})
	}
}

type rateWindow struct {
	count int
	start time.Time
}

type Limiter struct {
	shared  func(string, int, time.Duration) bool
	mu      sync.Mutex
	entries map[string]rateWindow
	now     func() time.Time
}

func NewLimiter() *Limiter {
	return &Limiter{entries: make(map[string]rateWindow), now: time.Now}
}

func (l *Limiter) Allow(key string, limit int, window time.Duration) bool {
	if limit <= 0 || window <= 0 {
		return false
	}
	if l.shared != nil {
		return l.shared(key, limit, window)
	}
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	entry, exists := l.entries[key]
	if !exists || now.Sub(entry.start) >= window || now.Before(entry.start) {
		if len(l.entries) >= 50000 {
			for k, v := range l.entries {
				if now.Sub(v.start) >= window {
					delete(l.entries, k)
				}
			}
			if len(l.entries) >= 50000 {
				return false
			}
		}
		l.entries[key] = rateWindow{count: 1, start: now}
		return true
	}
	if entry.count >= limit {
		return false
	}
	entry.count++
	l.entries[key] = entry
	return true
}
