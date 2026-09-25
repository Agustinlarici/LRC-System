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

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <p className="text-sm font-semibold text-gray-700 mb-4">{title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">{children}</div>
    </div>
  );
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

  const persone = (n: number) => `${n} ${n === 1 ? 'persona' : 'persone'}`;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href="/hr/dipendenti" className="btn-secondary text-sm">← Torna alla lista</Link>
        {canEditLimited && <button onClick={() => setShowEdit(true)} className="btn-primary text-sm">Modifica</button>}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-semibold text-gray-900">{employee.cognome} {employee.nome}</h1>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${STATO_COLOR[employee.stato]}`}>{STATO_LABEL[employee.stato]}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* Colonna sinistra: dati della persona */}
        <div className="lg:col-span-2 space-y-5">
          <InfoCard title="Lavoro">
            <Field label="Reparto" value={employee.reparto_name} />
            <Field label="Plant / Sedi" value={employee.plant_name} />
            <Field label="Mansione" value={employee.mansione} />
            <Field label="Livello" value={employee.livello} />
            <Field label="Funzione aziendale" value={employee.funzione_aziendale} />
            <Field label="Responsabile" value={employee.capo_nome
              ? <Link href={`/hr/dipendenti/${employee.capo_id}`} className="btn-secondary text-xs">{employee.capo_nome}</Link>
              : null} />
            <Field label="Riporti diretti" value={employee.n_riporti > 0 ? persone(employee.n_riporti) : null} />
          </InfoCard>

          <InfoCard title="Contratto">
            <Field label="Matricola" value={employee.matricola} />
            <Field label="Società" value={employee.contract_company_name} />
            <Field label="Categoria" value={employee.categoria} />
            <Field label="Tipologia" value={employee.tipo_contratto} />
            <Field label="Data assunzione" value={fmtDate(employee.data_assunzione)} />
            <Field label="Anzianità" value={`${employee.anzianita_anni} ${employee.anzianita_anni === 1 ? 'anno' : 'anni'}`} />
            {employee.data_cessazione && <Field label="Fine contratto / cessazione" value={fmtDate(employee.data_cessazione)} />}
          </InfoCard>

          <InfoCard title="Anagrafica e contatti">
            <Field label="Sesso" value={employee.sesso} />
            <Field label="Data di nascita" value={employee.data_nascita ? `${fmtDate(employee.data_nascita)}${employee.eta != null ? ` (${employee.eta} anni)` : ''}` : null} />
            <Field label="Nazionalità" value={employee.nazionalita} />
            <Field label="Codice fiscale" value={employee.codice_fiscale} />
            <Field label="Email" value={employee.email} />
            <Field label="Telefono" value={employee.telefono} />
            <Field label="Indirizzo" value={employee.indirizzo} />
            {employee.note && <Field label="Note" value={employee.note} />}
          </InfoCard>
        </div>

        {/* Colonna destra: retribuzione e storico */}
        <div className="space-y-5">
          {salaryView && <SalaryHistory employeeId={employee.id} canManageSalary={canManage('hr_salary')} />}
          <EventTimeline employeeId={employee.id} canManage={manage} canManageLimited={canEditLimited} />
        </div>
      </div>

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
