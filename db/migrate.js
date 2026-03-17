#!/usr/bin/env node
/**
 * LRC-System Data Migration Script
 * MySQL (ProduzioneSTR) → PostgreSQL (LRC-System)
 *
 * Usage:
 *   node migrate.js [--tables=ingresso_merci,pack_article,...]
 *   node migrate.js --all
 *   node migrate.js --dry-run
 *
 * Required env vars (copy from .env.migration):
 *   MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB
 *   PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DB
 */

'use strict';

const mysql = require('mysql2/promise');
const { Client } = require('pg');

// ─── Config ──────────────────────────────────────────────────────────────────
const MYSQL = {
  host:     process.env.MYSQL_HOST     || '192.168.1.149',
  port:     parseInt(process.env.MYSQL_PORT || '3306'),
  user:     process.env.MYSQL_USER     || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DB       || 'str',
};

const PG = {
  host:     process.env.PG_HOST     || 'localhost',
  port:     parseInt(process.env.PG_PORT || '5432'),
  user:     process.env.PG_USER     || 'lrc',
  password: process.env.PG_PASSWORD || 'lrc_password',
  database: process.env.PG_DB       || 'lrc_system',
};

// ─── Table migration definitions ─────────────────────────────────────────────
// Each entry: { mysql: 'table', pg: 'table', transform: row => row }
const MIGRATIONS = [
  // ── Ingresso Merci ──────────────────────────────────────────────────────────
  {
    mysql: 'ingresso_merci',
    pg:    'ingresso_merci',
    columns: ['id', 'materiale', 'mezzo', 'commessa', 'inserito_da', 'orario_arrivo', 'timestamp_inserimento'],
    transform: (row) => ({
      id:                     row.id,
      materiale:              row.materiale,
      mezzo:                  row.mezzo,
      commessa:               row.commessa || null,
      inserito_da:            row.inserito_da || 'Anonimo',
      orario_arrivo:          row.orario_arrivo,
      timestamp_inserimento:  row.timestamp_inserimento,
    }),
  },
  {
    mysql: 'ingresso_merci_storico',
    pg:    'ingresso_merci_storico',
    columns: ['id', 'materiale', 'mezzo', 'commessa', 'inserito_da', 'orario_arrivo', 'ricevuto_da', 'timestamp_ricezione'],
    transform: (row) => ({
      id:                   row.id,
      materiale:            row.materiale,
      mezzo:                row.mezzo,
      commessa:             row.commessa || null,
      inserito_da:          row.inserito_da,
      orario_arrivo:        row.orario_arrivo,
      ricevuto_da:          row.ricevuto_da,
      timestamp_ricezione:  row.timestamp_ricezione,
    }),
  },

  // ── Packing: Core catalog ────────────────────────────────────────────────────
  {
    mysql: 'pack_article',
    pg:    'pack_article',
    columns: ['code', 'description'],
    transform: (row) => ({ code: row.code, description: row.description }),
  },
  {
    mysql: 'pack_operator',
    pg:    'pack_operator',
    columns: ['id', 'name'],
    transform: (row) => ({ id: row.id, name: row.name }),
  },
  {
    mysql: 'pack_operator_session',
    pg:    'pack_operator_session',
    columns: ['id', 'operator_id', 'started_at'],
    transform: (row) => ({ id: row.id, operator_id: row.operator_id, started_at: row.started_at }),
  },
  {
    mysql: 'pack_container',
    pg:    'pack_container',
    columns: ['id', 'name', 'code'],
    transform: (row) => ({ id: row.id, name: row.name, code: row.code }),
  },
  {
    mysql: 'pack_dispatch_destination',
    pg:    'pack_dispatch_destination',
    columns: ['id', 'name'],
    transform: (row) => ({ id: row.id, name: row.name }),
  },

  // ── Packing: Mappings ────────────────────────────────────────────────────────
  {
    mysql: 'pack_article_weight',
    pg:    'pack_article_weight',
    columns: ['article_code', 'weight_kg'],
    transform: (row) => ({ article_code: row.article_code, weight_kg: row.weight_kg }),
  },
  {
    mysql: 'pack_article_price',
    pg:    'pack_article_price',
    columns: ['article_code', 'currency', 'price'],
    transform: (row) => ({
      article_code: row.article_code,
      currency:     row.currency || 'EUR',
      price:        row.price,
    }),
  },
  {
    mysql: 'pack_article_container',
    pg:    'pack_article_container',
    columns: ['article_code', 'container_id'],
    transform: (row) => ({ article_code: row.article_code, container_id: row.container_id }),
  },
  {
    mysql: 'pack_article_dispatch',
    pg:    'pack_article_dispatch',
    columns: ['id', 'article_code', 'destination_id'],
    transform: (row) => ({ id: row.id, article_code: row.article_code, destination_id: row.destination_id }),
  },

  // ── Packing: Dispatches & Pallets ────────────────────────────────────────────
  {
    mysql: 'pack_dispatch',
    pg:    'pack_dispatch',
    columns: ['id', 'type', 'destination_id', 'created_at'],
    transform: (row) => ({
      id:             row.id,
      type:           row.type,
      destination_id: row.destination_id || null,
      created_at:     row.created_at,
    }),
  },
  {
    mysql: 'pack_pallet',
    pg:    'pack_pallet',
    columns: ['id', 'created_at'],
    transform: (row) => ({ id: row.id, created_at: row.created_at }),
  },
  {
    mysql: 'pack_pallet_item',
    pg:    'pack_pallet_item',
    columns: ['id', 'pallet_id', 'article_code', 'quantity', 'commessa', 'created_at'],
    transform: (row) => ({
      id:           row.id,
      pallet_id:    row.pallet_id,
      article_code: row.article_code,
      quantity:     row.quantity,
      commessa:     row.commessa || null,
      created_at:   row.created_at,
    }),
  },
  {
    mysql: 'pack_dispatch_pallet',
    pg:    'pack_dispatch_pallet',
    columns: ['id', 'dispatch_id', 'pallet_id'],
    transform: (row) => ({ id: row.id, dispatch_id: row.dispatch_id, pallet_id: row.pallet_id }),
  },

  // ── SPMA ─────────────────────────────────────────────────────────────────────
  {
    mysql: 'spma_component_category',
    pg:    'spma_component_category',
    columns: ['id', 'name', 'sort_order'],
    transform: (row) => ({ id: row.id, name: row.name, sort_order: row.sort_order || 0 }),
  },
  {
    mysql: 'spma_line',
    pg:    'spma_line',
    columns: ['id', 'name'],
    transform: (row) => ({ id: row.id, name: row.name }),
  },
  {
    mysql: 'spma_line_alias',
    pg:    'spma_line_alias',
    columns: ['id', 'line_id', 'alias'],
    transform: (row) => ({ id: row.id, line_id: row.line_id, alias: row.alias }),
  },
  {
    mysql: 'spma_commessa',
    pg:    'spma_commessa',
    columns: ['id', 'commessa_no', 'line_id', 'model_code', 'line_entry_ts', 'created_at'],
    transform: (row) => ({
      id:             row.id,
      commessa_no:    String(row.commessa_no || '').replace(/e\+/i, '').trim(),
      line_id:        row.line_id || null,
      model_code:     row.model_code || null,
      line_entry_ts:  row.line_entry_ts || null,
      created_at:     row.created_at,
    }),
  },
  {
    mysql: 'spma_plan',
    pg:    'spma_plan',
    columns: ['id', 'commessa_id', 'category_id', 'item_code', 'status', 'confirmed_at', 'sent_at', 'updated_at'],
    transform: (row) => ({
      id:           row.id,
      commessa_id:  row.commessa_id,
      category_id:  row.category_id,
      item_code:    row.item_code || null,
      status:       row.status || 'PENDING',
      confirmed_at: row.confirmed_at || null,
      sent_at:      row.sent_at || null,
      updated_at:   row.updated_at,
    }),
  },
  {
    mysql: 'spma_skip_reason',
    pg:    'spma_skip_reason',
    columns: ['id', 'code', 'label'],
    transform: (row) => ({ id: row.id, code: row.code, label: row.label }),
  },

  // ── Production ───────────────────────────────────────────────────────────────
  {
    mysql: 'prod_order',
    pg:    'prod_order',
    columns: ['id', 'bc_order_no', 'description', 'item_no', 'quantity', 'due_date', 'status', 'routing_no', 'present_now', 'last_seen_at', 'row_sig', 'created_at', 'updated_at'],
    transform: (row) => ({
      id:           row.id,
      bc_order_no:  row.bc_order_no,
      description:  row.description,
      item_no:      row.item_no,
      quantity:     row.quantity,
      due_date:     row.due_date,
      status:       row.status,
      routing_no:   row.routing_no,
      present_now:  row.present_now ? true : false,
      last_seen_at: row.last_seen_at || null,
      row_sig:      row.row_sig,
      created_at:   row.created_at,
      updated_at:   row.updated_at,
    }),
  },
  {
    mysql: 'prod_area_montaggio',
    pg:    'prod_area_montaggio',
    columns: ['id', 'code', 'description'],
    transform: (row) => ({ id: row.id, code: row.code, description: row.description }),
  },
  {
    mysql: 'prod_commessa_inserimenti',
    pg:    'prod_commessa_inserimenti',
    columns: ['id', 'commessa', 'linea', 'insertion_line_ts', 'created_at', 'updated_at'],
    transform: (row) => ({
      id:                 row.id,
      commessa:           row.commessa,
      linea:              row.linea,
      insertion_line_ts:  row.insertion_line_ts || null,
      created_at:         row.created_at,
      updated_at:         row.updated_at,
    }),
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN   = args.includes('--dry-run');
const MIGRATE_ALL = args.includes('--all');
const TABLES_ARG = args.find(a => a.startsWith('--tables='));
const TARGET_TABLES = TABLES_ARG
  ? TABLES_ARG.replace('--tables=', '').split(',').map(t => t.trim())
  : null;

function shouldMigrate(m) {
  if (MIGRATE_ALL) return true;
  if (TARGET_TABLES) return TARGET_TABLES.includes(m.mysql);
  return true; // default: migrate all
}

async function migrateTable(mysqlConn, pgClient, migration) {
  const { mysql: mysqlTable, pg: pgTable, columns, transform } = migration;

  // Check if source table exists
  const [tables] = await mysqlConn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [MYSQL.database, mysqlTable]
  );
  if (!tables.length) {
    console.log(`  ⚠️  ${mysqlTable} → not found in MySQL, skipping`);
    return { skipped: true };
  }

  const [rows] = await mysqlConn.query(`SELECT ${columns.join(', ')} FROM \`${mysqlTable}\``);
  if (!rows.length) {
    console.log(`  ✅  ${mysqlTable} → empty, nothing to migrate`);
    return { count: 0 };
  }

  const transformed = rows.map(transform);
  const cols = Object.keys(transformed[0]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const insertSQL = `INSERT INTO ${pgTable} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

  if (DRY_RUN) {
    console.log(`  🔍  [DRY RUN] ${mysqlTable} → ${pgTable}: ${rows.length} rows would be inserted`);
    return { count: rows.length, dry: true };
  }

  let count = 0;
  for (const row of transformed) {
    try {
      await pgClient.query(insertSQL, Object.values(row));
      count++;
    } catch (err) {
      console.error(`  ❌  Error inserting row into ${pgTable}:`, err.message, JSON.stringify(row).slice(0, 200));
    }
  }

  // Reset sequence to max id
  if (cols.includes('id')) {
    await pgClient.query(
      `SELECT setval(pg_get_serial_sequence('${pgTable}', 'id'), COALESCE(MAX(id), 1)) FROM ${pgTable}`
    );
  }

  console.log(`  ✅  ${mysqlTable} → ${pgTable}: ${count}/${rows.length} rows migrated`);
  return { count };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 LRC-System Migration: MySQL → PostgreSQL');
  console.log('='.repeat(50));
  if (DRY_RUN) console.log('🔍 DRY RUN mode — no data will be written\n');

  const mysqlConn = await mysql.createConnection(MYSQL);
  const pgClient  = new Client(PG);
  await pgClient.connect();

  console.log(`✅ Connected to MySQL  (${MYSQL.host}:${MYSQL.port}/${MYSQL.database})`);
  console.log(`✅ Connected to PG     (${PG.host}:${PG.port}/${PG.database})\n`);

  const targets = MIGRATIONS.filter(shouldMigrate);
  console.log(`📋 Migrating ${targets.length} tables...\n`);

  let totalRows = 0;
  let errors = 0;

  for (const migration of targets) {
    try {
      const result = await migrateTable(mysqlConn, pgClient, migration);
      if (!result.skipped && !result.dry) totalRows += result.count || 0;
    } catch (err) {
      console.error(`  ❌  Failed ${migration.mysql}:`, err.message);
      errors++;
    }
  }

  await mysqlConn.end();
  await pgClient.end();

  console.log('\n' + '='.repeat(50));
  console.log(`✅ Migration complete — ${totalRows} total rows migrated, ${errors} errors`);
  if (DRY_RUN) console.log('ℹ️  Dry run: no changes written');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
