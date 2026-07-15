// Pure filtering — search (name/year/category) + Type + Gender + decade range.
export function matchesSearch(person, q) {
  if (!q) return true;
  const hay = `${person.name} ${person.year ?? ''} ${person.category}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

/**
 * @param {Array} people
 * @param {{q:string, types:Set<string>, genders:Set<string>, yearFrom:number, yearTo:number}} state
 */
export function applyFilters(people, state) {
  return people.filter(
    (p) =>
      state.types.has(p.type) &&
      state.genders.has(p.gender) &&
      (p.year == null || (p.year >= state.yearFrom && p.year <= state.yearTo)) &&
      matchesSearch(p, state.q),
  );
}
