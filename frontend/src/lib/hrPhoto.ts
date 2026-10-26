// Foto dei dipendenti HR: ridimensionamento prima dell'upload e abbinamento nome file → dipendente.

const MAX_SIDE = 700;    // lato massimo in pixel: nitida anche ingrandita, ~50-120 KB a foto
const JPEG_QUALITY = 0.85;

// Ridimensiona la foto (senza ingrandire quelle piccole) e la converte in JPEG
export async function resizePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';   // i PNG trasparenti non devono diventare neri
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Conversione non riuscita')), 'image/jpeg', JPEG_QUALITY));
}

// ─── Abbinamento nome file → dipendente ──────────────────────────────────────

// "Abu Bakar Siddique_.jpeg" → ["abu", "bakar", "siddique"]
export function nameTokens(s: string): string[] {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter(t => t.length > 1);   // scarta lettere isolate (es. un "ù" finito nel nome)
}

export function fileBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Somiglianza fra due parole (0-1). Le parole corte devono coincidere esattamente.
function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 4) return 0;
  const sim = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return sim >= 0.75 ? sim : 0;
}

// Punteggio 0-1 fra le parole del file e quelle del dipendente, indipendente dall'ordine
// (nome cognome / cognome nome). Ogni parola si abbina al massimo una volta.
export function matchScore(fileTokens: string[], empTokens: string[]): number {
  if (fileTokens.length === 0 || empTokens.length === 0) return 0;
  return Math.max(tokenScore(fileTokens, empTokens), joinedScore(fileTokens, empTokens));
}

// Cognomi scritti uniti o separati ("Deluca" / "De Luca"): confronto le parole ordinate e incollate
function joinedScore(a: string[], b: string[]): number {
  const ja = [...a].sort().join(''), jb = [...b].sort().join('');
  if (Math.min(ja.length, jb.length) < 6) return 0;
  const sim = 1 - levenshtein(ja, jb) / Math.max(ja.length, jb.length);
  return sim >= 0.85 ? sim : 0;
}

function tokenScore(fileTokens: string[], empTokens: string[]): number {
  const pairs: { i: number; j: number; s: number }[] = [];
  fileTokens.forEach((f, i) => empTokens.forEach((e, j) => {
    const s = tokenSimilarity(f, e);
    if (s > 0) pairs.push({ i, j, s });
  }));
  pairs.sort((x, y) => y.s - x.s);
  const usedI = new Set<number>(), usedJ = new Set<number>();
  let total = 0;
  for (const p of pairs) {
    if (usedI.has(p.i) || usedJ.has(p.j)) continue;
    usedI.add(p.i); usedJ.add(p.j);
    total += p.s;
  }
  return (2 * total) / (fileTokens.length + empTokens.length);
}

export interface PhotoCandidate { id: number; score: number }

// I migliori candidati per un file, dal più al meno probabile
export function rankCandidates(
  fileName: string,
  employees: { id: number; nome: string; cognome: string }[],
  limit = 5,
): PhotoCandidate[] {
  const ft = nameTokens(fileBaseName(fileName));
  return employees
    .map(e => ({ id: e.id, score: matchScore(ft, nameTokens(`${e.nome} ${e.cognome}`)) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export type MatchLevel = 'green' | 'yellow' | 'red';

// Verde: un solo candidato chiaro. Giallo: da scegliere fra i candidati. Rosso: nessun candidato.
export function matchLevel(cands: PhotoCandidate[]): MatchLevel {
  const [best, second] = cands;
  if (!best || best.score < 0.5) return 'red';
  if (best.score >= 0.85 && (!second || best.score - second.score >= 0.15)) return 'green';
  return 'yellow';
}
