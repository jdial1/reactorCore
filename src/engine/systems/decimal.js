export function getDecimalCtor() {
  if (typeof globalThis !== "undefined" && globalThis.Decimal) return globalThis.Decimal;
  if (typeof self !== "undefined" && self.Decimal) return self.Decimal;
  return null;
}

export function toDecimal(value) {
  const Decimal = getDecimalCtor();
  if (!Decimal) return Number(value) || 0;
  if (value == null) return new Decimal(0);
  if (typeof value === "object" && typeof value.gte === "function") return value;
  return new Decimal(value);
}

export function toNumber(value) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value) || 0;
}

export function serializeDecimal(value) {
  const d = toDecimal(value);
  return typeof d.toString === "function" ? d.toString() : String(d);
}

export function deserializeDecimal(value) {
  if (value == null) return toDecimal(0);
  if (typeof value === 'object' && typeof value.gte === 'function') return value;
  return toDecimal(toNumber(value));
}
