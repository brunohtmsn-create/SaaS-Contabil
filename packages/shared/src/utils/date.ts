import { format, startOfMonth, endOfMonth, parseISO, addMonths, subMonths, addDays, differenceInCalendarDays } from 'date-fns'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'

export { startOfMonth, endOfMonth, parseISO, addMonths, subMonths, addDays, differenceInCalendarDays }

const TZ = 'America/Sao_Paulo'

export function nowBR(): Date {
  return fromZonedTime(new Date(), TZ)
}

export function toDateBR(date: Date): Date {
  return toZonedTime(date, TZ)
}

export function formatDate(date: Date, fmt = 'yyyy-MM-dd'): string {
  return format(toZonedTime(date, TZ), fmt)
}

export function formatCompetencia(date: Date): string {
  return format(toZonedTime(date, TZ), 'yyyy-MM')
}

export function parsePeriodo(competencia: string): { inicio: Date; fim: Date; competencia: string } {
  const base = parseISO(`${competencia}-01`)
  return {
    inicio: startOfMonth(base),
    fim: endOfMonth(base),
    competencia,
  }
}

export function competenciaToDate(competencia: string): Date {
  return parseISO(`${competencia}-01`)
}

export function addMeses(date: Date, n: number): Date {
  return addMonths(date, n)
}

export function subMeses(date: Date, n: number): Date {
  return subMonths(date, n)
}

export function competencias12Meses(competencia: string): string[] {
  const base = competenciaToDate(competencia)
  const result: string[] = []
  for (let i = 11; i >= 0; i--) {
    result.push(formatCompetencia(subMonths(base, i)))
  }
  return result
}
