// ─── Moduli del sistema ────────────────────────────────────────────────────────
//
// hidden: true  → non appare nella sidebar né nella home
// hidden: false → visibile a tutti
//

export const MODULES = [
  {
    href:        '/ingresso-merci',
    label:       'Ingresso Merci',
    description: 'Gestione ricezione materiali in entrata',
    icon:        '📦',
    sidebar:     'IconBox'    as const,
    hidden:      false,
  },
  {
    href:        '/packing',
    label:       'Packing',
    description: 'Gestione pallet, spedizioni e liste di imballo',
    icon:        '🚚',
    sidebar:     'IconTruck'  as const,
    hidden:      false,
  },
  {
    href:        '/monitor',
    label:       'Andon',
    description: 'Monitoraggio in tempo reale delle linee di produzione',
    icon:        '🖥️',
    sidebar:     'IconMonitor' as const,
    hidden:      false,
  },
  {
    href:        '/buffer',
    label:       'Buffer',
    description: 'Monitoraggio seriali in pre-area di produzione per fase',
    icon:        '📦',
    sidebar:     'IconArchive' as const,
    hidden:      false,
  },
  {
    href:        '/mappa',
    label:       'Mappa',
    description: 'Vista grafica dello stato delle linee sul piano fabbrica',
    icon:        '🗺️',
    sidebar:     'IconMap'    as const,
    hidden:      false,
  },
  {
    href:        '/spma',
    label:       'SPMA',
    description: 'Pianificazione componenti per linea di produzione',
    icon:        '📋',
    sidebar:     'IconClipboard' as const,
    hidden:      true,   // ← nascosto
    soon:        true,
  },
  {
    href:        '/production',
    label:       'Produzione',
    description: 'Sincronizzazione e monitoraggio ordini da Business Central',
    icon:        '🏭',
    sidebar:     'IconFactory' as const,
    hidden:      true,   // ← nascosto
    soon:        true,
  },
  {
    href:        '/assistant',
    label:       'Assistente AI',
    description: 'Chat con dati di produzione via AI',
    icon:        '🤖',
    sidebar:     'IconSparkles' as const,
    hidden:      true,   // ← nascosto
    soon:        true,
  },
] satisfies ModuleConfig[];

export interface ModuleConfig {
  href:        string;
  label:       string;
  description: string;
  icon:        string;
  sidebar:     string;
  hidden:      boolean;
  soon?:       boolean;
}

export const visibleModules = MODULES.filter(m => !m.hidden);
