/**
 * SPMA Telegram notifier — uses a dedicated bot (SPMA_TELEGRAM_BOT_TOKEN)
 * to send alerts to a configured group chat.
 */

import type { DelayItem } from './delay-checker.js';
import { logger } from '../../lib/logger.js';

const SPMA_TOKEN  = process.env.SPMA_TELEGRAM_BOT_TOKEN ?? '';

let lastReportSentAt = 0;
const REPORT_DEBOUNCE_MS = 30 * 60_000; // 30 min between repeated reports

// ─── Core send ────────────────────────────────────────────────────────────────

async function sendToGroup(chatId: string, text: string): Promise<void> {
  if (!SPMA_TOKEN || !chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${SPMA_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text();
      logger.warn(`[SpmaNotifier] Telegram error ${res.status}: ${body}`);
    }
  } catch (e) {
    logger.warn(`[SpmaNotifier] send failed: ${e}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function sendDelayReport(items: DelayItem[], chatId: string): Promise<void> {
  const delayed = items.filter(i => i.severity !== 'ok');
  if (delayed.length === 0 || !chatId) return;

  // Debounce: skip if a report was sent recently
  if (Date.now() - lastReportSentAt < REPORT_DEBOUNCE_MS) return;
  lastReportSentAt = Date.now();

  const now      = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  const criticals = delayed.filter(i => i.severity === 'critical').length;
  const warnings  = delayed.filter(i => i.severity === 'warning').length;

  const header = `<b>SPMA — Ritardi attivi</b> · <i>${now}</i>\n` +
    (criticals > 0 ? `🔴 ${criticals} critico${criticals > 1 ? 'i' : ''}  ` : '') +
    (warnings  > 0 ? `🟡 ${warnings} avviso${warnings  > 1 ? 'i' : ''}` : '');

  const lines = delayed.map(i => {
    const icon  = i.severity === 'critical' ? '🔴' : '🟡';
    const mount = new Date(i.planned_ts).toLocaleString('it-IT', {
      timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const model = i.model_code && i.model_code !== '-' ? ` · ${i.model_code}` : '';
    return `${icon} <b>${i.commessa_code}</b>${model} — ${i.category_name}\n` +
      `  Prevista: ${i.expected_fase ?? '–'}\n` +
      `  In corso: ${i.current_fase  ?? '–'}\n` +
      `  Montaggio: ${mount}`;
  });

  const text = [header, '', ...lines].join('\n');
  await sendToGroup(chatId, text);
}

export async function sendTestMessage(chatId: string): Promise<void> {
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  await sendToGroup(chatId,
    `✅ <b>Test SPMA</b>\nSistema di avvisi configurato correttamente.\n<i>${now}</i>`
  );
}

// ─── Helper: get groups/chats from getUpdates ─────────────────────────────────

export interface TelegramChatInfo {
  chat_id:   number;
  type:      string;
  title:     string | null;
  username:  string | null;
}

export async function fetchRecentChats(): Promise<TelegramChatInfo[]> {
  if (!SPMA_TOKEN) throw new Error('SPMA_TELEGRAM_BOT_TOKEN non configurato nel server');

  const res = await fetch(
    `https://api.telegram.org/bot${SPMA_TOKEN}/getUpdates?limit=100&timeout=0`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${body}`);
  }

  const data = await res.json() as { ok: boolean; result: Array<{ message?: { chat: { id: number; type: string; title?: string; username?: string } } }> };
  if (!data.ok) throw new Error('Telegram getUpdates failed');

  const seen = new Map<number, TelegramChatInfo>();
  for (const upd of data.result) {
    const chat = upd.message?.chat;
    if (!chat) continue;
    if (!seen.has(chat.id)) {
      seen.set(chat.id, {
        chat_id:  chat.id,
        type:     chat.type,
        title:    chat.title   ?? null,
        username: chat.username ?? null,
      });
    }
  }
  return [...seen.values()];
}

export function spmaTokenConfigured(): boolean {
  return Boolean(SPMA_TOKEN);
}
