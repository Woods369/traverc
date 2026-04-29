// Naive profanity guard. The blocklist below is intentionally small and
// targets the most common slurs only — it isn't a substitute for proper
// moderation, but it stops the most obvious abuse before submission.
//
// Server-side moderation (e.g. Supabase Edge Functions or external service)
// is the right long-term home for this; keeping it client-side now lets us
// ship without standing extra infra up.

const BLOCKED_SUBSTRINGS = [
  'nigg',
  'fag',
  'kike',
  'spic',
  'chink',
  'tranny',
  'retard',
]

const LEET_TABLE: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  '$': 's',
}

function normalise(input: string): string {
  let out = input.toLowerCase()
  for (const [from, to] of Object.entries(LEET_TABLE)) {
    out = out.split(from).join(to)
  }
  // Collapse repeated characters: "fuuuuck" -> "fuck"
  out = out.replace(/(.)\1{2,}/g, '$1$1')
  return out.replace(/[^a-z]/g, '')
}

export function isProfane(name: string): boolean {
  const n = normalise(name)
  return BLOCKED_SUBSTRINGS.some((b) => n.includes(b))
}
