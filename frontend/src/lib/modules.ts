// ─── Moduli del sistema ────────────────────────────────────────────────────────

import type { ModuleKey } from '@/types';

export interface ModuleConfig {
  href:         string;
  label:        string;
  description:  string;
  icon:         string;
  sidebar:      string;
  hidden:       boolean;
  soon?:        boolean;
  group:        string;
  moduleKey?:   ModuleKey;  // permesso richiesto per vedere la card in home
  manageOnly?:  boolean;    // true = richiede canManage invece di canView
}

export const MODULES: ModuleConfig[] = [
  // ── Logistica ──────────────────────────────────────────────────────────────
  {
    href: '/ingresso-merci', label: 'Materiale Urgente', group: 'Logistica',
    description: 'Gestione ricezione materiali urgenti in entrata',
    icon: '📦', sidebar: 'IconBox', hidden: false, moduleKey: 'ingresso_merci',
  },
  {
    href: '/packing', label: 'Packing', group: 'Logistica',
    description: 'Gestione pallet, spedizioni e liste di imballo',
    icon: '🚚', sidebar: 'IconTruck', hidden: false, moduleKey: 'packing',
  },

  // ── Produzione ─────────────────────────────────────────────────────────────
  {
    href: '/monitor', label: 'Andon', group: 'Produzione',
    description: 'Monitoraggio in tempo reale delle linee di produzione',
    icon: '🖥️', sidebar: 'IconMonitor', hidden: false, moduleKey: 'monitor',
  },
  {
    href: '/monitor/resumen', label: 'Riepilogo Andon', group: 'Produzione',
    description: 'Vista riepilogativa di tutti i monitor andon in tempo reale',
    icon: '📋', sidebar: 'IconList', hidden: false, moduleKey: 'monitor_resumen',
  },
  {
    href: '/buffer', label: 'Buffer', group: 'Produzione',
    description: 'Monitoraggio seriali in pre-area di produzione per fase',
    icon: '📦', sidebar: 'IconArchive', hidden: false, moduleKey: 'buffer',
  },
  {
    href: '/mappa', label: 'Mappa', group: 'Produzione',
    description: 'Vista grafica dello stato delle linee sul piano fabbrica',
    icon: '🗺️', sidebar: 'IconMap', hidden: false, moduleKey: 'mappa',
  },

  // ── Dashboard ──────────────────────────────────────────────────────────────
  {
    href: '/dashboards', label: 'Generale', group: 'Dashboard',
    description: 'Dashboard esecutivo produzione giornaliera',
    icon: '📊', sidebar: 'IconChart', hidden: false, moduleKey: 'dashboards',
  },
  {
    href: '/dashboards/heatmap', label: 'Heatmap', group: 'Dashboard',
    description: 'Heatmap OEE mensile per linea e fascia oraria',
    icon: '🌡️', sidebar: 'IconHeatmap', hidden: false, moduleKey: 'dashboards',
  },
  {
    href: '/dashboards/lead-time', label: 'Tempi tra fasi', group: 'Dashboard',
    description: 'Ore lavorative nette tra fasi di produzione per commessa',
    icon: '⏱️', sidebar: 'IconChart', hidden: false, moduleKey: 'dashboards',
  },
  {
    href: '/dashboards/trends', label: 'Tendenze settimanali', group: 'Dashboard',
    description: 'OEE, produzione e qualità aggregati per settimana per linea',
    icon: '📈', sidebar: 'IconChart', hidden: false, moduleKey: 'dashboards',
  },

  // ── IT ─────────────────────────────────────────────────────────────────────
  {
    href: '/tickets', label: 'Ticket IT', group: 'IT',
    description: 'Segnalazioni e supporto informatico',
    icon: '🎫', sidebar: 'IconTicket', hidden: false, moduleKey: 'tickets',
  },
  {
    href: '/tickets/admin', label: 'Impostazioni', group: 'IT',
    description: 'Gestione utenti, permessi e configurazioni',
    icon: '⚙️', sidebar: 'IconSettings', hidden: false, moduleKey: 'impostazioni',
  },
  {
    href: '/admin/system', label: 'Sistema', group: 'IT',
    description: 'Stato servizi, sync jobs, alert e diagnostica',
    icon: '🖥️', sidebar: 'IconMonitor', hidden: false, moduleKey: 'impostazioni',
  },

  {
    href: '/spma', label: 'Avanzamento Prod', group: 'Logistica',
    description: 'Avanzamento produzione — pianificazione componenti per sequenza di linea',
    icon: '📋', sidebar: 'IconClipboard', hidden: false, moduleKey: 'spma',
  },
  {
    href: '/recepciones', label: 'Ricezione DDT', group: 'Logistica',
    description: 'Ricezione e archiviazione automatica documenti di trasporto via scanner',
    icon: '📄', sidebar: 'IconScan', hidden: false, moduleKey: 'recepciones',
  },
  {
    href: '/edi', label: 'EDI', group: 'Logistica',
    description: 'Generazione automatica file Electronic Data Interchange per le spedizioni',
    icon: '📡', sidebar: 'IconEdi', hidden: false, moduleKey: 'edi',
  },

  // ── Nascosti / in arrivo ───────────────────────────────────────────────────
  {
    href: '/production', label: 'Produzione', group: 'Altro',
    description: 'Sincronizzazione e monitoraggio ordini da Business Central',
    icon: '🏭', sidebar: 'IconFactory', hidden: true, soon: true,
  },
  {
    href: '/assistant', label: 'Assistente AI', group: 'Altro',
    description: 'Chat con dati di produzione via AI',
    icon: '🤖', sidebar: 'IconSparkles', hidden: true, soon: true,
  },
];

export const visibleModules = MODULES.filter(m => !m.hidden);

export const MODULE_GROUPS = ['Logistica', 'Produzione', 'Dashboard', 'IT'] as const;
export type ModuleGroup = typeof MODULE_GROUPS[number];

export const modulesByGroup = (group: string) =>
  visibleModules.filter(m => m.group === group);
