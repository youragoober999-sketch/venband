import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BUNDLES, DECORATIONS, EFFECTS_DEF, ITEMS, NAMEPLATES_DEF, PALETTES, PRODUCTS, STARTER_ITEMS, THEMES_DEF } from '../src/lib/shop.ts';

const DB_ID = /^(deco|effect|plate|theme|bundle)\.[a-z0-9_]{1,40}(\.[a-z0-9_]{1,24})?$/;

test('hundreds of items, every id fits the database format', () => {
  assert.ok(ITEMS.size >= 400, `only ${ITEMS.size} items`);
  for (const id of ITEMS.keys()) assert.match(id, DB_ID, id);
  const keys = PRODUCTS.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate product');
});

test('palettes are valid colours; bundles and starters point at real items', () => {
  for (const p of Object.values(PALETTES)) for (const c of p.c) assert.match(c, /^#[0-9a-f]{6}$/i, `${p.id} ${c}`);
  for (const b of BUNDLES) for (const id of b.items) assert.ok(ITEMS.has(id), `${b.id} -> ${id}`);
  for (const id of STARTER_ITEMS) assert.ok(ITEMS.has(id), id);
});

test('the starter list matches the migration', () => {
  const sql = fs.readFileSync('supabase/migrations/20261106150000_shop_inventory.sql', 'utf8');
  for (const id of STARTER_ITEMS) assert.ok(sql.includes(`'${id}'`), `${id} missing from cosmetic_free()`);
});

test('every design has art', () => {
  const read = (f: string) => fs.readFileSync(f, 'utf8');
  const has = (src: string, base: string) => new RegExp(`^  ${base}: \\(`, 'm').test(src);
  const deco = read('src/components/Decorations.tsx'), fx = read('src/components/shopEffects.ts'), np = read('src/components/ShopNameplates.tsx');
  for (const [base] of DECORATIONS) assert.ok(has(deco, base), `decoration ${base}`);
  for (const [base] of EFFECTS_DEF) assert.ok(has(fx, base), `effect ${base}`);
  for (const [base] of NAMEPLATES_DEF) assert.ok(has(np, base), `nameplate ${base}`);
  assert.ok(THEMES_DEF.length >= 25);
});

test('classics say where they come from', () => {
  const classic = new Set(['silver_screen', 'storybook', 'museum', 'myth']);
  for (const p of PRODUCTS) if (classic.has(p.collection) && p.kind !== 'bundle' && p.kind !== 'theme') assert.ok(p.credit, `${p.key} has no credit`);
});
