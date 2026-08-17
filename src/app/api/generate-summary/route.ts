import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateText } from '@/lib/gemini'
import { extractErrorMessage } from '@/lib/error-message'
import { VALUE_EDGE_THRESHOLD } from '@/lib/constants'

export const maxDuration = 60

const SYSTEM_PROMPT = `Sei un analista quantitativo che scrive il riepilogo settimanale della Serie A per un
gruppo privato di 3 amici che usano una dashboard di analisi personale (non un sito di scommesse,
non gestisce puntate reali). Ricevi dati GIÀ CALCOLATI da un motore statistico (Dixon-Coles) — il
tuo compito è SOLO raccontarli in modo chiaro e interessante, MAI inventare o modificare numeri,
MAI generare previsioni tue.

Regole di linguaggio non negoziabili:
- Usa sempre "probabilità stimata", "il modello indica", "possibile value" — MAI "vincita sicura",
  "certo", "garantito", o linguaggio che suggerisca certezza.
- Se un dato manca, dillo esplicitamente ("non abbiamo dati sufficienti per X") — non inventare.
- Tono da analista appassionato ma onesto: spiega il PERCHÉ dietro i numeri (es. "la difesa di X
  regge meno in trasferta"), non limitarti a ripetere le percentuali.
- Scrivi in italiano, in prosa scorrevole con qualche paragrafo per partita più interessante e un
  breve riepilogo per le altre — non un elenco puntato meccanico.
- Chiudi sempre con un promemoria breve e non moralistico che è uno strumento di analisi, non un
  consiglio di gioco.`

type MatchRow = {
  id: number
  kickoff_at: string
  home_team: { id: number; name: string } | null
  away_team: { id: number; name: string } | null
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const hasValidSecret =
    !!process.env.SYNC_SECRET && authHeader === `Bearer ${process.env.SYNC_SECRET}`

  if (!hasValidSecret) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'non autorizzato' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'richiede ruolo admin' }, { status: 403 })
  }

  const admin = createAdminClient()

  try {
    const { data: nextMatch, error: nextMatchError } = await admin
      .from('matches')
      .select('round_id')
      .gte('kickoff_at', new Date().toISOString())
      .order('kickoff_at', { ascending: true })
      .limit(1)
      .single()
    if (nextMatchError) throw nextMatchError
    const roundId = nextMatch.round_id

    const { data: matches, error: matchesError } = await admin
      .from('matches')
      .select(
        `id, kickoff_at,
         home_team:teams!matches_home_team_id_fkey(id, name),
         away_team:teams!matches_away_team_id_fkey(id, name)`
      )
      .eq('round_id', roundId)
      .order('kickoff_at', { ascending: true })
    if (matchesError) throw matchesError

    const matchIds = ((matches as unknown as MatchRow[]) ?? []).map((m) => m.id)

    const { data: predictions } = matchIds.length
      ? await admin.from('predictions').select('*').in('match_id', matchIds)
      : { data: [] }
    const { data: valueSignals } = matchIds.length
      ? await admin.from('value_signals').select('*').in('match_id', matchIds).gte('edge', VALUE_EDGE_THRESHOLD)
      : { data: [] }

    const teamIds = new Set<number>()
    for (const m of (matches as unknown as MatchRow[]) ?? []) {
      if (m.home_team) teamIds.add(m.home_team.id)
      if (m.away_team) teamIds.add(m.away_team.id)
    }
    const { data: scorers } = teamIds.size
      ? await admin
          .from('player_scorers')
          .select('name, team_id, goals, played_matches')
          .in('team_id', Array.from(teamIds))
          .order('goals', { ascending: false })
      : { data: [] }

    // ---- Costruisce il payload strutturato per Gemini (dati, non prosa) ----
    const predictionByMatch = new Map((predictions ?? []).map((p) => [p.match_id, p]))
    const valueByMatch = new Map<number, typeof valueSignals>()
    for (const v of valueSignals ?? []) {
      const arr = valueByMatch.get(v.match_id) ?? []
      arr.push(v)
      valueByMatch.set(v.match_id, arr)
    }
    const scorersByTeam = new Map<number, { name: string; goals: number; played_matches: number }[]>()
    for (const s of scorers ?? []) {
      if (!s.team_id) continue
      const arr = scorersByTeam.get(s.team_id) ?? []
      arr.push({ name: s.name, goals: s.goals, played_matches: s.played_matches })
      scorersByTeam.set(s.team_id, arr)
    }

    const payload = ((matches as unknown as MatchRow[]) ?? []).map((m) => {
      const p = predictionByMatch.get(m.id)
      const v = valueByMatch.get(m.id) ?? []
      return {
        partita: `${m.home_team?.name ?? '—'} vs ${m.away_team?.name ?? '—'}`,
        data: m.kickoff_at,
        previsione_1x2: p ? { casa: p.home_win, pareggio: p.draw, trasferta: p.away_win } : 'non disponibile',
        over_under_2_5: p ? { over: p.over_2_5, under: p.under_2_5 } : 'non disponibile',
        gol_gol: p ? { si: p.btts_yes, no: p.btts_no } : 'non disponibile',
        risultati_esatti_top3: p ? p.top_scores?.slice(0, 3) : 'non disponibile',
        possibili_value: v.map((s: NonNullable<typeof valueSignals>[number]) => ({
          esito: s.outcome,
          edge_punti_percentuali: (s.edge * 100).toFixed(1),
          quota: s.best_odds,
          bookmaker: s.bookmaker_name,
        })),
        marcatori_probabili_casa: (scorersByTeam.get(m.home_team?.id ?? -1) ?? []).slice(0, 3),
        marcatori_probabili_trasferta: (scorersByTeam.get(m.away_team?.id ?? -1) ?? []).slice(0, 3),
      }
    })

    if (payload.length === 0) {
      return NextResponse.json({ error: 'Nessuna partita nella prossima giornata da riassumere' }, { status: 422 })
    }

    const userPrompt = `Ecco i dati calcolati per la prossima giornata di Serie A (${payload.length} partite). Scrivi il commento della giornata:\n\n${JSON.stringify(payload, null, 2)}`

    const summaryText = await generateText(SYSTEM_PROMPT, userPrompt)

    const { error: upsertError } = await admin
      .from('round_summaries')
      .upsert({ round_id: roundId, summary_text: summaryText, model: 'gemini-3.6-flash' }, { onConflict: 'round_id' })
    if (upsertError) throw upsertError

    await admin.from('sync_logs').insert({
      source: 'gemini',
      sync_type: 'ai-summary',
      status: 'success',
      requests_used: 1,
      message: `Commento generato per ${payload.length} partite (${summaryText.length} caratteri)`,
    })

    return NextResponse.json({ ok: true, matches: payload.length, length: summaryText.length })
  } catch (err) {
    const message = extractErrorMessage(err)
    await admin.from('sync_logs').insert({
      source: 'gemini',
      sync_type: 'ai-summary',
      status: 'error',
      requests_used: 0,
      message,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
