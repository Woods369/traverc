import { getSupabase } from './supabase'

export interface DailySeed {
  seedDate: string // YYYY-MM-DD
  seed: string
  source: 'server' | 'local'
}

function todayDateString(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Get today's seed from the server, falling back to a deterministic
// client-side hash if the backend isn't configured or returns no row.
export async function getDailySeed(): Promise<DailySeed> {
  const date = todayDateString()
  const sb = getSupabase()
  if (sb) {
    const { data, error } = await sb
      .from('daily_seeds')
      .select('seed_date, seed')
      .eq('seed_date', date)
      .maybeSingle()
    if (!error && data) {
      return { seedDate: data.seed_date, seed: data.seed, source: 'server' }
    }
    // If the row's missing, optimistically insert one so all clients agree.
    const localSeed = `daily-${date}`
    await sb.from('daily_seeds').insert({ seed_date: date, seed: localSeed })
    return { seedDate: date, seed: localSeed, source: 'local' }
  }
  return { seedDate: date, seed: `daily-${date}`, source: 'local' }
}

export function isDailySeed(seed: string): boolean {
  return seed.startsWith('daily-')
}

export function dateFromDailySeed(seed: string): string | null {
  if (!isDailySeed(seed)) return null
  return seed.slice('daily-'.length)
}
