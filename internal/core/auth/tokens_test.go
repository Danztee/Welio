package auth

import (
	"testing"
	"time"
)

func TestTokenPurposeAndExpiry(t *testing.T) {
	tokens := NewTokens([]byte("0123456789abcdef0123456789abcdef"))
	encoded, _, err := tokens.Sign(Claims{Purpose: PurposeAccess, SessionID: "session-1"}, "user-1", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := tokens.Verify(encoded, PurposeAccess)
	if err != nil || claims.Subject != "user-1" || claims.SessionID != "session-1" {
		t.Fatalf("Verify() = %+v, %v", claims, err)
	}
	if _, err := tokens.Verify(encoded, "password_reset"); err == nil {
		t.Fatal("accepted a token for the wrong purpose")
	}
	expired, _, err := tokens.Sign(Claims{Purpose: PurposeAccess}, "user-1", time.Nanosecond)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Millisecond)
	if _, err := tokens.Verify(expired, PurposeAccess); err == nil {
		t.Fatal("accepted an expired token")
	}
}
