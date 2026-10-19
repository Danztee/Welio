package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const (
	PurposeAccess = "access"
	AccessTTL     = 15 * time.Minute
	RefreshTTL    = 30 * 24 * time.Hour
	SessionMaxAge = 90 * 24 * time.Hour
)

type Claims struct {
	Purpose   string `json:"purpose"`
	SessionID string `json:"sid,omitempty"`
	jwt.RegisteredClaims
}

type Tokens struct{ secret []byte }

func NewTokens(secret []byte) *Tokens { return &Tokens{secret: append([]byte(nil), secret...)} }

func (t *Tokens) Sign(claims Claims, subject string, ttl time.Duration) (string, time.Time, error) {
	if len(t.secret) < 32 {
		return "", time.Time{}, errors.New("token secret is not configured")
	}
	if claims.Purpose == "" || subject == "" || ttl <= 0 {
		return "", time.Time{}, errors.New("token purpose, subject, and positive lifetime are required")
	}
	now := time.Now().UTC()
	expires := now.Add(ttl)
	claims.Subject = subject
	claims.Issuer = "welio"
	claims.IssuedAt = jwt.NewNumericDate(now)
	claims.ExpiresAt = jwt.NewNumericDate(expires)
	if claims.ID == "" {
		claims.ID = uuid.NewString()
	}
	encoded, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(t.secret)
	if err != nil {
		return "", time.Time{}, err
	}
	return encoded, expires, nil
}

func (t *Tokens) Verify(encoded, purpose string) (*Claims, error) {
	if len(t.secret) < 32 || purpose == "" {
		return nil, errors.New("token verification is not configured")
	}
	var claims Claims
	_, err := jwt.ParseWithClaims(encoded, &claims,
		func(token *jwt.Token) (any, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, errors.New("unexpected signing method")
			}
			return t.secret, nil
		}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil {
		return nil, err
	}
	if claims.Issuer != "welio" || claims.Purpose != purpose || claims.Subject == "" {
		return nil, errors.New("token purpose or issuer mismatch")
	}
	return &claims, nil
}
