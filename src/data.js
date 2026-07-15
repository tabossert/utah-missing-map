// Snapshot loading + admin-extras merge.
import { getSupabase } from './supabase.js';

export async function loadSnapshot() {
  const res = await fetch('data/data.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`data.json ${res.status}`);
  const d = await res.json();
  return { people: d.people, generatedAt: d.generatedAt, count: d.count };
}

// Map<marker_id, Extra[]> from Supabase; empty (never throws) when unconfigured/down.
export async function fetchExtras() {
  const sb = getSupabase();
  if (!sb) return new Map();
  try {
    const { data, error } = await sb.from('marker_extras').select('*').order('sort', { ascending: true });
    if (error) throw error;
    const map = new Map();
    for (const row of data || []) {
      if (!map.has(row.marker_id)) map.set(row.marker_id, []);
      map.get(row.marker_id).push(row);
    }
    return map;
  } catch (err) {
    console.warn('extras fetch failed:', err.message);
    return new Map();
  }
}

export function attachExtras(people, extrasMap) {
  for (const p of people) p.extras = extrasMap.get(p.id) || [];
  return people;
}

export function deriveFacets(people) {
  const years = people.map((p) => p.year).filter((y) => Number.isFinite(y));
  return {
    minYear: years.length ? Math.min(...years) : 1900,
    maxYear: years.length ? Math.max(...years) : new Date().getFullYear(),
  };
}
