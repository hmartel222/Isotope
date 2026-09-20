export function hasLegacyPeriod(object: { current_period_end?: number }) {
  return Object.prototype.hasOwnProperty.call(object, 'current_period_end');
}
export function periodEnd(item: { current_period_end?: number }) {
  return Number(item.current_period_end) + 1;
}
