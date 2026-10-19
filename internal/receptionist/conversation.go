package receptionist

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type conversationResult struct {
	messages []ChatMessage
	pending  *Proposal
	reply    string
}

// runConversation contains the shared model/tool loop used by persisted public
// chat and the private owner preview. Persistence and booking confirmation stay
// with their respective callers.
func (service *Service) runConversation(ctx context.Context, business Business, slug string, messages []ChatMessage, external bool, preview *ownerPreviewScope, sink StreamSink) (conversationResult, error) {
	if service.Bookings == nil || service.Model == nil || service.DailyCallLimit <= 0 {
		return conversationResult{}, ErrUnavailable
	}
	definitions, err := service.toolDefinitionsForBusiness(ctx, business, external, preview)
	if err != nil {
		return conversationResult{}, err
	}
	system, err := service.systemPromptForBusiness(ctx, business, slug, external, preview)
	if err != nil {
		return conversationResult{}, err
	}
	var pending *Proposal
	toolCount := 0
	streamed := 0
	finished := false
	for modelCalls := 0; modelCalls < 4; modelCalls++ {
		if err := ctx.Err(); err != nil {
			return conversationResult{}, err
		}
		allowed, reserveErr := service.Repository.ReserveModelCall(ctx, business.ID, service.DailyCallLimit, service.now())
		if reserveErr != nil {
			return conversationResult{}, reserveErr
		}
		if !allowed {
			return conversationResult{}, ErrRateLimited
		}
		if sink != nil {
			sink.Activity(ActivityThinking)
		}
		response, modelErr := service.Model.ConverseStream(ctx, ModelRequest{
			System: system, Messages: messages, Tools: definitions,
		}, StreamCallbacks{OnTextDelta: func(delta string) {
			streamed += len(delta)
			if streamed > 4000 {
				return
			}
			if sink != nil {
				sink.Activity(ActivityWriting)
				sink.TextDelta(delta)
			}
		}})
		if modelErr != nil {
			return conversationResult{}, fmt.Errorf("invoke Bedrock receptionist model: %w", modelErr)
		}
		if streamed > 4000 || len(response.Text) > 4000 || len(response.ToolCalls) > 3 || toolCount+len(response.ToolCalls) > 8 {
			return conversationResult{}, fmt.Errorf("%w: this request needs too many steps or produced too much text", ErrInvalid)
		}
		assistantContent := make([]ChatContent, 0, len(response.ToolCalls)+1)
		if response.Text != "" {
			assistantContent = append(assistantContent, ChatContent{Type: "text", Text: response.Text})
		}
		for _, call := range response.ToolCalls {
			if call.ID == "" || !validToolName(call.Name) || len(call.Input) > 8_000 {
				return conversationResult{}, fmt.Errorf("%w: unsupported receptionist tool request", ErrInvalid)
			}
			assistantContent = append(assistantContent, ChatContent{Type: "tool_use", ID: call.ID, Name: call.Name, Input: call.Input})
		}
		messages = append(messages, ChatMessage{Role: "assistant", Content: assistantContent})
		if len(response.ToolCalls) == 0 {
			finished = true
			break
		}
		for _, call := range response.ToolCalls {
			toolCount++
			if sink != nil {
				sink.Activity(activityForTool(call.Name))
			}
			value, toolErr := service.callToolForBusiness(ctx, business, slug, call.Name, call.Input, external, preview)
			encoded := ""
			isError := toolErr != nil
			if toolErr != nil {
				encoded = publicToolError(toolErr)
			} else {
				raw, marshalErr := json.Marshal(value)
				if marshalErr != nil {
					return conversationResult{}, fmt.Errorf("encode receptionist tool result: %w", marshalErr)
				}
				encoded = string(raw)
				if call.Name == "prepare_booking" {
					var proposal Proposal
					if err := json.Unmarshal(raw, &proposal); err != nil {
						return conversationResult{}, fmt.Errorf("decode receptionist booking proposal: %w", err)
					}
					pending = &proposal
				}
			}
			messages = append(messages, ChatMessage{Role: "user", Content: []ChatContent{{Type: "tool_result", ToolUseID: call.ID, Text: encoded, IsError: isError}}})
		}
	}
	if !finished {
		return conversationResult{}, fmt.Errorf("%w: this request needs too many model steps", ErrInvalid)
	}
	if streamed > 4000 {
		return conversationResult{}, fmt.Errorf("%w: the response was too large", ErrInvalid)
	}
	reply := ""
	if pending != nil {
		reply = "Please review the booking details below. Your appointment will be created only when you confirm."
	} else {
		for i := len(messages) - 1; i >= 0; i-- {
			if messages[i].Role != "assistant" {
				continue
			}
			for _, block := range messages[i].Content {
				if block.Type == "text" {
					reply = strings.TrimSpace(block.Text)
				}
			}
			if reply != "" {
				break
			}
		}
	}
	if reply == "" {
		return conversationResult{}, ErrUnavailable
	}
	if len(reply) > 4000 {
		reply = reply[:4000]
	}
	return conversationResult{messages: messages, pending: pending, reply: reply}, nil
}
