import { streamText } from 'ai';

type StreamTextOptions = Parameters<typeof streamText>[0];
type StreamTextResult = ReturnType<typeof streamText>;

/**
 * The AI SDK defaults `streamText().onError` to `console.error`, which leaks raw
 * transient stream failures into host consoles before LingYun can classify and
 * retry them. LingYun owns user-facing error handling, so default to a no-op
 * unless a caller explicitly provides `onError`.
 */
export function streamTextWithLingyunDefaults(options: StreamTextOptions): StreamTextResult {
  return streamText({
    ...options,
    onError: options.onError ?? (() => {}),
  });
}
