/**
 * Telegram Bot — long-polling command handler.
 *
 * Comandi:
 *   /help    — lista comandi
 *   /status  — stato sync jobs
 *   /health  — alert attivi
 *   /alerts  — alert attivi con durata
 *   /restart — riavvia il backend (Docker lo rilancia automaticamente)
 */

import { logger } from './logger.js';
import { getAllStats } from './sync-stats.js';
import { getActiveAlerts } from './alert-manager.js';

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID   ?? '';

// ─── Telegram API ─────────────────────────────────────────────────────────────

async function tgPost(method: string, body: unknown): Promise<void> {
  if (!TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(10_000),
    });
  } catch { /* ignore */ }
}

async function reply(chatId: number, text: string): Promise<void> {
  await tgPost('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
}

// ─── Comandi ──────────────────────────────────────────────────────────────────

async function handleCommand(chatId: number, text: string): Promise<void> {
  if (CHAT_ID && String(chatId) !== CHAT_ID) {
    await reply(chatId, '⛔ Non autorizzato');
    return;
  }

  const cmd = text.split(' ')[0].toLowerCase().split('@')[0];

  if (cmd === '/start' || cmd === '/help') {
    await reply(chatId, [
      '<b>LRC-System Bot</b>',
      '',
      '/status  — stato di tutti i sync jobs',
      '/health  — alert attivi e stato servizi',
      '/alerts  — lista alert attivi con durata',
    ].join('\n'));
    return;
  }

  if (cmd === '/status') {
    const stats = getAllStats();
    const lines: string[] = ['<b>Stato Sync Jobs</b>'];
    for (const [job, s] of Object.entries(stats)) {
      const em   = s.status === 'ok' ? '✅' : s.status === 'error' ? '❌' : s.status === 'running' ? '🔄' : '⏸️';
      const last = s.lastFinishedAt
        ? new Date(s.lastFinishedAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })
        : 'Mai';
      const dur = s.lastDurationMs ? `${Math.round(s.lastDurationMs / 100) / 10}s` : '-';
      lines.push(`\n${em} <b>${job}</b>\n  Ultimo: ${last} (${dur})\n  Righe: ${s.lastRowCount ?? '-'}${s.lastError ? `\n  ⚠️ ${s.lastError}` : ''}`);
    }
    await reply(chatId, lines.join(''));
    return;
  }

  if (cmd === '/health') {
    const alerts = getActiveAlerts();
    if (alerts.length === 0) {
      await reply(chatId, '✅ <b>Sistema OK</b>\nNessun alert attivo');
    } else {
      const lines = alerts.map(a => {
        const em = a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : '🔵';
        return `${em} <b>${a.title}</b>\n${a.message}`;
      });
      await reply(chatId, `⚠️ <b>${alerts.length} alert attivi</b>\n\n${lines.join('\n\n')}`);
    }
    return;
  }

  if (cmd === '/alerts') {
    const alerts = getActiveAlerts();
    if (alerts.length === 0) {
      await reply(chatId, '✅ Nessun alert attivo');
    } else {
      const lines = alerts.map(a => {
        const ago = Math.round((Date.now() - a.startedAt.getTime()) / 60_000);
        const em  = a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : '🔵';
        return `${em} <b>${a.title}</b> (${ago} min fa)\n${a.message}`;
      });
      await reply(chatId, lines.join('\n\n'));
    }
    return;
  }

  await reply(chatId, 'Comando non riconosciuto. Usa /help');
}

// ─── Long-polling ─────────────────────────────────────────────────────────────

let lastUpdateId = 0;

async function pollOnce(): Promise<void> {
  if (!TOKEN) return;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`,
      { signal: AbortSignal.timeout(35_000) },
    );
    if (!res.ok) return;
    const data = await res.json() as {
      ok: boolean;
      result: Array<{ update_id: number; message?: { chat: { id: number }; text?: string } }>;
    };
    if (!data.ok) return;
    for (const update of data.result) {
      lastUpdateId = update.update_id;
      if (update.message?.text) {
        handleCommand(update.message.chat.id, update.message.text).catch(() => {});
      }
    }
  } catch { /* network error — retry */ }
}

function scheduleNextPoll(): void {
  pollOnce().finally(() => setTimeout(scheduleNextPoll, 1_000));
}

export function startTelegramBot(): void {
  if (!TOKEN) {
    logger.info('[TelegramBot] TELEGRAM_BOT_TOKEN non configurato — bot disabilitato');
    return;
  }
  scheduleNextPoll();
  logger.info('[TelegramBot] Avviato — in ascolto comandi');
}
