package auth

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

const (
	argonMemory       uint32 = 64 * 1024
	argonTime         uint32 = 3
	argonThreads      uint8  = 2
	argonKeyLen       uint32 = 32
	argonSaltLen             = 16
	PasswordMinLength        = 8
	PasswordMaxLength        = 128
)

var (
	ErrPasswordTooShort = errors.New("password must be at least 8 characters")
	ErrPasswordTooLong  = errors.New("password must be 128 characters or fewer")
	ErrPasswordBreached = errors.New("choose a password that has not appeared in a known breach")
)

var rawBase64 = base64.RawStdEncoding

// This denylist is from OpenDesk's Apache-2.0 licensed auth/passwords package. Its
// upstream source and filtering notes are kept beside this file.
//
//go:embed passwords/breached.txt
var breachedPasswords []byte

var (
	breachedOnce sync.Once
	breachedSet  map[string]struct{}
)

func CheckPassword(password string) error {
	length := utf8.RuneCountInString(password)
	switch {
	case length < PasswordMinLength:
		return ErrPasswordTooShort
	case length > PasswordMaxLength:
		return ErrPasswordTooLong
	}
	breachedOnce.Do(loadBreachedPasswords)
	if _, found := breachedSet[strings.ToLower(password)]; found {
		return ErrPasswordBreached
	}
	return nil
}

func loadBreachedPasswords() {
	breachedSet = make(map[string]struct{}, 46528)
	scanner := bufio.NewScanner(bytes.NewReader(breachedPasswords))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" {
			breachedSet[line] = struct{}{}
		}
	}
}

// HashPassword returns the PHC encoding of an Argon2id password hash.
func HashPassword(password string) (string, error) {
	if err := CheckPassword(password); err != nil {
		return "", err
	}
	return hashPassword(password)
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemory, argonTime, argonThreads,
		encodePHC(salt), encodePHC(key)), nil
}

// VerifyPassword accepts only the Argon2id parameters Welio issues. This bounds attacker-
// controlled PHC values and keeps password checks at a predictable cost.
func VerifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" || parts[3] != "m=65536,t=3,p=2" {
		return false
	}
	salt, err := decodePHC(parts[4])
	if err != nil || len(salt) != argonSaltLen {
		return false
	}
	want, err := decodePHC(parts[5])
	if err != nil || len(want) != int(argonKeyLen) {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// DummyVerify spends the standard Argon2id work factor for unknown account names.
func DummyVerify(password string) {
	var salt [argonSaltLen]byte
	argon2.IDKey([]byte(password), salt[:], argonTime, argonMemory, argonThreads, argonKeyLen)
}

func encodePHC(value []byte) string { return rawBase64.EncodeToString(value) }

func decodePHC(value string) ([]byte, error) { return rawBase64.DecodeString(value) }
