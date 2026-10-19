package mailer

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestZeptoMailSenderBuildsExpectedRequest(t *testing.T) {
	var received *http.Request
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = r
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), `"textbody":"Verify this address"`) {
			t.Errorf("email body = %s", body)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	sender, err := NewZeptoMailSender("Zoho-enczapikey send-token", "Welio <team@example.com>")
	if err != nil {
		t.Fatal(err)
	}
	sender.Endpoint, sender.Client = server.URL, server.Client()
	if err := sender.Send(context.Background(), Message{To: "Person <person@example.com>", Subject: "Verify", Text: "Verify this address"}); err != nil {
		t.Fatal(err)
	}
	if received == nil || received.Header.Get("Authorization") != "Zoho-enczapikey send-token" {
		t.Fatalf("request = %#v", received)
	}
}

func TestZeptoMailDoesNotExposeProviderBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("private provider response"))
	}))
	defer server.Close()
	sender, err := NewZeptoMailSender("token", "team@example.com")
	if err != nil {
		t.Fatal(err)
	}
	sender.Endpoint, sender.Client = server.URL, server.Client()
	err = sender.Send(context.Background(), Message{To: "person@example.com", Subject: "Hi", Text: "Hello"})
	if err == nil || strings.Contains(err.Error(), "private provider response") {
		t.Fatalf("Send() error = %v", err)
	}
}
