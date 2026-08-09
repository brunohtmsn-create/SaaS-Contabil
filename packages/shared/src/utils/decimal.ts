import { Decimal } from 'decimal.js'

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP })

export { Decimal }

export function toDecimal(value: string | number | Decimal | null | undefined): Decimal {
  if (value === null || value === undefined) return new Decimal(0)
  return new Decimal(value)
}

export function decimalSum(...values: (Decimal | null | undefined)[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v ?? 0), new Decimal(0))
}

export function decimalMin(a: Decimal, b: Decimal): Decimal {
  return a.lt(b) ? a : b
}

export function decimalMax(a: Decimal, b: Decimal): Decimal {
  return a.gt(b) ? a : b
}

export function isZero(value: Decimal): boolean {
  return value.isZero()
}

export function formatBRL(value: Decimal): string {
  return value
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}
