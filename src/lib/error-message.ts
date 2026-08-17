/**
 * Estrae un messaggio leggibile da qualunque cosa possa finire in un catch:
 * Error normali, ma anche errori Supabase/Postgres (PostgrestError), che sono
 * oggetti semplici con `.message` e NON passano `instanceof Error` — un
 * controllo naive li scarterebbe silenziosamente dietro un generico
 * "errore sconosciuto", nascondendo esattamente l'informazione che serve
 * per capire cosa è andato storto (viola "mai nascondere problemi di dati").
 */
export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string') {
    return err.message
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}
