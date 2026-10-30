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

      <div className="space-y-8">
        {groups.map(group => {
          const items = modulesByGroup(group)
            .filter(m => !m.manageOnly && (!m.moduleKey || canView(m.moduleKey)));
          return (
            <section key={group}>
              <h2 className="mb-3 text-sm font-semibold text-ink-900">
                {group} <span className="ml-1 font-normal text-muted">{items.length}</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
                {items.map(m => {
                  const Icon = ICON_MAP[m.sidebar] ?? IconSettings;
                  return (
                    <Link
                      key={m.href}
                      href={m.soon ? '#' : m.href}
                      aria-disabled={m.soon || undefined}
                      className={`group flex items-start gap-4 bg-white rounded-card border border-line shadow-card p-5 transition-all ${
                        m.soon ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-float hover:-translate-y-0.5'
                      }`}
                    >
                      <span className={`flex items-center justify-center w-11 h-11 rounded-full bg-ink-800 text-white shrink-0 transition-colors ${
                        m.soon ? '' : 'group-hover:bg-brand'
                      }`}>
                        <Icon className="w-5 h-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-ink-900">{m.label}</h3>
                          {m.soon && (
                            <span className="text-xs bg-stone-100 text-stone-600 px-2 py-0.5 rounded-full">
                              In arrivo
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted mt-1 leading-snug">{m.description}</p>
                      </div>
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
