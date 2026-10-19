package auth

import (
	"strings"
	"testing"
)

func TestPasswordHashRoundTripAndPolicy(t *testing.T) {
	const password = "Welio-Example-Password-2026"
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword(password, hash) || VerifyPassword(password+"!", hash) {
		t.Fatal("Argon2id verification did not distinguish the password")
	}
	if _, err := HashPassword("password123456"); err != ErrPasswordBreached {
		t.Fatalf("breached password error = %v", err)
	}
	if _, err := HashPassword("short"); err != ErrPasswordTooShort {
		t.Fatalf("short password error = %v", err)
	}
	if VerifyPassword(password, strings.Replace(hash, "m=65536", "m=999999999", 1)) {
		t.Fatal("accepted a PHC hash with unsafe parameters")
	}
}
