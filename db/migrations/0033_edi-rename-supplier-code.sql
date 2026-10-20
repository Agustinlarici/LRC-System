-- Rinomina sdt_ferrari_supplier_code → supplier_code e allarga a 9 char (Ferrari=6, McLaren=9)
ALTER TABLE edi_clients RENAME COLUMN sdt_ferrari_supplier_code TO supplier_code;
ALTER TABLE edi_clients ALTER COLUMN supplier_code TYPE VARCHAR(9);
