import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import { logger } from '../../lib/logger.js';
import { STR_LOGO_PNG_BASE64 } from './logo-str.js';

const STR_LOGO = Buffer.from(STR_LOGO_PNG_BASE64, 'base64');
const STR_LOGO_RATIO = 319 / 104; // dimensioni native del PNG sorgente

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
const SEVERITY_COLORS: Record<string, { bg: string; text: string }> = {
  bassa: { bg: '#dcfce7', text: '#166534' },
  media: { bg: '#fef3c7', text: '#92400e' },
  alta:  { bg: '#fee2e2', text: '#991b1b' },
};

// Palette "letterhead" del PDF — indipendente dai colori dei disegni sopra.
const INK        = '#0f172a';
const MUTED      = '#64748b';
const STR_RED    = '#e20513'; // colore del logo STR, usato come unico accento del letterhead
const BORDER     = '#e2e8f0';
const DIVIDER    = '#cbd5e1'; // separatori tra segnalazioni — più marcati del bordo generico
const ROW_ALT_BG = '#f8fafc';

const BAND_HEIGHT = 58;
const FOOTER_Y_OFFSET = 28;

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

  const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const contentTop = BAND_HEIGHT + 26;
  const title = `${componentName} — Commessa ${commessa}`;
  const subtitle = `Generato il ${fmtDateTime(new Date().toISOString())}`;

  // Intestazione "letterhead" — ridisegnata su ogni pagina (anche quelle aggiunte
  // automaticamente da pdfkit quando un testo trabocca), così ogni foglio è identificabile.
  // Sfondo bianco pulito: logo + titolo a sinistra, sottile riga rossa (colore del
  // logo) a separare l'intestazione dal contenuto.
  const logoH = 22;
  const logoW = logoH * STR_LOGO_RATIO;
  const logoY = (BAND_HEIGHT - logoH) / 2 - 2;
  const textX = doc.page.margins.left + logoW + 16;

  function drawBand() {
    doc.image(STR_LOGO, doc.page.margins.left, logoY, { height: logoH });

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13)
      .text(title, textX, 15, { width: pageWidth - logoW - 16, lineBreak: false, ellipsis: true });
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text(subtitle, textX, 32, { width: pageWidth - logoW - 16, lineBreak: false });

    doc.moveTo(0, BAND_HEIGHT).lineTo(doc.page.width, BAND_HEIGHT).lineWidth(0.75).strokeColor(STR_RED).stroke();
    doc.x = doc.page.margins.left;
  }
  doc.on('pageAdded', drawBand);
  drawBand();
  doc.y = contentTop;

  function sectionTitle(text: string) {
    const y = doc.y;
    doc.rect(doc.page.margins.left, y + 2, 3, 13).fill(STR_RED);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(text, doc.page.margins.left + 10, y);
    doc.moveDown(0.5);
  }

  function ensureSpace(need: number) {
    // addPage() ridisegna l'intestazione (via l'evento 'pageAdded') ma pdfkit
    // riporta il cursore al margine superiore di default, non sotto il nostro
    // letterhead — senza questo il contenuto ripartirebbe da sotto il logo.
    if (doc.y + need > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      doc.y = contentTop;
    }
  }

  // ─── Immagine combinata, con cornice ─────────────────────────────────────
  const imgMeta = await sharp(img).metadata();
  const maxImgW = pageWidth;
  const maxImgH = 380;
  let renderW = maxImgW, renderH = maxImgH;
  if (imgMeta.width && imgMeta.height) {
    const scale = Math.min(maxImgW / imgMeta.width, maxImgH / imgMeta.height, 1);
    renderW = imgMeta.width * scale;
    renderH = imgMeta.height * scale;
  }
  const imgX = doc.page.margins.left + (pageWidth - renderW) / 2;
  ensureSpace(renderH + 16);
  const imgY = doc.y;
  doc.lineWidth(1);
  doc.roundedRect(imgX - 10, imgY - 10, renderW + 20, renderH + 20, 6).fillAndStroke(ROW_ALT_BG, BORDER);
  doc.image(img, imgX, imgY, { width: renderW, height: renderH });
  doc.y = imgY + renderH + 22;

  // ─── Elenco riassuntivo (senza dettaglio) ────────────────────────────────
  ensureSpace(30);
  sectionTitle(`Elenco segnalazioni (${reports.length})`);

  const rowH = 20;
  reports.forEach((r, i) => {
    ensureSpace(rowH);
    const y = doc.y;
    if (i % 2 === 0) doc.rect(doc.page.margins.left, y, pageWidth, rowH).fill(ROW_ALT_BG);

    const color = PALETTE[i % PALETTE.length];
    doc.circle(doc.page.margins.left + 8, y + rowH / 2, 4).fill(color);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(String(i + 1).padStart(2, '0'), doc.page.margins.left + 18, y + 5, { width: 22 });
    doc.fillColor(INK).font('Helvetica').fontSize(10)
      .text(fmtDateTime(r.created_at), doc.page.margins.left + 44, y + 5, { width: 150 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(10)
      .text(r.created_by_name ?? 'Sconosciuto', doc.page.margins.left + 200, y + 5, { width: pageWidth - 200 });
    doc.y = y + rowH;
  });

  // Il dettaglio parte sempre da una pagina nuova, separato dall'elenco riassuntivo.
  doc.addPage();
  doc.y = contentTop;
  sectionTitle('Dettaglio segnalazioni');

  // Ripassa ogni foto con sharp (che decodifica in modo affidabile qualsiasi JPEG di
  // fotocamera, incluse le varianti che il decoder interno di pdfkit non riconosce) e
  // applica la rotazione EXIF — altrimenti doc.image() falliva silenziosamente e la
  // foto spariva dal PDF senza errore visibile.
  const safePhotos = await Promise.all(reports.map(async (r) => {
    if (!r.photo) return null;
    try {
      const buf = await sharp(r.photo).rotate().resize({ width: 1200, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      const meta = await sharp(buf).metadata();
      if (!meta.width || !meta.height) return null;
      return { buf, width: meta.width, height: meta.height };
    } catch (err) {
      logger.warn({ err, reportId: r.id }, 'Qualità export: foto non convertibile, esclusa dal PDF');
      return null;
    }
  }));

  reports.forEach((r, i) => {
    ensureSpace(70);

    const color = PALETTE[i % PALETTE.length];
    const cardX = doc.page.margins.left;
    const cardTop = doc.y;

    doc.roundedRect(cardX, cardTop, 22, 22, 4).fill(color);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10)
      .text(String(i + 1).padStart(2, '0'), cardX, cardTop + 6, { width: 22, align: 'center' });

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11)
      .text(fmtDateTime(r.created_at), cardX + 32, cardTop, { width: pageWidth - 32 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(r.created_by_name ?? 'Sconosciuto', cardX + 32, doc.y, { width: pageWidth - 32 });
    doc.y = Math.max(doc.y, cardTop + 22) + 6;

    if (r.defect_type) {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text('Tipo difetto:  ', cardX + 32, doc.y, { continued: true, width: pageWidth - 32 });
      doc.fillColor(MUTED).font('Helvetica').text(r.defect_type);
    }
    if (r.severity) {
      const label = SEVERITY_LABELS[r.severity] ?? r.severity;
      const c = SEVERITY_COLORS[r.severity] ?? { bg: '#f1f5f9', text: '#334155' };
      doc.font('Helvetica-Bold').fontSize(8.5);
      const badgeW = doc.widthOfString(label) + 14;
      const badgeY = doc.y;
      doc.roundedRect(cardX + 32, badgeY, badgeW, 15, 7).fill(c.bg);
      doc.fillColor(c.text).text(label, cardX + 32, badgeY + 3.5, { width: badgeW, align: 'center' });
      doc.y = badgeY + 15 + 4;
    }
    if (r.note) {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text('Note:', cardX + 32, doc.y, { width: pageWidth - 32 });
      doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(r.note, cardX + 32, doc.y, { width: pageWidth - 32 });
      doc.moveDown(0.2);
    }

    const photo = safePhotos[i];
    if (photo) {
      // Occupa quasi tutta la larghezza della pagina — limitata in altezza solo per
      // non far sparire il resto della segnalazione su più pagine con foto verticali.
      const maxW = pageWidth - 32;
      const maxH = 360;
      const scale = Math.min(maxW / photo.width, maxH / photo.height, 1);
      const pRenderW = photo.width * scale;
      const pRenderH = photo.height * scale;
      ensureSpace(pRenderH + 12);
      doc.image(photo.buf, cardX + 32, doc.y + 4, { width: pRenderW, height: pRenderH });
      doc.y += pRenderH + 12;
    }
    doc.moveDown(0.4);

    if (i < reports.length - 1) {
      ensureSpace(16);
      const lineY = doc.y;
      doc.moveTo(cardX, lineY).lineTo(doc.page.width - doc.page.margins.right, lineY)
        .lineWidth(1).strokeColor(DIVIDER).stroke();
      doc.moveDown(0.7);
    }
  });

  // ─── Numero pagina, aggiunto a fine generazione su ogni pagina bufferizzata ──
  const range = doc.bufferedPageRange();
  const bottomMargin = doc.page.margins.bottom;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Il testo posizionato dentro al margine inferiore fa scattare la paginazione
    // automatica di pdfkit (anche con coordinate esplicite) creando pagine vuote
    // in coda — va disattivata solo per la scrittura del numero di pagina.
    doc.page.margins.bottom = 0;
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text(`Pagina ${i - range.start + 1} di ${range.count}`, 0, doc.page.height - FOOTER_Y_OFFSET, {
        align: 'center', width: doc.page.width,
      });
    doc.page.margins.bottom = bottomMargin;
  }

  doc.end();
  return done;
}
