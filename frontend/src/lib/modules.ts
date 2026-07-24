// ─── Moduli del sistema ────────────────────────────────────────────────────────

import type { ModuleKey } from '@/types';

export interface ModuleConfig {
  href:         string;
  label:        string;
  description:  string;
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
    sidebar: 'IconBox', hidden: false, moduleKey: 'ingresso_merci',
  },
  {
    href: '/packing', label: 'Packing', group: 'Logistica',
    description: 'Gestione pallet, spedizioni e liste di imballo',
    sidebar: 'IconTruck', hidden: false, moduleKey: 'packing',
  },

  // ── Produzione ─────────────────────────────────────────────────────────────
  {
    href: '/monitor', label: 'Andon', group: 'Produzione',
    description: 'Monitoraggio in tempo reale delle linee di produzione',
    sidebar: 'IconMonitor', hidden: false, moduleKey: 'monitor',
  },
  {
    href: '/monitor/resumen', label: 'Riepilogo Andon', group: 'Produzione',
    description: 'Vista riepilogativa di tutti i monitor andon in tempo reale',
    sidebar: 'IconList', hidden: false, moduleKey: 'monitor_resumen',
  },
  {
    href: '/buffer', label: 'Buffer', group: 'Produzione',
    description: 'Monitoraggio seriali in pre-area di produzione per fase',
    sidebar: 'IconArchive', hidden: false, moduleKey: 'buffer',
  },
  {
    href: '/mappa', label: 'Mappa', group: 'Produzione',
    description: 'Vista grafica dello stato delle linee sul piano fabbrica',
    sidebar: 'IconMap', hidden: false, moduleKey: 'mappa',
  },
  {
    href: '/admin/monitor/parate', label: 'Storico fermate', group: 'Produzione',
    description: 'Storico fermate di linea con motivi e durate',
    sidebar: 'IconClipboard', hidden: false, moduleKey: 'monitor_parate',
  },
  {
    href: '/admin/monitor/motivi', label: 'Motivi fermate', group: 'Produzione',
    description: 'Configurazione categorie e motivi di fermata',
    sidebar: 'IconSettings', hidden: false, moduleKey: 'monitor_motivi', manageOnly: true,
  },

  // ── Dashboard ──────────────────────────────────────────────────────────────
  {
    href: '/dashboards', label: 'OEE', group: 'Dashboard',
    description: 'Dashboard esecutivo produzione giornaliera',
    sidebar: 'IconChart', hidden: false, moduleKey: 'dashboards',
  },
  {
    href: '/dashboards/heatmap', label: 'Heatmap', group: 'Dashboard',
    description: 'Heatmap OEE mensile per linea e fascia oraria',
    sidebar: 'IconHeatmap', hidden: false, moduleKey: 'dashboards',
  },
  {
    href: '/dashboards/lead-time', label: 'Tempi tra fasi', group: 'Dashboard',
    description: 'Ore lavorative nette tra fasi di produzione per commessa',
    sidebar: 'IconChart', hidden: false, moduleKey: 'dashboards',
  },
  {
    href: '/dashboards/trends', label: 'Tendenze OEE', group: 'Dashboard',
    description: 'OEE, produzione e qualità giorno per giorno, per linea',
    sidebar: 'IconChart', hidden: false, moduleKey: 'dashboards',
  },
  {
    href: '/dashboards/quantita', label: 'Pezzi Prodotti', group: 'Dashboard',
    description: 'Controllo pezzi contati per fase, modello, componente ed esito delibera',
    sidebar: 'IconChart', hidden: false, moduleKey: 'dashboards',
  },
  {
    href: '/dashboards/qualita', label: 'Qualità', group: 'Dashboard',
    description: 'Tasso di accettazione, tendenza e criticità per modello/componente',
    sidebar: 'IconChart', hidden: false, moduleKey: 'dashboards',
  },

  // ── IT ─────────────────────────────────────────────────────────────────────
  {
    href: '/tickets', label: 'Ticket IT', group: 'IT',
    description: 'Segnalazioni e supporto informatico',
    sidebar: 'IconTicket', hidden: false, moduleKey: 'tickets',
  },
  {
    href: '/admin/system', label: 'Sistema', group: 'IT',
    description: 'Utenti, permessi, reparti, configurazioni e stato del sistema',
    sidebar: 'IconMonitor', hidden: false, moduleKey: 'impostazioni',
  },

  {
    href: '/spma', label: 'Avanzamento Prod', group: 'Logistica',
    description: 'Avanzamento produzione — pianificazione componenti per sequenza di linea',
    sidebar: 'IconClipboard', hidden: false, moduleKey: 'spma',
  },
  {
    href: '/recepciones', label: 'Ricezione DDT', group: 'Logistica',
    description: 'Ricezione e archiviazione automatica documenti di trasporto via scanner',
    sidebar: 'IconScan', hidden: false, moduleKey: 'recepciones',
  },
  {
    href: '/edi', label: 'EDI', group: 'Logistica',
    description: 'Generazione automatica file Electronic Data Interchange per le spedizioni',
    sidebar: 'IconEdi', hidden: false, moduleKey: 'edi',
  },
  {
    href: '/webddt', label: 'WebDDT', group: 'Logistica',
    description: 'Scarica documenti di trasporto Ferrari in formato Excel per le spedizioni',
    sidebar: 'IconWebDdt', hidden: false, moduleKey: 'webddt',
  },

  // ── Qualità ────────────────────────────────────────────────────────────────
  {
    href: '/qualita', label: 'Difetti', group: 'Qualità',
    description: 'Segnalazione difetti su disegno — marcatura a mano libera per componente e commessa',
    sidebar: 'IconClipboard', hidden: false, moduleKey: 'qualita',
  },

  {
    href: '/produzione', label: 'Programma Produzione', group: 'Logistica',
    description: 'Ordini BC + Forecast EDI, caratteristiche e foglio di lavoro per area di montaggio',
    sidebar: 'IconFactory', hidden: false, moduleKey: 'programma_produzione',
  },

  // ── Nascosti / in arrivo ───────────────────────────────────────────────────
  {
    href: '/assistant', label: 'Assistente AI', group: 'Altro',
    description: 'Chat con dati di produzione via AI',
    sidebar: 'IconSparkles', hidden: true, soon: true,
  },
];

export const visibleModules = MODULES.filter(m => !m.hidden);

export const MODULE_GROUPS = ['Logistica', 'Produzione', 'Qualità', 'Dashboard', 'IT'] as const;
export type ModuleGroup = typeof MODULE_GROUPS[number];

export const modulesByGroup = (group: string) =>
  visibleModules.filter(m => m.group === group);
