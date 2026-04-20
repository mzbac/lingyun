import { streamText } from 'ai';

type StreamTextOptions = Parameters<typeof streamText>[0];
type StreamTextResult = ReturnType<typeof streamText>;

/**
 * The AI SDK defaults `streamText().onError` to `console.error`, which leaks raw
 * stream failures into the VS Code extension host console before LingYun can
 * format or suppress them.
 */
export function streamTextWithLingyunDefaults(options: StreamTextOptions): StreamTextResult {
  return streamText({
    ...options,
    onError: options.onError ?? (() => {}),
  });
}
