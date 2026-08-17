/**
 * Soglia minima di edge (punti percentuali, come frazione: 0.03 = 3pt) per
 * segnalare un "possibile value" invece di scartarlo come rumore statistico
 * (documento di progettazione, sezione 9). Condivisa tra route di calcolo e
 * componenti UI — prima era duplicata in 3 punti diversi, rischio di deriva.
 */
export const VALUE_EDGE_THRESHOLD = 0.03
