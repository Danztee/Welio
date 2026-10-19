# Receptionist message layout — retrospective design

This describes the implementation in commit `5e345a9`, written after that
commit. The component was introduced earlier in `f706ed3`.

## Existing component

`web/src/components/workspace/receptionist-message.tsx` is used by both the
customer chat and the owner preview. It wraps reply content in `Message`,
`MessageContent`, `MessageHeader`, and `Bubble`. String replies go through the
existing Markdown renderer; activity feedback appears inside the bubble.

## Layout change

- Remove `MessageAvatar` from receptionist replies. The visible
  “Receptionist” header continues to identify the speaker.
- Set `MessageContent` to `max-w-full`. The previous width subtracted room for
  the avatar (`max-w-[calc(100%-2.25rem)]`).
- Keep the bubble's `max-w-full` and content's `min-w-0` so long content can
  fit the message area and its table/code wrappers can scroll horizontally.
- Leave Markdown rendering, link behavior, activity labels, and live status
  semantics as they were.

## Impact and verification

The component is shared, so the layout refinement appears in both the owner
preview and customer chat. The source diff for `5e345a9` contains only the
avatar removal and width change. Verification should check representative
short and long replies in both surfaces, including a wide code block or table,
and ensure the activity label remains visible and announced.
