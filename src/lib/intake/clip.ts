// Very long emails (quoted reply chains, big signatures) are cut down before the AI
// sees them. Keep the START and the END: the real request is often at either end,
// and cutting only the tail would silently drop it.
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const note = "\n[... the middle of this long email was left out ...]\n";
  const budget = Math.max(0, max - note.length);
  const head = Math.ceil(budget * 0.6);
  return text.slice(0, head) + note + text.slice(text.length - (budget - head));
}
