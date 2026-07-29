import sharp from 'sharp';
import PDFDocument from 'pdfkit';

// Stessa palette usata nel frontend (NuovaSegnalazioneFlow / OverlayViewer) — l'ordine
// cronologico delle segnalazioni determina l'indice, quindi i colori nel PDF combaciano
// con quelli mostrati a schermo per lo stesso componente/commessa.
export const PALETTE = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#0d9488', '#dc2626', '#0369a1'];

export interface ExportReport {
  id: number;
  created_at: string;
  created_by_name: string | null;
  defect_type: string | null;
  severity: string | null;
  note: string | null;
  drawing: Buffer;
  photo: Buffer | null;
}

const SEVERITY_LABELS: Record<string, string> = { bassa: 'Bassa', media: 'Media', alta: 'Alta' };

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Ricolora un disegno (tratti su sfondo trasparente) in tinta unita, usando il suo
// canale alfa come maschera — equivalente al "source-in" già usato lato client.
async function tintDrawing(buf: Buffer, hexColor: string): Promise<Buffer> {
  const { width, height } = await sharp(buf).metadata();
  if (!width || !height) throw new Error('Disegno non valido');
  const solid = await sharp({ create: { width, height, channels: 4, background: hexColor } }).png().toBuffer();
  return sharp(solid).composite([{ input: buf, blend: 'dest-in' }]).png().toBuffer();
}

// Immagine di base + un livello colorato per ogni segnalazione, appiattiti in un unico PNG.
export async function compositeImage(baseImage: Buffer, drawings: { buf: Buffer; color: string }[]): Promise<Buffer> {
  const { width, height } = await sharp(baseImage).metadata();
  if (!width || !height) throw new Error('Immagine componente non valida');

  const tinted = await Promise.all(drawings.map(d => tintDrawing(d.buf, d.color)));
  const layers = await Promise.all(tinted.map(async (buf) => {
    // Ogni disegno è già alla stessa risoluzione dell'immagine base (per costruzione,
    // vedi DrawingCanvas) — resize di sicurezza solo se un componente è stato sostituito
    // dopo che alcune segnalazioni erano già state fatte con un'immagine diversa.
    const meta = await sharp(buf).metadata();
    const resized = meta.width !== width || meta.height !== height
      ? await sharp(buf).resize(width, height, { fit: 'fill' }).png().toBuffer()
      : buf;
    return { input: resized, blend: 'over' as const };
  }));

  return sharp(baseImage).composite(layers).png().toBuffer();
}

export async function buildReportPdf(params: {
  componentName: string;
  commessa: string;
  compositeImage: Buffer;
  reports: ExportReport[];
}): Promise<Buffer> {
  const { componentName, commessa, compositeImage: img, reports } = params;

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.fontSize(18).fillColor('#111').text(`Qualità — ${componentName}`);
  doc.fontSize(11).fillColor('#666').text(`Commessa ${commessa}  ·  generato il ${new Date().toLocaleString('it-IT')}`);
  doc.moveDown();

  doc.image(img, { fit: [pageWidth, 420], align: 'center' });
  doc.moveDown();

  doc.fontSize(13).fillColor('#111').text(`Segnalazioni (${reports.length})`);
  doc.moveDown(0.3);

  reports.forEach((r, i) => {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 120) doc.addPage();

    const color = PALETTE[i % PALETTE.length];
    const startY = doc.y;
    doc.circle(doc.page.margins.left + 4, startY + 6, 4).fill(color);
    doc.fillColor('#111').fontSize(11).text(
      `  ${fmtDateTime(r.created_at)} — ${r.created_by_name ?? 'Sconosciuto'}`,
      doc.page.margins.left + 14, startY, { width: pageWidth - 14 }
    );

    if (r.defect_type || r.severity) {
      const parts = [r.defect_type, r.severity ? SEVERITY_LABELS[r.severity] ?? r.severity : null].filter(Boolean);
      doc.fontSize(10).fillColor('#444').text(parts.join(' — '), doc.page.margins.left + 14, doc.y, { width: pageWidth - 14 });
    }
    if (r.note) {
      doc.fontSize(10).fillColor('#444').text(r.note, doc.page.margins.left + 14, doc.y, { width: pageWidth - 14 });
    }
    if (r.photo) {
      try {
        doc.image(r.photo, doc.page.margins.left + 14, doc.y + 2, { fit: [90, 90] });
        doc.moveDown(0.2);
        doc.y += 92;
      } catch {
        // foto corrotta o formato non supportato da pdfkit — non blocca l'export del resto
      }
    }
    doc.moveDown(0.6);
  });

  doc.end();
  return done;
}
