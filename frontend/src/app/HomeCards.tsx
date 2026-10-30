'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { MODULE_GROUPS, modulesByGroup } from '@/lib/modules';
import { ICON_MAP, IconSettings } from '@/components/icons/ModuleIcons';
import { PageHeader } from '@/components/ui/PageHeader';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 13) return 'Buongiorno';
  if (h < 18) return 'Buon pomeriggio';
  return 'Buonasera';
}

// Un pannello bianco per gruppo, con le voci dentro senza bordi: meno rumore
// visivo di una griglia di venti card tutte uguali.
export function HomeCards() {
  const { user, canView } = useAuth();

  const groups = MODULE_GROUPS.filter(g =>
    modulesByGroup(g).some(m => !m.manageOnly && (!m.moduleKey || canView(m.moduleKey)))
  );

  const firstName = user?.display_name?.split(/\s+/)[0] ?? '';

  return (
    <div>
      <PageHeader
        title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
        description="Scegli un modulo per iniziare."
      />

      <div className="space-y-6">
        {groups.map(group => {
          const items = modulesByGroup(group)
            .filter(m => !m.manageOnly && (!m.moduleKey || canView(m.moduleKey)));
          return (
            <section key={group} className="bg-white rounded-card shadow-card p-3">
              <h2 className="px-3 pt-2 pb-3 text-xs font-medium uppercase tracking-wider text-muted">{group}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1">
                {items.map(m => {
                  const Icon = ICON_MAP[m.sidebar] ?? IconSettings;
                  return (
                    <Link
                      key={m.href}
                      href={m.soon ? '#' : m.href}
                      aria-disabled={m.soon || undefined}
                      title={m.description}
                      className={`group flex items-center gap-3.5 rounded-2xl px-3 py-3 transition-colors ${
                        m.soon ? 'opacity-50 cursor-not-allowed' : 'hover:bg-stone-50'
                      }`}
                    >
                      <span className={`flex items-center justify-center w-10 h-10 rounded-xl bg-accent-soft text-accent-ink shrink-0 transition-colors ${
                        m.soon ? '' : 'group-hover:bg-accent group-hover:text-ink-900'
                      }`}>
                        <Icon className="w-5 h-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-ink-900 truncate">{m.label}</span>
                          {m.soon && <span className="text-[11px] bg-stone-100 text-stone-600 px-2 py-0.5 rounded-full">In arrivo</span>}
                        </span>
                        <span className="block text-xs text-muted leading-snug line-clamp-1">{m.description}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
