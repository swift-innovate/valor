/**
 * Model string helpers.
 *
 * Model identifiers may carry a provider prefix ("anthropic/claude-sonnet-4-5",
 * "ollama/gemma3:12b"). The provider registry stores bare model names, so the
 * prefix is stripped before matching or sending to a provider. This is the one
 * shared implementation — do not re-implement inline.
 */

/** "anthropic/claude-sonnet-4-5" → "claude-sonnet-4-5"; bare names pass through. */
export function stripProviderPrefix(model: string): string {
  return model.includes('/') ? model.split('/').slice(1).join('/') : model;
}

/** "anthropic/claude-sonnet-4-5" → "anthropic"; undefined for bare names. */
export function providerPrefix(model: string): string | undefined {
  return model.includes('/') ? model.split('/')[0] : undefined;
}
