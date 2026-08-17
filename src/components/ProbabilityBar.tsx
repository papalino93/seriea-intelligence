/**
 * Barra 1X2 proporzionale — colpo d'occhio più immediato dei soli 3 numeri,
 * stessi colori usati ovunque nell'app per gli esiti (verde=1, oro=X,
 * rosso=2, vedi OUTCOME_COLOR nella pagina partita). home/draw/away sono
 * frazioni 0-1, come tutte le probabilità nel resto dell'app.
 */
export default function ProbabilityBar({ home, draw, away }: { home: number; draw: number; away: number }) {
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-border">
      <div className="bg-accent-pitch" style={{ width: `${Math.max(home * 100, 0)}%` }} />
      <div className="bg-accent-gold" style={{ width: `${Math.max(draw * 100, 0)}%` }} />
      <div className="bg-accent-danger" style={{ width: `${Math.max(away * 100, 0)}%` }} />
    </div>
  )
}
