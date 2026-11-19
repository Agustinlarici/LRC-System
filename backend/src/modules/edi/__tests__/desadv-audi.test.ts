import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

type Gen = (s: unknown, c: unknown, seq: number) => string;
const { generate } = (await import(
  pathToFileURL(resolve(__dirname, '../../../../edi_generators/DESADV_AUDI.js')).href
)) as { generate: Gen };

// Dati inventati
const client = {
  supplier_code: '111111',
  cdt_company_name: 'Ditta Prova SPA', cdt_address_1: 'Via Prova 1', cdt_address_2: 'CITTA',
  cdt_address_3: '00000', cdt_address_4: 'IT',
  csg_supply_point: '11', csg_company_name: 'Cliente Prova',
  edi_params: { supplier_duns: '123456789', aux_tare_weight: '9', pallet_content_code: '999999' },
};
const shipment = (contract: string | null) => ({
  document_date: '2026-11-19',
  lines: [
    { article_code: '4M8_827_933_J', description: 'ARTICOLO', quantity: 1, unit_of_measure: 'NUMERO', contract_number: contract },
    { article_code: '4M8_827_933_J', description: 'ARTICOLO', quantity: 2, unit_of_measure: 'NUMERO', contract_number: contract },
  ],
});
const segs = (s: string) => s.trim().split('\n');

describe('DESADV_AUDI', () => {
  it('RFF+ON: usa solo la prima parte e al massimo 12 caratteri', () => {
    const out = segs(generate(shipment('000006  J01E2'), client, 13));
    expect(out.filter(l => l.startsWith('RFF+ON'))).toEqual(["RFF+ON:000006'", "RFF+ON:000006'"]);
    const lungo = segs(generate(shipment('1234567890123456'), client, 13));
    expect(lungo.find(l => l.startsWith('RFF+ON'))).toBe("RFF+ON:123456789012'");
  });

  it('etichette PCI/GIN per pallet e scatole, con DUNS nell\'ID', () => {
    const out = segs(generate(shipment('000006'), client, 13));
    expect(out).toContain("PCI+17+++6J::5'");
    expect(out).toContain("GIN+ML+000001300:6JUN123456789000001300'");
    expect(out).toContain("GIN+AW+100001301+100001302'");
    expect(out).toContain("GIN+ML+100001301:1JUN123456789100001301'");
    expect(out).toContain("GIN+ML+100001302:1JUN123456789100001302'");
    expect(out.filter(l => l === "PCI+17+++1J::5'")).toHaveLength(2);
    // la tara sta subito dopo PAC :37, non nella scatola
    const i = out.indexOf("PAC+1+:37:AAC+999999::92'");
    expect(i).toBeGreaterThan(-1);
    expect(out[i + 1]).toBe("MEA+AAY+T+KGM:9'");
    expect(out.filter(l => l.startsWith('MEA+AAY'))).toHaveLength(1);
  });

  it('senza DUNS niente etichette (non si inventano)', () => {
    const c = { ...client, edi_params: {} };
    const out = generate(shipment('000006'), c, 13);
    expect(out).not.toMatch(/PCI\+17|GIN\+/);
  });

  it('UNT conta i segmenti da UNH a UNT', () => {
    const out = segs(generate(shipment('000006'), client, 13));
    const unh = out.findIndex(l => l.startsWith('UNH'));
    const unt = out.findIndex(l => l.startsWith('UNT'));
    expect(out[unt]).toBe(`UNT+${unt - unh + 1}+EDDT-000013'`);
  });
});
