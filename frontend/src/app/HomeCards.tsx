'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { MODULE_GROUPS, modulesByGroup } from '@/lib/modules';
import { ICON_MAP, IconSettings } from '@/components/icons/ModuleIcons';

export function HomeCards() {
  const { canView } = useAuth();

  const groups = MODULE_GROUPS.filter(g =>
    modulesByGroup(g).some(m => !m.manageOnly && (!m.moduleKey || canView(m.moduleKey)))
  );

  return (
    <div className="space-y-8">
      {groups.map(group => (
        <div key={group}>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-400 mb-3">
            {group}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {modulesByGroup(group)
              .filter(m => !m.manageOnly && (!m.moduleKey || canView(m.moduleKey)))
              .map(m => {
                const Icon = ICON_MAP[m.sidebar] ?? IconSettings;
                return (
                  <Link
                    key={m.href}
                    href={m.soon ? '#' : m.href}
                    className={`card group hover:shadow-md transition-shadow ${
                      m.soon ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <span className="flex items-center justify-center w-11 h-11 rounded-lg bg-blue-50 text-blue-600 shrink-0 group-hover:bg-blue-100 transition-colors">
                        <Icon className="w-6 h-6" />
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-800 group-hover:text-blue-600">
                            {m.label}
                          </h3>
                          {m.soon && (
                            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                              In arrivo
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">{m.description}</p>
                      </div>
                    </div>
                  </Link>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
