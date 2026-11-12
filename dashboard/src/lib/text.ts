export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || raw.startsWith("/login")) return "/";
  return raw;
}

export function matches(text: string, query: string): boolean {
  const haystack = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}\s._-]/gu, "").split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
