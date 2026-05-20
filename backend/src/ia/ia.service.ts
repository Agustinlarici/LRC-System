import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { logger } from '../lib/logger.js';

export interface DatosDDT {
  proveedor:    string | null;
  numero_ddt:   string | null;
  fecha:        string | null;
  destinatario: string | null;
  confianza:    'alta' | 'media' | 'baja';
}

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `Eres un extractor de datos de documentos de transporte italianos (DDT).
Del documento adjunto extrae en JSON:
{
  "proveedor": "nombre del remitente",
  "numero_ddt": "número de documento",
  "fecha": "fecha del documento en formato YYYY-MM-DD",
  "destinatario": "nombre del destinatario",
  "confianza": "alta | media | baja"
}
Responde SOLO con el JSON, sin texto adicional ni markdown.`;

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY non configurata');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export async function extraerDatosDDT(pdfPath: string): Promise<DatosDDT> {
  const data   = await readFile(pdfPath);
  const base64 = data.toString('base64');

  const msg = await getClient().messages.create({
    model:      MODEL,
    max_tokens: 512,
    system:     SYSTEM_PROMPT,
    messages: [
      {
        role:    'user',
        content: [
          {
            type:   'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          } as never,
          { type: 'text', text: 'Estrai i dati dal DDT.' },
        ],
      },
    ],
  });

  const block = msg.content[0];
  if (block.type !== 'text') throw new Error('Risposta IA non testuale');

  // Strip markdown code fences if the model added them
  let json = block.text.trim();
  json = json.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

  const parsed = JSON.parse(json) as DatosDDT;

  if (!['alta', 'media', 'baja'].includes(parsed.confianza)) {
    parsed.confianza = 'baja';
  }

  logger.info(`[ia] DDT estratto: numero=${parsed.numero_ddt}, proveedor=${parsed.proveedor}, confianza=${parsed.confianza}`);
  return parsed;
}