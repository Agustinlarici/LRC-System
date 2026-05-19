/**
 * Multi-channel notifier — Telegram Bot + Email (SMTP, optional).
 * Uses native fetch for Telegram — zero extra deps.
 * Email fires only when SMTP_HOST is configured.
 */

import { createTransport } from 'nodemailer';
import { logger } from './logger.js';

const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN  ?? '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID    ?? '';
const ALERT_EMAIL_TO   = process.env.ALERT_EMAIL_TO      ?? '';
const SMTP_HOST        = process.env.SMTP_HOST           ?? '';
const SMTP_PORT        = parseInt(process.env.SMTP_PORT  ?? '587', 10);
const SMTP_USER        = process.env.SMTP_USER           ?? '';
const SMTP_PASS        = process.env.SMTP_PASS           ?? '';
const SMTP_FROM        = process.env.SMTP_FROM           ?? SMTP_USER;

// ─── Debounce per key ─────────────────────────────────────────────────────────
const DEBOUNCE_MS = 30 * 60_000;
const lastSent    = new Map<string, number>();

function canSend(key: string): boolean {
  const last = lastSent.get(key) ?? 0;
  if (Date.now() - last < DEBOUNCE_MS) return false;
  lastSent.set(key, Date.now());
  return true;
}

export function clearDebounce(key: string): void {
  lastSent.delete(key);
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

export async function sendTelegram(text: string, debounceKey?: string): Promise<void> {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  if (debounceKey && !canSend(debounceKey)) return;

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!res.ok) logger.warn(`[Notifier] Telegram error: ${await res.text()}`);
  } catch (e) {
    logger.warn(`[Notifier] Telegram send failed: ${e}`);
  }
}

// ─── Email ────────────────────────────────────────────────────────────────────

let _transport: ReturnType<typeof createTransport> | null = null;

function getTransport() {
  if (!SMTP_HOST) return null;
  if (!_transport) {
    _transport = createTransport({
      host:   SMTP_HOST,
      port:   SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth:   { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return _transport;
}

async function sendEmail(subject: string, html: string): Promise<void> {
  if (!SMTP_HOST || !ALERT_EMAIL_TO) return;
  try {
    const t = getTransport();
    if (!t) return;
    await t.sendMail({
      from:    SMTP_FROM || SMTP_USER,
      to:      ALERT_EMAIL_TO,
      subject: `[LRC-System] ${subject}`,
      html,
    });
  } catch (e) {
    logger.warn(`[Notifier] Email send failed: ${e}`);
  }
}

// ─── High-level helpers ───────────────────────────────────────────────────────

export async function sendAlert(title: string, body: string, debounceKey?: string): Promise<void> {
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  await Promise.all([
    sendTelegram(`🚨 <b>${title}</b>\n${body}\n<i>${now}</i>`, debounceKey),
    sendEmail(title, `<b>${title}</b><br>${body}<br><small>${now}</small>`),
  ]);
}

export async function sendResolved(title: string, debounceKey?: string): Promise<void> {
  if (debounceKey) clearDebounce(debounceKey);
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  await sendTelegram(`✅ <b>RISOLTO: ${title}</b>\n<i>${now}</i>`);
}

export async function sendInfo(text: string): Promise<void> {
  await sendTelegram(`ℹ️ ${text}`);
}
