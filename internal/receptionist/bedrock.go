package receptionist

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/document"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
)

const (
	defaultBedrockMaxTokens = 1024
	maxBedrockTextBytes     = 4_000
	maxBedrockToolInput     = 8_000
	maxBedrockToolCalls     = 3
)

// AWSBedrockRuntime streams a receptionist turn through Bedrock's ConverseStream API.
// The AWS SDK uses its default credential chain, so credentials remain server-side
// and can come from environment credentials, shared config, or the runtime role.
type AWSBedrockRuntime struct {
	streamer converseStreamer
}

type converseStreamer interface {
	ConverseStream(context.Context, *bedrockruntime.ConverseStreamInput) (bedrockEventStream, error)
}

type bedrockEventStream interface {
	Events() <-chan types.ConverseStreamOutput
	Close() error
	Err() error
}

type sdkConverseStreamer struct {
	client *bedrockruntime.Client
}

func (streamer sdkConverseStreamer) ConverseStream(ctx context.Context, input *bedrockruntime.ConverseStreamInput) (bedrockEventStream, error) {
	output, err := streamer.client.ConverseStream(ctx, input)
	if err != nil {
		return nil, err
	}
	if output == nil || output.GetStream() == nil {
		return nil, errors.New("bedrock returned no response stream")
	}
	return output.GetStream(), nil
}

// NewAWSBedrockRuntime loads the AWS SDK's standard configuration for region and
// credentials, then returns an adapter for the receptionist's model interface.
func NewAWSBedrockRuntime(ctx context.Context, region string) (*AWSBedrockRuntime, error) {
	region = strings.TrimSpace(region)
	if region == "" {
		return nil, errors.New("aws region is required for Bedrock")
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load AWS configuration for Bedrock: %w", err)
	}
	return NewAWSBedrockRuntimeFromClient(bedrockruntime.NewFromConfig(cfg)), nil
}

// NewAWSBedrockRuntimeFromClient adapts the shared AWS client to the model interface.
func NewAWSBedrockRuntimeFromClient(client *bedrockruntime.Client) *AWSBedrockRuntime {
	if client == nil {
		return nil
	}
	return &AWSBedrockRuntime{streamer: sdkConverseStreamer{client: client}}
}

func (runtime *AWSBedrockRuntime) ConverseStream(ctx context.Context, request ModelRequest, callbacks StreamCallbacks) (ModelResponse, error) {
	if runtime == nil || runtime.streamer == nil {
		return ModelResponse{}, ErrUnavailable
	}
	input, err := buildBedrockRequest(request)
	if err != nil {
		return ModelResponse{}, fmt.Errorf("prepare Bedrock request: %w", err)
	}
	stream, err := runtime.streamer.ConverseStream(ctx, input)
	if err != nil {
		return ModelResponse{}, fmt.Errorf("bedrock ConverseStream: %w", err)
	}
	if stream == nil {
		return ModelResponse{}, errors.New("bedrock returned no response stream")
	}
	streamClosed := false
	defer func() {
		if !streamClosed {
			_ = stream.Close()
		}
	}()

	response := ModelResponse{}
	toolBlocks := make(map[int32]*bedrockToolBlock)
	for event := range stream.Events() {
		switch value := event.(type) {
		case *types.ConverseStreamOutputMemberContentBlockStart:
			if value == nil || value.Value.ContentBlockIndex == nil {
				return ModelResponse{}, errors.New("bedrock returned an invalid content block start")
			}
			if start, ok := value.Value.Start.(*types.ContentBlockStartMemberToolUse); ok {
				if start.Value.Name == nil || start.Value.ToolUseId == nil || *start.Value.Name == "" || *start.Value.ToolUseId == "" {
					return ModelResponse{}, errors.New("bedrock returned an incomplete tool call")
				}
				index := *value.Value.ContentBlockIndex
				if _, exists := toolBlocks[index]; exists {
					return ModelResponse{}, errors.New("bedrock returned a duplicate tool block")
				}
				if len(toolBlocks) >= maxBedrockToolCalls {
					return ModelResponse{}, fmt.Errorf("%w: Bedrock returned too many tool calls", ErrInvalid)
				}
				toolBlocks[index] = &bedrockToolBlock{id: *start.Value.ToolUseId, name: *start.Value.Name}
			}
		case *types.ConverseStreamOutputMemberContentBlockDelta:
			if value == nil || value.Value.ContentBlockIndex == nil {
				return ModelResponse{}, errors.New("bedrock returned an invalid content block delta")
			}
			switch delta := value.Value.Delta.(type) {
			case *types.ContentBlockDeltaMemberText:
				if delta.Value == "" {
					continue
				}
				if responseTextLen(response.Text, delta.Value) > maxBedrockTextBytes {
					return ModelResponse{}, fmt.Errorf("%w: Bedrock response exceeded its size limit", ErrInvalid)
				}
				response.Text += delta.Value
				if callbacks.OnTextDelta != nil {
					callbacks.OnTextDelta(delta.Value)
				}
			case *types.ContentBlockDeltaMemberToolUse:
				block := toolBlocks[*value.Value.ContentBlockIndex]
				if block == nil || delta.Value.Input == nil {
					return ModelResponse{}, errors.New("bedrock returned a tool input without a tool call")
				}
				if block.input.Len()+len(*delta.Value.Input) > maxBedrockToolInput {
					return ModelResponse{}, fmt.Errorf("%w: Bedrock tool input exceeded its size limit", ErrInvalid)
				}
				block.input.WriteString(*delta.Value.Input)
			}
		case *types.ConverseStreamOutputMemberMessageStop:
			if value != nil && (value.Value.StopReason == types.StopReasonContentFiltered || value.Value.StopReason == types.StopReasonGuardrailIntervened) {
				return ModelResponse{}, errors.New("bedrock declined the receptionist response")
			}
		}
	}
	if err := stream.Err(); err != nil {
		return ModelResponse{}, fmt.Errorf("read Bedrock response stream: %w", err)
	}
	closeErr := stream.Close()
	streamClosed = true
	if closeErr != nil {
		return ModelResponse{}, fmt.Errorf("close bedrock response stream: %w", closeErr)
	}
	if len(toolBlocks) > 0 {
		indices := make([]int, 0, len(toolBlocks))
		for index := range toolBlocks {
			indices = append(indices, int(index))
		}
		sort.Ints(indices)
		for _, index := range indices {
			block := toolBlocks[int32(index)]
			input := strings.TrimSpace(block.input.String())
			if input == "" {
				input = "{}"
			}
			var decoded any
			decoder := json.NewDecoder(strings.NewReader(input))
			decoder.UseNumber()
			if err := decoder.Decode(&decoded); err != nil {
				return ModelResponse{}, errors.New("bedrock returned malformed tool input")
			}
			var trailing any
			if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
				return ModelResponse{}, errors.New("bedrock returned malformed tool input")
			}
			if _, ok := decoded.(map[string]any); !ok {
				return ModelResponse{}, errors.New("bedrock returned a non-object tool input")
			}
			encoded, err := json.Marshal(decoded)
			if err != nil {
				return ModelResponse{}, errors.New("bedrock returned unreadable tool input")
			}
			response.ToolCalls = append(response.ToolCalls, ToolCall{ID: block.id, Name: block.name, Input: encoded})
		}
	}
	return response, nil
}

type bedrockToolBlock struct {
	id    string
	name  string
	input strings.Builder
}

func responseTextLen(current, delta string) int { return len(current) + len(delta) }

func buildBedrockRequest(request ModelRequest) (*bedrockruntime.ConverseStreamInput, error) {
	modelID := strings.TrimSpace(request.ModelID)
	if modelID == "" {
		return nil, errors.New("model ID is required")
	}
	maxTokens := request.MaxTokens
	if maxTokens <= 0 {
		maxTokens = defaultBedrockMaxTokens
	}
	if maxTokens > 8192 {
		return nil, errors.New("maximum token count exceeds the receptionist limit")
	}
	input := &bedrockruntime.ConverseStreamInput{
		ModelId:         aws.String(modelID),
		InferenceConfig: &types.InferenceConfiguration{MaxTokens: aws.Int32(int32(maxTokens))},
	}
	if system := strings.TrimSpace(request.System); system != "" {
		input.System = []types.SystemContentBlock{&types.SystemContentBlockMemberText{Value: system}}
	}
	for _, message := range request.Messages {
		role, err := bedrockRole(message.Role)
		if err != nil {
			return nil, err
		}
		converted := types.Message{Role: role}
		for _, content := range message.Content {
			block, err := bedrockContent(content)
			if err != nil {
				return nil, err
			}
			converted.Content = append(converted.Content, block)
		}
		if len(converted.Content) == 0 {
			return nil, errors.New("message content is required")
		}
		input.Messages = append(input.Messages, converted)
	}
	if len(request.Tools) > 0 {
		tools := make([]types.Tool, 0, len(request.Tools))
		for _, definition := range request.Tools {
			if definition.Name == "" || len(definition.InputSchema) == 0 {
				return nil, errors.New("tool name and input schema are required")
			}
			var schema map[string]any
			if err := json.Unmarshal(definition.InputSchema, &schema); err != nil || schema == nil || schema["type"] != "object" {
				return nil, fmt.Errorf("tool %q must have a valid object input schema", definition.Name)
			}
			tools = append(tools, &types.ToolMemberToolSpec{Value: types.ToolSpecification{
				Name:        aws.String(definition.Name),
				Description: aws.String(definition.Description),
				InputSchema: &types.ToolInputSchemaMemberJson{Value: document.NewLazyDocument(schema)},
			}})
		}
		input.ToolConfig = &types.ToolConfiguration{Tools: tools, ToolChoice: &types.ToolChoiceMemberAuto{Value: types.AutoToolChoice{}}}
	}
	return input, nil
}

func bedrockRole(role string) (types.ConversationRole, error) {
	switch role {
	case "user":
		return types.ConversationRoleUser, nil
	case "assistant":
		return types.ConversationRoleAssistant, nil
	default:
		return "", fmt.Errorf("unsupported receptionist message role %q", role)
	}
}

func bedrockContent(content ChatContent) (types.ContentBlock, error) {
	switch content.Type {
	case "text":
		return &types.ContentBlockMemberText{Value: content.Text}, nil
	case "tool_use":
		if content.ID == "" || content.Name == "" {
			return nil, errors.New("tool use ID and name are required")
		}
		input, err := decodeJSONObject(content.Input)
		if err != nil {
			return nil, errors.New("tool use input must be a JSON object")
		}
		return &types.ContentBlockMemberToolUse{Value: types.ToolUseBlock{
			ToolUseId: aws.String(content.ID), Name: aws.String(content.Name),
			Input: document.NewLazyDocument(input), Type: types.ToolUseType("tool_use"),
		}}, nil
	case "tool_result":
		if content.ToolUseID == "" {
			return nil, errors.New("tool result ID is required")
		}
		status := types.ToolResultStatusSuccess
		if content.IsError {
			status = types.ToolResultStatusError
		}
		return &types.ContentBlockMemberToolResult{Value: types.ToolResultBlock{
			ToolUseId: aws.String(content.ToolUseID), Status: status,
			Content: []types.ToolResultContentBlock{&types.ToolResultContentBlockMemberText{Value: content.Text}},
		}}, nil
	default:
		return nil, fmt.Errorf("unsupported receptionist message content type %q", content.Type)
	}
}

func decodeJSONObject(raw json.RawMessage) (map[string]any, error) {
	if len(raw) == 0 {
		raw = json.RawMessage(`{}`)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil || value == nil {
		return nil, errors.New("expected a JSON object")
	}
	return value, nil
}
