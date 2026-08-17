/**
 * Invio email transazionali via Brevo API (non SMTP — più semplice da una
 * funzione serverless, nessuna libreria SMTP necessaria). Chiave separata da
 * quella SMTP usata da Supabase per il login: quella è configurata dentro
 * Supabase stesso, non accessibile alla nostra app.
 */
export async function sendEmail(to: string[], subject: string, htmlBody: string) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('BREVO_API_KEY mancante')

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: 'papalino93@gmail.com', name: 'Serie A Intelligence' },
      to: to.map((email) => ({ email })),
      subject,
      htmlContent: htmlBody,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Brevo API: HTTP ${res.status} ${body}`)
  }
}
