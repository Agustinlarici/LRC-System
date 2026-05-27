import nodemailer from 'nodemailer';
import type { DelayItem } from './delay-checker.js';
import { logger } from '../../lib/logger.js';

export interface SmtpConfig {
  smtp_host:   string;
  smtp_port:   number;
  smtp_secure: boolean;
  smtp_user:   string;
  smtp_pass:   string;
  smtp_from:   string;
  smtp_to:     string;
}

export function emailConfigured(cfg: Partial<SmtpConfig>): boolean {
  return Boolean(cfg.smtp_host && cfg.smtp_user && cfg.smtp_pass && cfg.smtp_to);
}

function buildTransport(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host:   cfg.smtp_host,
    port:   cfg.smtp_port ?? 587,
    secure: cfg.smtp_secure ?? false,
    auth:   { user: cfg.smtp_user, pass: cfg.smtp_pass },
    tls:    { rejectUnauthorized: false },
  });
}

let lastReportSentAt = 0;
const REPORT_DEBOUNCE_MS = 30 * 60_000;

export async function sendDelayReportEmail(items: DelayItem[], cfg: SmtpConfig): Promise<void> {
  const delayed = items.filter(i => i.severity !== 'ok');
  if (delayed.length === 0) return;
  if (!emailConfigured(cfg)) return;
  if (Date.now() - lastReportSentAt < REPORT_DEBOUNCE_MS) return;
  lastReportSentAt = Date.now();

  const now       = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  const criticals = delayed.filter(i => i.severity === 'critical').length;
  const warnings  = delayed.filter(i => i.severity === 'warning').length;

  const subject = `SPMA — ${criticals > 0 ? `${criticals} ritardo${criticals > 1 ? 'i critici' : ' critico'}` : `${warnings} avviso${warnings > 1 ? 'i' : ''}`} · ${now}`;

  const rows = delayed.map(i => {
    const color = i.severity === 'critical' ? '#dc2626' : '#d97706';
    const mount = new Date(i.planned_ts).toLocaleString('it-IT', {
      timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const model = i.model_code && i.model_code !== '-' ? ` · ${i.model_code}` : '';
    return `
      <tr style="border-bottom:1px solid #e5e7eb">
        <td style="padding:10px 12px;font-weight:600;color:${color}">${i.severity === 'critical' ? '🔴' : '🟡'} ${i.commessa_code}${model}</td>
        <td style="padding:10px 12px;color:#374151">${i.category_name}</td>
        <td style="padding:10px 12px;color:#6b7280">${i.expected_fase ?? '–'}</td>
        <td style="padding:10px 12px;color:#374151">${i.current_fase ?? '–'}</td>
        <td style="padding:10px 12px;color:#6b7280;white-space:nowrap">${mount}</td>
      </tr>`;
  }).join('');

  const html = `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto">
      <h2 style="color:#111827;border-bottom:2px solid #e5e7eb;padding-bottom:8px">
        SPMA — Ritardi attivi
      </h2>
      <p style="color:#6b7280;font-size:14px">${now}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px">
        <thead>
          <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb">
            <th style="padding:10px 12px;text-align:left;color:#6b7280;font-weight:500">Commessa</th>
            <th style="padding:10px 12px;text-align:left;color:#6b7280;font-weight:500">Componente</th>
            <th style="padding:10px 12px;text-align:left;color:#6b7280;font-weight:500">Fase prevista</th>
            <th style="padding:10px 12px;text-align:left;color:#6b7280;font-weight:500">Fase in corso</th>
            <th style="padding:10px 12px;text-align:left;color:#6b7280;font-weight:500">Montaggio</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  try {
    const transport = buildTransport(cfg);
    await transport.sendMail({
      from:    cfg.smtp_from || cfg.smtp_user,
      to:      cfg.smtp_to,
      subject,
      html,
    });
    logger.info(`[SpmaEmail] Report inviato a ${cfg.smtp_to} (${delayed.length} ritardi)`);
  } catch (e) {
    logger.warn({ e }, '[SpmaEmail] invio fallito');
    throw e;
  }
}

export async function sendTestEmail(cfg: SmtpConfig): Promise<void> {
  const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  const transport = buildTransport(cfg);
  await transport.sendMail({
    from:    cfg.smtp_from || cfg.smtp_user,
    to:      cfg.smtp_to,
    subject: `SPMA — Test notifiche · ${now}`,
    html:    `<p style="font-family:sans-serif">Sistema di avvisi email SPMA configurato correttamente.<br><small style="color:#6b7280">${now}</small></p>`,
  });
}
