// Package mailer sends server-side transactional email through configured providers.
package mailer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"strings"
	"time"
)

const ZeptoMailURL = "https://api.zeptomail.com/v1.1/email"

type Message struct {
	To      string
	Subject string
	Text    string
}

type Sender interface {
	Send(context.Context, Message) error
}

type ZeptoMailSender struct {
	Token    string
	From     *mail.Address
	Endpoint string
	Client   *http.Client
}

func NewZeptoMailSender(token, from string) (*ZeptoMailSender, error) {
	token = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(token), "Zoho-enczapikey "))
	if token == "" || strings.ContainsAny(token, "\r\n") {
		return nil, errors.New("ZeptoMail send token is not configured")
	}
	address, err := mail.ParseAddress(strings.TrimSpace(from))
	if err != nil || address.Address == "" || strings.ContainsAny(address.Address, "\r\n") {
		return nil, errors.New("EMAIL_FROM must be a valid verified sender address")
	}
	return &ZeptoMailSender{Token: token, From: address, Endpoint: ZeptoMailURL,
		Client: &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (s *ZeptoMailSender) Send(ctx context.Context, message Message) error {
	if s == nil || s.Client == nil || s.Token == "" || s.From == nil {
		return errors.New("ZeptoMail sender is not configured")
	}
	to, err := mail.ParseAddress(message.To)
	if err != nil || to.Address == "" || strings.ContainsAny(message.Subject, "\r\n") {
		return errors.New("invalid transactional email message")
	}
	body, err := json.Marshal(map[string]any{
		"from":    map[string]string{"address": s.From.Address, "name": s.From.Name},
		"to":      []any{map[string]any{"email_address": map[string]string{"address": to.Address}}},
		"subject": message.Subject, "textbody": message.Text, "track_clicks": false, "track_opens": false,
	})
	if err != nil {
		return fmt.Errorf("encode transactional email: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.Endpoint, bytes.NewReader(body))
	if err != nil {
		return errors.New("could not create ZeptoMail request")
	}
	request.Header.Set("Authorization", "Zoho-enczapikey "+s.Token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := s.Client.Do(request)
	if err != nil {
		return errors.New("ZeptoMail could not accept this email; check the sender, token, data center, and provider status")
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return errors.New("ZeptoMail could not accept this email; check the sender, token, data center, and provider status")
	}
	return nil
}
