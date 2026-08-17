const MODEL = 'gemini-3.6-flash'
const BASE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

/**
 * Layer AI (documento di progettazione, sezione 3): SOLO a valle del modello
 * quantitativo, mai al posto suo. Riceve numeri già calcolati e li racconta,
 * non li genera. Gemini invece di Claude API per restare a costo zero
 * assoluto (sezione 4.5 del documento).
 */
export async function generateText(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY mancante')

  const res = await fetch(`${BASE_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.7 },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gemini API: HTTP ${res.status} ${body}`)
  }

  const json = await res.json()
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error(`Gemini API: risposta senza testo — ${JSON.stringify(json).slice(0, 300)}`)
  return text
}
