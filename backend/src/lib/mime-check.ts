import { HTTPException } from 'hono/http-exception';

// Magic bytes for each allowed type
const TICKET_SIGNATURES: Array<{ magic: number[]; label: string }> = [
  { magic: [0x25, 0x50, 0x44, 0x46],         label: 'PDF'  }, // %PDF
  { magic: [0xFF, 0xD8, 0xFF],                label: 'JPEG' }, // JFIF/EXIF
  { magic: [0x89, 0x50, 0x4E, 0x47],         label: 'PNG'  }, // PNG
  { magic: [0x47, 0x49, 0x46, 0x38],         label: 'GIF'  }, // GIF8
  { magic: [0x42, 0x4D],                      label: 'BMP'  }, // BM
];

const SPMA_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);

// .xlsx = ZIP (PK header); .xls = OLE Compound Document
const XLSX_MAGIC = [0x50, 0x4B, 0x03, 0x04];
const XLS_MAGIC  = [0xD0, 0xCF, 0x11, 0xE0];

function matchesMagic(buf: Buffer, magic: number[]): boolean {
  return magic.every((byte, i) => buf[i] === byte);
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

export function validateTicketFile(buf: Buffer, _filename: string): void {
  const matched = TICKET_SIGNATURES.some(({ magic }) => matchesMagic(buf, magic));
  if (!matched) {
    throw new HTTPException(400, {
      message: 'Tipo di file non consentito. Accettati: PDF, JPG, PNG, GIF',
    });
  }
}

export function validateSpmaFile(buf: Buffer, filename: string): void {
  const ext = extOf(filename);
  if (!SPMA_EXTENSIONS.has(ext)) {
    throw new HTTPException(400, {
      message: 'Tipo di file non consentito. Accettati: .xlsx, .xls, .csv',
    });
  }
  if (ext === '.csv') return; // plain text — extension check is sufficient
  if (!matchesMagic(buf, XLSX_MAGIC) && !matchesMagic(buf, XLS_MAGIC)) {
    throw new HTTPException(400, {
      message: 'Il file non è un Excel valido (.xlsx / .xls)',
    });
  }
}
