/**
 * Turns an Expo native rejection such as
 *   "Call to function 'DubixNative.synthesize' has been rejected.\n→ Caused by: java.lang.IllegalStateException: X"
 * into just "X", so users see the real reason instead of bridge plumbing.
 */
export function nativeErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const caused = raw.split(/→\s*Caused by:\s*/).pop() ?? raw;
  return caused
    .replace(/^(?:[a-z_$][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error):\s*/, '')
    .replace(/^Call to function '[^']+' has been rejected\.?\s*/, '')
    .trim() || 'Unknown error';
}
