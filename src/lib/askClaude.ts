/**
 * "Ask about my money" outside Claude: calls the Claude API straight from the device with the
 * person's own API key (stored only on this device). The SDK is loaded on first use so it
 * doesn't weigh down app start-up.
 */
export type ChatTurn = { role: 'user' | 'assistant'; content: string };
export class AskError extends Error { constructor(public code: string, message = code) { super(message); } }

export async function askWithKey(apiKey: string, messages: ChatTurn[], onText: (text: string) => void, signal?: AbortSignal) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // The key belongs to the person using the app and never leaves their device except to call
  // the API, so browser use is intended here.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  try {
    const stream = client.beta.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      // If the model declines, the API retries on a suitable fallback model automatically.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages,
    }, { signal });
    stream.on('text', (_delta, snapshot) => onText(snapshot));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new AskError('refused');
    return msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
  } catch (e) {
    if (e instanceof AskError) throw e;
    if (signal?.aborted) throw new AskError('cancelled');
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AskError('bad_key');
    if (e instanceof Anthropic.RateLimitError) throw new AskError('rate_limited');
    if (e instanceof Anthropic.APIConnectionError) throw new AskError('offline');
    if (e instanceof Anthropic.APIError) throw new AskError('upstream_error', e.message);
    throw new AskError('upstream_error');
  }
}
