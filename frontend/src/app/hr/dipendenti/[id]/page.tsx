'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import type { HrEmployee, HrDepartment, HrPlant, HrContractCompany } from '@/types';
import { EditEmployeeModal } from './EditEmployeeModal';
import { EventTimeline } from './EventTimeline';
import { SalaryHistory } from './SalaryHistory';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

const STATO_LABEL: Record<string, string> = {
  attivo: 'Attivo', aspettativa: 'Aspettativa', malattia: 'Malattia',
  maternita_paternita: 'Maternità/Paternità', cessato: 'Cessato',
};
const STATO_COLOR: Record<string, string> = {
  attivo: 'bg-green-50 text-green-700 border-green-200',
  aspettativa: 'bg-amber-50 text-amber-700 border-amber-200',
  malattia: 'bg-red-50 text-red-700 border-red-200',
  maternita_paternita: 'bg-purple-50 text-purple-700 border-purple-200',
  cessato: 'bg-gray-100 text-gray-500 border-gray-200',
};

function fmtDate(d: string | null): string {
  if (!d) return '—';
  // Il backend serializza le colonne DATE come timestamp ISO completo
  // (es. "2005-03-01T00:00:00.000Z"): prendo solo i primi 10 caratteri
  // (funziona anche se in futuro arrivasse già come "YYYY-MM-DD" semplice).
  return new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-gray-800 mt-0.5">{value ?? '—'}</p>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const { user, canManage, canView } = useAuth();
  const manage = canManage('hr');
  const salaryView = canView('hr_salary') || canManage('hr_salary');

  const [employee, setEmployee] = useState<HrEmployee | null>(null);
  const [departments, setDepartments] = useState<HrDepartment[]>([]);
  const [plants, setPlants] = useState<HrPlant[]>([]);
  const [companies, setCompanies] = useState<HrContractCompany[]>([]);
  const [allEmployees, setAllEmployees] = useState<HrEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const isDirectCapo = employee != null && user != null &&
    allEmployees.some(e => e.id === employee.capo_id && e.user_id === user.id);
  const canEditLimited = manage || isDirectCapo;

  const load = useCallback(async () => {
    setLoading(true);
    const [empRes, depRes, plantRes, coRes, allRes] = await Promise.all([
      fetch(`${BACKEND}/api/hr/employees/${id}`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/departments`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/plants`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/contract-companies`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/employees`, { credentials: 'include' }),
    ]);
    if (empRes.status === 404) { setNotFound(true); setLoading(false); return; }
    if (empRes.ok) setEmployee(await empRes.json());
    if (depRes.ok) setDepartments(await depRes.json());
    if (plantRes.ok) setPlants(await plantRes.json());
    if (coRes.ok) setCompanies(await coRes.json());
    if (allRes.ok) setAllEmployees(await allRes.json());
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-sm text-gray-400 text-center py-16">Caricamento…</p>;
  if (notFound || !employee) return <p className="text-sm text-red-600 text-center py-16">Dipendente non trovato</p>;

  return (
    <div className="space-y-4">
      <Link href="/hr/dipendenti" className="text-xs text-gray-400 hover:text-gray-600">← Torna alla lista</Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-medium text-gray-900">{employee.cognome} {employee.nome}</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {employee.mansione ?? 'Mansione non specificata'} {employee.reparto_name ? `· ${employee.reparto_name}` : ''}
            {employee.matricola ? ` · Matricola ${employee.matricola}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${STATO_COLOR[employee.stato]}`}>{STATO_LABEL[employee.stato]}</span>
          {canEditLimited && <button onClick={() => setShowEdit(true)} className="btn-secondary text-sm">Modifica</button>}
        </div>
      </div>

      {/* ── Situazione attuale ─────────────────────────────────────────── */}
      <div className="card">
        <p className="text-sm font-medium text-gray-600 mb-4">Situazione attuale</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-4">
          <Field label="Reparto / Area" value={employee.reparto_name} />
          <Field label="Plant / Sede" value={employee.plant_name} />
          <Field label="Mansione" value={employee.mansione} />
          <Field label="Livello" value={employee.livello} />
          <Field label="Funzione aziendale" value={employee.funzione_aziendale} />
          <Field label="Categoria" value={employee.categoria} />
          <Field label="Società contratto" value={employee.contract_company_name} />
          <Field label="Tipo contratto" value={employee.tipo_contratto} />
          <Field label="Capo / Responsabile" value={employee.capo_nome
            ? <Link href={`/hr/dipendenti/${employee.capo_id}`} className="text-blue-600 hover:underline">{employee.capo_nome}</Link>
            : null} />
          <Field label="Riporti diretti" value={employee.n_riporti > 0 ? `${employee.n_riporti} ${employee.n_riporti === 1 ? 'persona' : 'persone'}` : '—'} />
          <Field label="Data assunzione" value={fmtDate(employee.data_assunzione)} />
          <Field label="Anzianità" value={`${employee.anzianita_anni} ${employee.anzianita_anni === 1 ? 'anno' : 'anni'}`} />
          {employee.data_cessazione && <Field label="Data cessazione" value={fmtDate(employee.data_cessazione)} />}
        </div>

        <div className="border-t border-gray-100 mt-5 pt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-4">
          <Field label="Sesso" value={employee.sesso} />
          <Field label="Data di nascita" value={fmtDate(employee.data_nascita)} />
          <Field label="Età" value={employee.eta != null ? `${employee.eta} anni` : null} />
          <Field label="Codice fiscale" value={employee.codice_fiscale} />
          <Field label="Nazionalità" value={employee.nazionalita} />
          <Field label="Email" value={employee.email} />
          <Field label="Telefono" value={employee.telefono} />
          <Field label="Indirizzo" value={employee.indirizzo} />
        </div>

        {employee.note && (
          <div className="border-t border-gray-100 mt-5 pt-5">
            <Field label="Note" value={employee.note} />
          </div>
        )}
      </div>

      {/* ── Storico retributivo (permesso separato) ────────────────────── */}
      {salaryView && <SalaryHistory employeeId={employee.id} canManageSalary={canManage('hr_salary')} />}

      {/* ── Timeline — storico eventi, separato dalla situazione attuale ── */}
      <EventTimeline employeeId={employee.id} canManage={manage} canManageLimited={canEditLimited} />

      {showEdit && (
        <EditEmployeeModal
          employee={employee}
          departments={departments}
          plants={plants}
          companies={companies}
          allEmployees={allEmployees.filter(e => e.id !== employee.id)}
          fullManage={manage}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load(); }}
        />
      )}
    </div>
  );
}
