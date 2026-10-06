import type { MilestoneKind } from './types'

/** 时间轴节点的类型 → 中文标签。 */
export const KIND_LABEL: Record<MilestoneKind, string> = {
  lecture: '讲课',
  deadline: '截止',
  exam: '考试',
  reading: '阅读',
  other: '其他',
}

export const KIND_OPTIONS = Object.entries(KIND_LABEL).map(([value, label]) => ({
  value: value as MilestoneKind,
  label,
}))

export const DATE_LIKE = /^\d{4}-\d{2}-\d{2}$/

/** 日期字符串按当地零点解析。 */
export function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00`)
}

/** 本地零点的时间戳；解析不出来返回 NaN。 */
export function dateTime(value: string): number {
  return parseDate(value).getTime()
}

/**
 * Date → YYYY-MM-DD，按本地时区取年月日。
 * 直接 toISOString() 会先转成 UTC，在 UTC+8 会整整少一天。
 */
export function isoDate(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return shifted.toISOString().slice(0, 10)
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime())
  copy.setDate(copy.getDate() + days)
  return copy
}

/** YYYY-MM-DD 加减天数，返回 YYYY-MM-DD。 */
export function addDaysIso(value: string, days: number): string {
  return isoDate(addDays(parseDate(value), days))
}

/** 距离目标日期还有几天；今天为 0。 */
export function daysUntil(date: string): number {
  const target = dateTime(date)
  if (Number.isNaN(target)) return NaN
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today.getTime()) / 86400000)
}
