import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFilters, matchesSearch } from '../src/filters.js';

const people = [
  { name: 'Lester McAllister', year: 1918, category: 'Missing Males', type: 'Missing', gender: 'Male' },
  { name: 'John Doe', year: 1912, category: 'Unidentified Males', type: 'Unidentified', gender: 'Male' },
  { name: 'Frances Sessions', year: 1946, category: 'Missing Females', type: 'Missing', gender: 'Female' },
  { name: 'Jane Doe', year: 2001, category: 'Unidentified Females', type: 'Unidentified', gender: 'Female' },
  { name: 'No Year Person', year: null, category: 'Missing Males', type: 'Missing', gender: 'Male' },
];
const base = { q: '', types: new Set(['Missing', 'Unidentified']), genders: new Set(['Male', 'Female']), yearFrom: 1900, yearTo: 2026 };

test('search matches name, year, and is case-insensitive', () => {
  assert.ok(matchesSearch(people[0], 'lester'));
  assert.ok(matchesSearch(people[0], '1918'));
  assert.ok(matchesSearch(people[1], 'john doe'));
  assert.ok(!matchesSearch(people[0], 'zzz'));
});

test('type filter narrows', () => {
  const r = applyFilters(people, { ...base, types: new Set(['Unidentified']) });
  assert.deepEqual(r.map((p) => p.name).sort(), ['Jane Doe', 'John Doe']);
});

test('gender filter narrows', () => {
  const r = applyFilters(people, { ...base, genders: new Set(['Female']) });
  assert.deepEqual(r.map((p) => p.name).sort(), ['Frances Sessions', 'Jane Doe']);
});

test('decade range is inclusive; null-year records are never hidden by year', () => {
  const r = applyFilters(people, { ...base, yearFrom: 1910, yearTo: 1950 });
  assert.ok(r.some((p) => p.name === 'Lester McAllister'));
  assert.ok(r.some((p) => p.name === 'Frances Sessions'));
  assert.ok(!r.some((p) => p.name === 'Jane Doe')); // 2001 out of range
  assert.ok(r.some((p) => p.name === 'No Year Person')); // null year kept
});

test('combined filters compose', () => {
  const r = applyFilters(people, { ...base, types: new Set(['Missing']), genders: new Set(['Female']), q: 'frances' });
  assert.deepEqual(r.map((p) => p.name), ['Frances Sessions']);
});
