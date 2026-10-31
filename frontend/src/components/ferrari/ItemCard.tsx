'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { IconaOk } from '@/components/ferrari/Icone';
import {
  DECISIONE_LABEL, TIPI_COMPONENTE_LABEL, fmtData,
  type Decisione, type DecisioneRec, type ItemConfronto, type OpzioneVm,
} from '@/lib/ferrari';

// Decisioni ammesse per tipo di item: deve restare uguale a backend/src/modules/ferrari/validato.ts (AMMESSE).
const AMMESSE: Record<string, Decisione[]> = {
  immagini:           ['verificato_immagini'],
  componente_solo_ia: ['conferma_ia', 'ignora', 'correggi'],
  componente_solo_vm: ['conferma_vm', 'ignora', 'correggi'],
  valore_diverso:     ['conferma_vm', 'conferma_ia', 'correggi'],
  sconosciuto_vm:     ['correggi', 'ignora'],
  sconosciuto_ia:     ['correggi', 'ignora'],
  ambiguo_ia:         ['correggi', 'ignora'],
  codice_ignoto:      ['correggi', 'ignora'],
  ia_assente:         ['conferma_vm'],
};
const DEFAULT_AMMESSE: Decisione[] = ['conferma_vm', 'ignora', 'correggi'];

const TIPI_SCELTA = ['ZONA', 'LATO', 'MATERIALE', 'COLORE', 'CODICE_VERNICE', 'FILO', 'CUCITURA', 'LOGO_SCRITTA', 'ALTRO', 'NEUTRO'];

const TIPO_LABEL: Record<string, string> = {
  codice_ignoto: 'Codice sconosciuto', sconosciuto_vm: 'Parole non riconosciute (VM)', sconosciuto_ia: 'Non riconosciuto dalla IA',
  ambiguo_ia: 'Ambiguo (IA)', componente_solo_ia: 'Solo la IA lo riconosce', componente_solo_vm: 'Solo la VM lo riconosce',
  valore_diverso: 'VM e IA non concordano', immagini: 'Rimando alle immagini', placeholder: 'Segnaposto', attenzione: 'Attenzione',
  anomalia_parser: 'Riga anomala', incoerenza_ia: 'Incoerenza segnalata dalla IA', evidenza_non_valida: 'Evidenza non valida (IA)',
  versione_diversa: 'Versioni di conoscenza diverse', mercato_diverso: 'Mercato diverso', mercato_incoerente: 'Mercato incoerente',
  modello_diverso: 'Modello diverso', modello_non_identificato: 'Modello non identificato', riga_mancante_ia: 'Riga mancante nella IA',
  codice_diverso: 'Codice letto in modo diverso', ia_assente: 'Analisi IA assente',
};

const COMPONENTI_PROPONIBILI = new Set([
  'sconosciuto_vm', 'sconosciuto_ia', 'ambiguo_ia', 'componente_solo_ia', 'componente_solo_vm', 'valore_diverso',
]);

interface Props {
  item: ItemConfronto;
  ultima?: DecisioneRec;
  abilitato: boolean;
  fileId: number;
  rev: number;
  modello: string | null;
  opzione?: OpzioneVm;
  testoUnita?: string;
  onSalvato: () => void;
  onErrore: (m: string) => void;
}

function frammentoIniziale(item: ItemConfronto): string {
  const residuo = (item.vm as { residuo?: string[] } | null | undefined)?.residuo;
  if (item.tipo === 'sconosciuto_vm' && residuo?.length) return residuo[0]!;
  const ia = item.ia as { frammento?: string; testo?: string } | null | undefined;
  const vm = item.vm as { frammento?: string } | null | undefined;
  return item.frammento ?? ia?.frammento ?? ia?.testo ?? vm?.frammento ?? '';
}

export function ItemCard({ item, ultima, abilitato, fileId, rev, modello, opzione, testoUnita, onSalvato, onErrore }: Props) {
  const ammesse = AMMESSE[item.tipo] ?? DEFAULT_AMMESSE;
  const [modifica, setModifica] = useState(false);
  const [aperta, setAperta] = useState(item.tipo !== 'codice_ignoto');   // i codici ignoti sono tanti: chiusi finché non servono
  const [decisione, setDecisione] = useState<Decisione>(ammesse[0]!);
  const [tipo, setTipo] = useState('ALTRO');
  const [valore, setValore] = useState('');
  const [frammento, setFrammento] = useState(frammentoIniziale(item));
  const [significato, setSignificato] = useState(opzione?.descrizione ?? '');
  const [proponi, setProponi] = useState(true);
  const [ambito, setAmbito] = useState<'MODELLO' | 'TUTTI'>('TUTTI');
  const [motivo, setMotivo] = useState('');
  const [invio, setInvio] = useState(false);

  const ia = item.ia as { tipo?: string; valore?: string; frammento?: string } | null | undefined;
  const motivoObbligatorio = item.livello === 'ROSSO';
  const infoComponente = COMPONENTI_PROPONIBILI.has(item.tipo);
  const infoCodice = item.tipo === 'codice_ignoto';
  const puoProporre = (decisione === 'correggi' && (infoComponente || infoCodice))
    || (decisione === 'conferma_ia' && item.tipo === 'componente_solo_ia' && !!ia?.tipo);
  const neutro = tipo === 'NEUTRO';

  const pronto = (() => {
    if (motivoObbligatorio && !motivo.trim()) return false;
    if (decisione === 'correggi') {
      if (infoCodice) return !!significato.trim();
      if (infoComponente) return !!frammento.trim() && (neutro || !!valore.trim());
      return !!motivo.trim();
    }
    return true;
  })();

  async function salva() {
    setInvio(true);
    try {
      let valore_dopo: Record<string, string> | null = null;
      let proposta: Record<string, string> | null = null;
      if (decisione === 'correggi' && infoCodice) {
        valore_dopo = { significato: significato.trim() };
        if (proponi) proposta = { tipo: 'codice', ambito, codice: item.codice ?? '', significato: significato.trim() };
      } else if (decisione === 'correggi' && infoComponente) {
        valore_dopo = { tipo, valore: neutro ? '-' : valore.trim(), frammento: frammento.trim() };
        if (proponi) {
          proposta = { tipo: 'componente', ambito, pattern: frammento.trim(), comp_tipo: tipo, valore: neutro ? '-' : valore.trim(),
            esempio_testo: (testoUnita ?? '').slice(0, 1000) };
        }
      } else if (decisione === 'conferma_ia' && item.tipo === 'componente_solo_ia' && ia?.tipo) {
        if (proponi && ia.frammento && ia.valore) {
          proposta = { tipo: 'componente', ambito, pattern: ia.frammento, comp_tipo: ia.tipo, valore: ia.valore, esempio_testo: (testoUnita ?? '').slice(0, 1000) };
        }
      }
      await api.post(`/api/ferrari/files/${fileId}/decisioni`, {
        rev, item_key: item.key, decisione, valore_dopo, motivo: motivo.trim() || null, proposta,
      });
      setModifica(false);
      onSalvato();
    } catch (e) {
      onErrore((e as Error).message);
    } finally {
      setInvio(false);
    }
  }

  if (!aperta && !ultima) {
    return (
      <div className="rounded-ctl border border-amber-300 bg-warning-soft/40 px-3 py-1.5 text-sm flex flex-wrap items-center gap-x-3">
        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-400 text-amber-950">{item.livello}</span>
        <span className="text-ink-700">{item.descrizione}</span>
        {abilitato && <button className="ml-auto text-xs text-accent-ink hover:underline" onClick={() => setAperta(true)}>Definisci</button>}
      </div>
    );
  }

  const bordo = item.livello === 'ROSSO' ? 'border-red-300 bg-danger-soft/40' : 'border-amber-300 bg-warning-soft/40';

  if (ultima && !modifica) {
    return (
      <div className="rounded-ctl border border-green-200 bg-success-soft/50 px-3 py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1 text-success font-medium"><IconaOk /> {DECISIONE_LABEL[ultima.decisione]}</span>
        <span className="text-ink-700">{TIPO_LABEL[item.tipo] ?? item.tipo}: {item.descrizione}</span>
        {ultima.valore_dopo?.valore && <span className="text-ink-900 font-medium">{ultima.valore_dopo.tipo} = {ultima.valore_dopo.valore}</span>}
        {ultima.valore_dopo?.significato && <span className="text-ink-900 font-medium">{ultima.valore_dopo.significato}</span>}
        {ultima.motivo && <span className="text-muted italic">“{ultima.motivo}”</span>}
        <span className="text-xs text-muted ml-auto">{ultima.username} · {fmtData(ultima.creata_at)}</span>
        {abilitato && <button className="text-xs text-accent-ink hover:underline" onClick={() => setModifica(true)}>Cambia</button>}
      </div>
    );
  }

  return (
    <div className={`rounded-ctl border px-3 py-3 text-sm ${bordo}`}>
      <div className="flex flex-wrap items-start gap-2 mb-2">
        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${item.livello === 'ROSSO' ? 'bg-red-600 text-white' : 'bg-amber-400 text-amber-950'}`}>{item.livello}</span>
        <span className="font-medium text-ink-900">{TIPO_LABEL[item.tipo] ?? item.tipo}</span>
        <span className="text-ink-700">{item.descrizione}</span>
      </div>

      {(item.vm || item.ia) && item.tipo !== 'sconosciuto_vm' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2 text-xs">
          {item.vm && <div className="rounded bg-white border border-line px-2 py-1"><span className="font-semibold text-accent-ink">VM</span> {Object.entries(item.vm).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</div>}
          {item.ia && <div className="rounded bg-white border border-line px-2 py-1"><span className="font-semibold text-success">IA</span> {Object.entries(item.ia).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</div>}
        </div>
      )}

      {!abilitato ? <p className="text-xs text-muted">Non risolto.</p> : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {ammesse.map(d => (
              <label key={d} className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name={`d-${item.key}`} checked={decisione === d} onChange={() => setDecisione(d)} />
                <span>{DECISIONE_LABEL[d]}</span>
              </label>
            ))}
          </div>

          {decisione === 'correggi' && infoCodice && (
            <div>
              <label className="label">Significato del codice {item.codice} per STR</label>
              <input className="input" value={significato} onChange={e => setSignificato(e.target.value)} />
            </div>
          )}

          {decisione === 'correggi' && infoComponente && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="label">Testo (frammento)</label>
                <input className="input" value={frammento} onChange={e => setFrammento(e.target.value)} />
              </div>
              <div>
                <label className="label">Che cos&apos;è</label>
                <select className="input" value={tipo} onChange={e => setTipo(e.target.value)}>
                  {TIPI_SCELTA.map(t => <option key={t} value={t}>{TIPI_COMPONENTE_LABEL[t] ?? t}</option>)}
                </select>
              </div>
              {!neutro && (
                <div>
                  <label className="label">Valore</label>
                  <input className="input" value={valore} onChange={e => setValore(e.target.value)} placeholder="Forma corretta, es. NURBURGRING" />
                </div>
              )}
            </div>
          )}

          {puoProporre && (
            <div className="flex flex-wrap items-center gap-3 rounded bg-white border border-line px-3 py-2">
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={proponi} onChange={e => setProponi(e.target.checked)} />
                <span>Proponi come regola per il futuro</span>
              </label>
              {proponi && (
                <select className="input !w-auto" value={ambito} onChange={e => setAmbito(e.target.value as 'MODELLO' | 'TUTTI')}>
                  <option value="TUTTI">Vale per tutti i modelli</option>
                  <option value="MODELLO" disabled={!modello}>Vale solo per il modello {modello ?? ''}</option>
                </select>
              )}
              <span className="text-xs text-muted">Diventa valida solo dopo l&apos;approvazione del supervisore.</span>
            </div>
          )}

          <div>
            <label className="label">Motivazione{motivoObbligatorio || (decisione === 'correggi' && !infoCodice && !infoComponente) ? ' *' : ' (facoltativa)'}</label>
            <input className="input" value={motivo} onChange={e => setMotivo(e.target.value)} />
          </div>

          <div className="flex gap-2">
            <button className="btn-primary text-sm" disabled={invio || !pronto} onClick={salva}>{invio ? 'Salvataggio…' : 'Salva decisione'}</button>
            {modifica && <button className="btn-secondary text-sm" onClick={() => setModifica(false)}>Annulla</button>}
          </div>
        </div>
      )}
    </div>
  );
}
