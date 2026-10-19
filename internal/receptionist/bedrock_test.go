package receptionist

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
)

type fakeConverseStreamer struct {
	input  *bedrockruntime.ConverseStreamInput
	stream bedrockEventStream
	err    error
	calls  int
}

func (streamer *fakeConverseStreamer) ConverseStream(_ context.Context, input *bedrockruntime.ConverseStreamInput) (bedrockEventStream, error) {
	streamer.calls++
	streamer.input = input
	return streamer.stream, streamer.err
}

type fakeBedrockEventStream struct {
	events     chan types.ConverseStreamOutput
	err        error
	closeErr   error
	closed     bool
	closeCalls int
}

func (stream *fakeBedrockEventStream) Events() <-chan types.ConverseStreamOutput {
	return stream.events
}
func (stream *fakeBedrockEventStream) Close() error {
	stream.closed = true
	stream.closeCalls++
	return stream.closeErr
}
func (stream *fakeBedrockEventStream) Err() error { return stream.err }

func TestAWSBedrockRuntime_ConverseStream(t *testing.T) {
	stream := &fakeBedrockEventStream{events: make(chan types.ConverseStreamOutput, 5)}
	index0, index1 := int32(0), int32(1)
	toolInputFirst, toolInputSecond := `{"serviceId":"svc-1",`, `"date":"2026-10-20"}`
	stream.events <- &types.ConverseStreamOutputMemberContentBlockStart{Value: types.ContentBlockStartEvent{
		ContentBlockIndex: &index1,
		Start: &types.ContentBlockStartMemberToolUse{Value: types.ToolUseBlockStart{
			Name: stringPtr("check_availability"), ToolUseId: stringPtr("tool-call-1"), Type: types.ToolUseType("tool_use"),
		}},
	}}
	stream.events <- &types.ConverseStreamOutputMemberContentBlockDelta{Value: types.ContentBlockDeltaEvent{
		ContentBlockIndex: &index0, Delta: &types.ContentBlockDeltaMemberText{Value: "I found "},
	}}
	stream.events <- &types.ConverseStreamOutputMemberContentBlockDelta{Value: types.ContentBlockDeltaEvent{
		ContentBlockIndex: &index1, Delta: &types.ContentBlockDeltaMemberToolUse{Value: types.ToolUseBlockDelta{Input: &toolInputFirst}},
	}}
	stream.events <- &types.ConverseStreamOutputMemberContentBlockDelta{Value: types.ContentBlockDeltaEvent{
		ContentBlockIndex: &index1, Delta: &types.ContentBlockDeltaMemberToolUse{Value: types.ToolUseBlockDelta{Input: &toolInputSecond}},
	}}
	stream.events <- &types.ConverseStreamOutputMemberContentBlockDelta{Value: types.ContentBlockDeltaEvent{
		ContentBlockIndex: &index0, Delta: &types.ContentBlockDeltaMemberText{Value: "a time."},
	}}
	close(stream.events)
	streamer := &fakeConverseStreamer{stream: stream}
	runtime := &AWSBedrockRuntime{streamer: streamer}
	request := ModelRequest{
		ModelID: "eu.anthropic.claude-sonnet-4-6", MaxTokens: 2048, System: "Be helpful.",
		Messages: []ChatMessage{
			{Role: "user", Content: []ChatContent{{Type: "text", Text: "When can I book?"}}},
			{Role: "assistant", Content: []ChatContent{
				{Type: "text", Text: "Let me check."},
				{Type: "tool_use", ID: "previous-call", Name: "list_services", Input: json.RawMessage(`{"limit":1}`)},
			}},
			{Role: "user", Content: []ChatContent{{Type: "tool_result", ToolUseID: "previous-call", Text: "{}", IsError: true}}},
		},
		Tools: []ToolDefinition{{Name: "check_availability", Description: "Find open times.", InputSchema: json.RawMessage(`{"type":"object","properties":{"serviceId":{"type":"string"}},"required":["serviceId"]}`)}},
	}
	var streamed strings.Builder
	response, err := runtime.ConverseStream(context.Background(), request, StreamCallbacks{OnTextDelta: func(delta string) { streamed.WriteString(delta) }})
	if err != nil {
		t.Fatalf("ConverseStream() error = %v", err)
	}
	if !stream.closed || stream.closeCalls != 1 {
		t.Fatalf("response stream close state = closed:%t calls:%d, want closed once", stream.closed, stream.closeCalls)
	}
	if streamer.calls != 1 {
		t.Fatalf("ConverseStream called %d times, want 1", streamer.calls)
	}
	if got := *streamer.input.ModelId; got != request.ModelID {
		t.Errorf("ModelId = %q, want %q", got, request.ModelID)
	}
	if got := *streamer.input.InferenceConfig.MaxTokens; got != 2048 {
		t.Errorf("MaxTokens = %d, want 2048", got)
	}
	if len(streamer.input.System) != 1 {
		t.Fatalf("system block count = %d, want 1", len(streamer.input.System))
	}
	if got := streamer.input.System[0].(*types.SystemContentBlockMemberText).Value; got != request.System {
		t.Errorf("system prompt = %q, want %q", got, request.System)
	}
	if len(streamer.input.Messages) != 3 || streamer.input.Messages[1].Role != types.ConversationRoleAssistant {
		t.Fatalf("converted messages = %#v", streamer.input.Messages)
	}
	toolUse, ok := streamer.input.Messages[1].Content[1].(*types.ContentBlockMemberToolUse)
	if !ok {
		t.Fatalf("assistant tool block type = %T", streamer.input.Messages[1].Content[1])
	}
	previousInputBytes, err := toolUse.Value.Input.MarshalSmithyDocument()
	if err != nil {
		t.Fatalf("marshal previous tool input: %v", err)
	}
	var previousInput map[string]any
	if err := json.Unmarshal(previousInputBytes, &previousInput); err != nil {
		t.Fatalf("decode previous tool input: %v", err)
	}
	if previousInput["limit"] != float64(1) {
		t.Errorf("previous tool input = %#v", previousInput)
	}
	toolResult, ok := streamer.input.Messages[2].Content[0].(*types.ContentBlockMemberToolResult)
	if !ok || toolResult.Value.Status != types.ToolResultStatusError {
		t.Fatalf("tool result status = %#v, want error", streamer.input.Messages[2].Content[0])
	}
	if streamer.input.ToolConfig == nil || len(streamer.input.ToolConfig.Tools) != 1 {
		t.Fatalf("tool configuration = %#v", streamer.input.ToolConfig)
	}
	specification := streamer.input.ToolConfig.Tools[0].(*types.ToolMemberToolSpec).Value
	if got := *specification.Name; got != "check_availability" {
		t.Errorf("tool name = %q", got)
	}
	schemaBytes, err := specification.InputSchema.(*types.ToolInputSchemaMemberJson).Value.MarshalSmithyDocument()
	if err != nil {
		t.Fatalf("marshal tool schema: %v", err)
	}
	var schema map[string]any
	if err := json.Unmarshal(schemaBytes, &schema); err != nil {
		t.Fatalf("decode tool schema: %v", err)
	}
	if schema["type"] != "object" {
		t.Errorf("tool schema = %#v", schema)
	}
	if streamed.String() != "I found a time." || response.Text != streamed.String() {
		t.Errorf("streamed=%q response=%q", streamed.String(), response.Text)
	}
	if len(response.ToolCalls) != 1 {
		t.Fatalf("tool call count = %d, want 1", len(response.ToolCalls))
	}
	call := response.ToolCalls[0]
	if call.ID != "tool-call-1" || call.Name != "check_availability" {
		t.Errorf("tool call = %#v", call)
	}
	var gotInput map[string]string
	if err := json.Unmarshal(call.Input, &gotInput); err != nil {
		t.Fatalf("decode tool call input: %v", err)
	}
	if gotInput["serviceId"] != "svc-1" || gotInput["date"] != "2026-10-20" || len(gotInput) != 2 {
		t.Errorf("tool call input = %#v", gotInput)
	}
}

func TestAWSBedrockRuntime_RejectsInvalidRequestsBeforeCallingProvider(t *testing.T) {
	tests := []struct {
		name    string
		request ModelRequest
	}{
		{name: "missing model", request: ModelRequest{Messages: []ChatMessage{{Role: "user", Content: []ChatContent{{Type: "text", Text: "hello"}}}}}},
		{name: "unsupported role", request: ModelRequest{ModelID: "model", Messages: []ChatMessage{{Role: "system", Content: []ChatContent{{Type: "text", Text: "hello"}}}}}},
		{name: "malformed tool schema", request: ModelRequest{ModelID: "model", Tools: []ToolDefinition{{Name: "tool", InputSchema: json.RawMessage(`{`)}}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			streamer := &fakeConverseStreamer{}
			runtime := &AWSBedrockRuntime{streamer: streamer}
			if _, err := runtime.ConverseStream(context.Background(), test.request, StreamCallbacks{}); err == nil {
				t.Fatal("ConverseStream() error = nil, want validation error")
			}
			if streamer.calls != 0 {
				t.Fatalf("provider call count = %d, want 0", streamer.calls)
			}
		})
	}
}

func TestAWSBedrockRuntime_ReportsStreamErrorsAndClosesStream(t *testing.T) {
	providerErr := errors.New("stream disconnected")
	stream := &fakeBedrockEventStream{events: make(chan types.ConverseStreamOutput), err: providerErr}
	close(stream.events)
	runtime := &AWSBedrockRuntime{streamer: &fakeConverseStreamer{stream: stream}}
	_, err := runtime.ConverseStream(context.Background(), ModelRequest{ModelID: "model"}, StreamCallbacks{})
	if !errors.Is(err, providerErr) {
		t.Fatalf("ConverseStream() error = %v, want wrapped provider error", err)
	}
	if !stream.closed || stream.closeCalls != 1 {
		t.Fatalf("response stream close state after failure = closed:%t calls:%d, want closed once", stream.closed, stream.closeCalls)
	}
}

func TestAWSBedrockRuntime_ReportsCloseErrorsAndDoesNotCloseTwice(t *testing.T) {
	closeErr := errors.New("close failed")
	stream := &fakeBedrockEventStream{events: make(chan types.ConverseStreamOutput), closeErr: closeErr}
	close(stream.events)
	runtime := &AWSBedrockRuntime{streamer: &fakeConverseStreamer{stream: stream}}
	_, err := runtime.ConverseStream(context.Background(), ModelRequest{ModelID: "model"}, StreamCallbacks{})
	if !errors.Is(err, closeErr) {
		t.Fatalf("ConverseStream() error = %v, want wrapped close error", err)
	}
	if stream.closeCalls != 1 {
		t.Fatalf("response stream close calls = %d, want 1", stream.closeCalls)
	}
}

func TestAWSBedrockRuntime_RejectsMalformedToolInput(t *testing.T) {
	stream := &fakeBedrockEventStream{events: make(chan types.ConverseStreamOutput, 2)}
	index := int32(0)
	malformed := `{"serviceId":`
	stream.events <- &types.ConverseStreamOutputMemberContentBlockStart{Value: types.ContentBlockStartEvent{
		ContentBlockIndex: &index,
		Start:             &types.ContentBlockStartMemberToolUse{Value: types.ToolUseBlockStart{Name: stringPtr("prepare_booking"), ToolUseId: stringPtr("call-1")}},
	}}
	stream.events <- &types.ConverseStreamOutputMemberContentBlockDelta{Value: types.ContentBlockDeltaEvent{
		ContentBlockIndex: &index, Delta: &types.ContentBlockDeltaMemberToolUse{Value: types.ToolUseBlockDelta{Input: &malformed}},
	}}
	close(stream.events)
	runtime := &AWSBedrockRuntime{streamer: &fakeConverseStreamer{stream: stream}}
	if _, err := runtime.ConverseStream(context.Background(), ModelRequest{ModelID: "model"}, StreamCallbacks{}); err == nil {
		t.Fatal("ConverseStream() error = nil, want malformed tool input error")
	}
	if !stream.closed || stream.closeCalls != 1 {
		t.Fatalf("response stream close state after malformed input = closed:%t calls:%d, want closed once", stream.closed, stream.closeCalls)
	}
}

func TestNewAWSBedrockRuntime_RequiresRegion(t *testing.T) {
	if _, err := NewAWSBedrockRuntime(context.Background(), " "); err == nil {
		t.Fatal("NewAWSBedrockRuntime() error = nil, want missing region error")
	}
}

func stringPtr(value string) *string { return &value }

var _ bedrockEventStream = (*fakeBedrockEventStream)(nil)
