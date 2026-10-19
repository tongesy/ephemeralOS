/** Serialise keys for `.env`. Values are quoted so the gateway's parser reads them back exactly. */
export function formatEnv(values: Record<string, string | undefined>): string {
  const lines = [
    '# ephemeralOS API keys. Read only by the local gateway; never sent to the browser.',
    '# Keep this file private (mode 600). Re-run `ephemeralos init` to change a key.',
  ];
  for (const [key, value] of Object.entries(values)) {
    if (!value) continue;
    if (/["\r\n]/.test(value)) throw new Error(`${key} contains characters a key can't have`);
    lines.push(`${key}="${value}"`);
  }
  return `${lines.join('\n')}\n`;
}
