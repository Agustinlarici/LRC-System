// Confronto tra l'analisi deterministica (VM) e quella della IA. La VM e' la fonte di verita': la IA puo'
// solo segnalare (dubbi, differenze, componenti in piu'), mai far passare un dato che la VM non sostiene.
// Ogni valore della IA deve avere un'evidenza (il frammento citato deve esistere nel testo della scheda).

import { createHash } from 'node:crypto';
import { collapse, containsFragment, findFragment } from './text.js';
import type {
  AnalisiIa, AnalisiVm, ComponenteIa, ItemConfronto, LivelloEsito, OpzioneIa, OpzioneVm,
  RisultatoConfronto, UnitaTesto,
} from './types.js';

// Tipi gestiti dai flag (immagini / segnaposto): non si confrontano come componenti.
const TIPI_SOLO_FLAG = new Set(['RIFERIMENTO_IMMAGINI', 'PLACEHOLDER']);

const DESCR_FLAG: Record<string, { tipo: string; testo: string }> = {
  immagini:    { tipo: 'immagini',    testo: 'Il testo rimanda alle immagini ("VEDERE IMMAGINI"): serve la verifica di una persona' },
  placeholder: { tipo: 'placeholder', testo: 'Segnaposto non sostituito nel testo' },
  attenzione:  { tipo: 'attenzione',  testo: 'La scheda segnala "ATTENZIONE": verificare il dato richiesto' },
};

function hash8(x: unknown): string {
  return createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 8);
}

function livelloMax(a: LivelloEsito, b: LivelloEsito): LivelloEsito {
  const peso = { VERDE: 0, AMBRA: 1, ROSSO: 2 } as const;
  return peso[a] >= peso[b] ? a : b;
}

function testoOpzione(o: OpzioneVm): string[] {
  return o.unita.map(u => u.testo);
}

interface Posizionato { unita: UnitaTesto; start: number; end: number; ia: ComponenteIa }

/** Trova dove sta il frammento citato dalla IA, senza riusare lo stesso punto per due componenti. */
function localizza(unita: UnitaTesto[], comp: ComponenteIa, occupati: Posizionato[]): Posizionato | null {
  for (const u of unita) {
    let from = 0;
    for (;;) {
      const pos = findFragment(u.testo, comp.frammento, from);
      if (!pos) break;
      const libero = occupati.every(o => o.unita !== u || pos.end <= o.start || pos.start >= o.end);
      if (libero) return { unita: u, start: pos.start, end: pos.end, ia: comp };
      from = pos.start + 1;
    }
  }
  return null;
}

function sovrapposti(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

export function confronta(vm: AnalisiVm, ia: AnalisiIa | null): RisultatoConfronto {
  const items: ItemConfronto[] = [];
  const add = (it: Omit<ItemConfronto, 'key'>, extra: unknown = null) => {
    items.push({ ...it, key: `${it.riga ?? 'sc'}:${it.tipo}:${hash8([it.origine, it.blocco, it.frammento, it.descrizione, extra])}` });
  };

  // ── Livello scheda ────────────────────────────────────────────────────────────
  const modelloVm = vm.header.tipo_matricola.modello;
  const headerTab: RisultatoConfronto['header'] = [];

  if (!ia) {
    add({ riga: null, codice: null, livello: 'ROSSO', tipo: 'ia_assente',
      descrizione: 'Analisi IA assente: la scheda non può essere accettata in automatico' });
  }

  if (!modelloVm) {
    add({ riga: null, codice: null, livello: 'ROSSO', tipo: 'modello_non_identificato',
      descrizione: 'Modello non identificato dalla VM' });
  }
  if (ia) {
    const modelloIa = ia.modello?.valore ?? null;
    let stato = 'uguale';
    if (!modelloIa) {
      stato = 'mancante_ia';
      add({ riga: null, codice: null, livello: 'ROSSO', tipo: 'modello_non_identificato',
        descrizione: 'Modello non identificato dalla IA' });
    } else if (findFragment(vm.header.tipo_matricola.raw ?? '', modelloIa) === null) {
      stato = 'evidenza_non_valida';
      add({ riga: null, codice: null, livello: 'ROSSO', tipo: 'evidenza_non_valida',
        descrizione: `Il modello indicato dalla IA ("${modelloIa}") non compare in TIPO E MATRICOLA`, ia: { modello: modelloIa } });
    } else if (modelloVm && collapse(modelloIa) !== collapse(modelloVm)) {
      stato = 'diverso';
      add({ riga: null, codice: null, livello: 'ROSSO', tipo: 'modello_diverso',
        descrizione: `Modello diverso: VM ${modelloVm} / IA ${modelloIa}`, vm: { modello: modelloVm }, ia: { modello: modelloIa } });
    }
    headerTab.push({ campo: 'modello', vm: modelloVm, ia: modelloIa, stato });

    const codiceVm = vm.header.tipo_matricola.mercato_codice;
    const mIa = ia.mercato?.valore ?? null;
    if (mIa !== null || codiceVm !== null) {
      const codiceIa = mIa ? (/\d{2,3}/.exec(mIa)?.[0] ?? null) : null;
      let st = 'uguale';
      if (mIa === null) st = 'mancante_ia';
      else if (codiceVm === null) st = 'mancante_vm';
      else if (codiceIa !== codiceVm) {
        st = 'diverso';
        add({ riga: null, codice: null, livello: 'AMBRA', tipo: 'mercato_diverso',
          descrizione: `Mercato diverso: VM ${codiceVm} / IA ${mIa}`, vm: { mercato: codiceVm }, ia: { mercato: mIa } });
      }
      headerTab.push({ campo: 'mercato', vm: codiceVm, ia: mIa, stato: st });
    }

    // Versioni diverse: solo un'informazione. Il contenuto si confronta comunque riga per riga, quindi una differenza
    // dovuta a regole piu' recenti compare come item; se non ce ne sono, non c'e' nulla da rifare.
    if (ia.run.knowledge_version !== vm.versione_conoscenza) {
      headerTab.push({ campo: 'conoscenza', vm: String(vm.versione_conoscenza), ia: String(ia.run.knowledge_version), stato: 'versione_diversa' });
    }
    for (const inc of ia.incoerenze_generali) {
      add({ riga: null, codice: null, livello: 'AMBRA', tipo: 'incoerenza_ia', descrizione: `IA: ${inc.descrizione}`,
        ia: { descrizione: inc.descrizione } }, inc.descrizione);
    }
  } else {
    headerTab.push({ campo: 'modello', vm: modelloVm, ia: null, stato: 'ia_assente' });
  }

  if (!vm.mercato.coerente) {
    add({ riga: null, codice: null, livello: 'ROSSO', tipo: 'mercato_incoerente',
      descrizione: `Mercato incoerente: ${vm.mercato.dettaglio}`, vm: { ...vm.mercato.valori } });
  }

  for (const a of vm.anomalie) {
    if (a.livello === 'info') continue;
    add({ riga: a.riga, codice: null, livello: a.livello === 'errore' ? 'ROSSO' : 'AMBRA', tipo: 'anomalia_parser',
      descrizione: a.dettaglio }, a.tipo);
  }

  // ── Livello opzione ───────────────────────────────────────────────────────────
  const iaPerRiga = new Map<number, OpzioneIa>();
  if (ia) for (const o of ia.opzioni) iaPerRiga.set(o.riga, o);

  for (const o of vm.opzioni) {
    if (!o.codice_noto) {
      add({ riga: o.riga, codice: o.codice, livello: 'AMBRA', tipo: 'codice_ignoto',
        descrizione: `Codice ${o.codice} (${o.descrizione}) non presente nella conoscenza approvata` });
    }

    for (const u of o.unita) {
      const base = { riga: o.riga, codice: o.codice, origine: u.origine, blocco: u.n };
      for (const f of u.flags) {
        const d = DESCR_FLAG[f]!;
        add({ ...base, livello: 'AMBRA', tipo: d.tipo, descrizione: d.testo, frammento: u.testo.slice(0, 160) }, f);
      }
      for (const r of u.residuo) {
        add({ ...base, livello: 'AMBRA', tipo: 'sconosciuto_vm',
          descrizione: `Parola non riconosciuta dalla VM: "${r.testo}"`,
          frammento: r.testo, vm: { residuo: [r.testo] } }, [u.n, r.start, r.end, r.testo]);
      }
    }

    if (!ia) continue;

    const oi = iaPerRiga.get(o.riga);
    if (!oi) {
      add({ riga: o.riga, codice: o.codice, livello: 'ROSSO', tipo: 'riga_mancante_ia',
        descrizione: `La IA non ha analizzato la riga ${o.riga} (${o.codice})` });
      continue;
    }
    if (collapse(oi.codice) !== collapse(o.codice)) {
      add({ riga: o.riga, codice: o.codice, livello: 'ROSSO', tipo: 'codice_diverso',
        descrizione: `La IA ha letto il codice ${oi.codice} dove la scheda ha ${o.codice}`,
        vm: { codice: o.codice }, ia: { codice: oi.codice } });
      continue;
    }

    // Domande aperte della IA
    const tuttoIlTesto = [o.descrizione, o.valore, o.nota, ...testoOpzione(o)].join(' ');
    for (const s of oi.sconosciuti) {
      if (!containsFragment(tuttoIlTesto, s.testo)) {
        add({ riga: o.riga, codice: o.codice, livello: 'AMBRA', tipo: 'evidenza_non_valida',
          descrizione: `IA: "${s.testo}" segnalato come sconosciuto ma non compare nel testo`, ia: { testo: s.testo } }, s.testo);
      } else {
        add({ riga: o.riga, codice: o.codice, livello: 'AMBRA', tipo: 'sconosciuto_ia',
          descrizione: `IA non riconosce "${s.testo}"${s.motivo ? ` (${s.motivo})` : ''}`, frammento: s.testo, ia: { ...s } }, s.testo);
      }
    }
    for (const s of oi.ambigui) {
      add({ riga: o.riga, codice: o.codice, livello: 'AMBRA', tipo: 'ambiguo_ia',
        descrizione: `IA: "${s.testo}" è ambiguo${s.motivo ? ` (${s.motivo})` : ''}`, frammento: s.testo, ia: { ...s } }, s.testo);
    }
    for (const s of oi.incoerenze) {
      add({ riga: o.riga, codice: o.codice, livello: 'AMBRA', tipo: 'incoerenza_ia',
        descrizione: `IA: ${s.descrizione}`, ia: { ...s } }, s.descrizione);
    }

    // Componenti: localizzare i frammenti della IA nel testo e abbinarli a quelli della VM per posizione
    const posizionati: Posizionato[] = [];
    for (const c of oi.componenti) {
      if (TIPI_SOLO_FLAG.has(c.tipo)) continue;
      const p = localizza(o.unita, c, posizionati);
      if (!p) {
        add({ riga: o.riga, codice: o.codice, livello: 'AMBRA', tipo: 'evidenza_non_valida',
          descrizione: `IA: il frammento "${c.frammento}" (${c.tipo}) non compare nel testo della scheda: valore scartato`,
          frammento: c.frammento, ia: { ...c } }, c);
        continue;
      }
      posizionati.push(p);
    }

    const usati = new Set<string>();
    for (const p of posizionati) {
      const idx = p.unita.componenti.findIndex((v, i) =>
        !TIPI_SOLO_FLAG.has(v.tipo) && !usati.has(`${o.riga}|${p.unita.origine}|${p.unita.n}|${i}`) && sovrapposti(v, p));
      const base = { riga: o.riga, codice: o.codice, origine: p.unita.origine, blocco: p.unita.n, frammento: p.ia.frammento };
      if (idx < 0) {
        add({ ...base, livello: 'AMBRA', tipo: 'componente_solo_ia',
          descrizione: `Solo la IA riconosce ${p.ia.tipo} = "${p.ia.valore}" in "${p.ia.frammento}"`,
          ia: { tipo: p.ia.tipo, valore: p.ia.valore, frammento: p.ia.frammento } },
          [p.unita.n, p.start, p.end, p.ia.tipo, p.ia.valore]);
        continue;
      }
      usati.add(`${o.riga}|${p.unita.origine}|${p.unita.n}|${idx}`);
      const v = p.unita.componenti[idx]!;
      if (collapse(v.tipo) !== collapse(p.ia.tipo) || collapse(v.valore) !== collapse(p.ia.valore)) {
        add({ ...base, livello: 'AMBRA', tipo: 'valore_diverso',
          descrizione: `"${p.ia.frammento}": VM ${v.tipo}=${v.valore} / IA ${p.ia.tipo}=${p.ia.valore}`,
          vm: { tipo: v.tipo, valore: v.valore, frammento: v.frammento },
          ia: { tipo: p.ia.tipo, valore: p.ia.valore, frammento: p.ia.frammento } },
          [p.unita.n, v.start, v.end, v.tipo, v.valore, p.ia.tipo, p.ia.valore]);
      }
    }
    for (const u of o.unita) {
      u.componenti.forEach((v, i) => {
        if (TIPI_SOLO_FLAG.has(v.tipo) || usati.has(`${o.riga}|${u.origine}|${u.n}|${i}`)) return;
        add({ riga: o.riga, codice: o.codice, origine: u.origine, blocco: u.n, frammento: v.frammento, livello: 'AMBRA',
          tipo: 'componente_solo_vm',
          descrizione: `Solo la VM riconosce ${v.tipo} = "${v.valore}" in "${v.frammento}"`,
          vm: { tipo: v.tipo, valore: v.valore, frammento: v.frammento } },
          [u.n, v.start, v.end, v.tipo, v.valore]);
      });
    }
  }

  // Chiavi uniche: due item identici nello stesso punto si distinguono con un contatore
  const visti = new Map<string, number>();
  for (const it of items) {
    const n = (visti.get(it.key) ?? 0) + 1;
    visti.set(it.key, n);
    if (n > 1) it.key = `${it.key}#${n}`;
  }

  const righe = vm.opzioni.map(o => {
    let esito: LivelloEsito = 'VERDE';
    for (const it of items) if (it.riga === o.riga) esito = livelloMax(esito, it.livello);
    return { riga: o.riga, codice: o.codice, esito };
  });
  let esito: LivelloEsito = 'VERDE';
  for (const it of items) esito = livelloMax(esito, it.livello);

  return {
    esito,
    ia_assente: !ia,
    versioni: { vm: vm.versione_conoscenza, ia: ia ? ia.run.knowledge_version : null },
    header: headerTab,
    items,
    righe,
  };
}
