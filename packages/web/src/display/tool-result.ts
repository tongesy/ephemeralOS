/**
 * Whether a `display` call from the voice model would replace a tool's result (a search
 * table, a forecast) before the user has said anything more. The model sometimes follows
 * a result with its own summary card; that is refused. Gateway tools themselves, and an
 * update to the result's own id, always go through.
 */
export function wouldReplaceToolResult(state: {
  /** The key of the entry a tool put up, until the user next speaks; null otherwise. */
  toolResult: string | null;
  shown: { key: string; id?: string } | null;
  incomingId?: string;
  fromTool: boolean;
}): boolean {
  const { toolResult, shown, incomingId, fromTool } = state;
  if (fromTool || !toolResult || !shown || shown.key !== toolResult) return false;
  return !incomingId || incomingId !== shown.id;
}
