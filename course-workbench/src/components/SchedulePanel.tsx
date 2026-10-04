import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../api'
import type {
  CalendarInfo,
  CalendarTerm,
  Course,
  MeetingSlot,
  Milestone,
  OverrideKind,
  WeekOverride,
} from '../types'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

const KINDS: { value: OverrideKind; label: string }[] = [
  { value: 'cancelled', label: '取消' },
  { value: 'moved', label: '延期' },
  { value: 'online', label: '线上' },
  { value: 'other', label: '其他' },
]

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00`)
}

function iso(date: Date): string {
  const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return copy.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime())
  copy.setDate(copy.getDate() + days)
  return copy
}

/** 学期第 1 教学周的周一。校历给的是开学第一天，不一定是周一。 */
function firstMonday(teachingStart: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teachingStart)) return null
  const start = toDate(teachingStart)
  const offset = (start.getDay() + 6) % 7
  return addDays(start, -offset)
}

interface Row {
  week: number
  topic: string
  date: string
  holiday: string
  override: WeekOverride | undefined
}

interface Props {
  course: Course
  onSaved: (course: Course) => void
}

export default function SchedulePanel({ course, onSaved }: Props) {
  const [calendars, setCalendars] = useState<CalendarInfo[]>([])
  const [slot, setSlot] = useState<MeetingSlot>(
    course.meetingSlot || { weekday: 1, start: '', end: '', location: '' },
  )
  const [termId, setTermId] = useState(course.termId || '')
  const [calendarId, setCalendarId] = useState(course.calendarId || '')
  const [overrides, setOverrides] = useState<WeekOverride[]>(course.weekOverrides || [])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const { calendars: list } = await api.listCalendars()
      setCalendars(list)
      setCalendarId((current) => current || list[0]?.id || '')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const calendar = calendars.find((item) => item.id === calendarId) || calendars[0] || null
  const term: CalendarTerm | null =
    calendar?.terms.find((item) => item.id === termId) || calendar?.terms[0] || null

  const rows = useMemo<Row[]>(() => {
    if (!term) return []
    const monday = firstMonday(term.teachingStart)
    if (!monday) return []
    const source =
      course.weekly?.length > 0
        ? course.weekly.map((item, index) => ({
            week: item.week ?? index + 1,
            topic: item.topic || '',
          }))
        : []
    return source.map((item) => {
      const date = iso(addDays(monday, (item.week - 1) * 7 + (slot.weekday - 1)))
      const holiday = term.holidays.find((entry) => entry.date === date)?.name || ''
      return {
        week: item.week,
        topic: item.topic,
        date,
        holiday,
        override: overrides.find((entry) => entry.week === item.week),
      }
    })
  }, [term, course.weekly, slot.weekday, overrides])

  const setOverride = (week: number, patch: Partial<WeekOverride>) => {
    setOverrides((current) => {
      const existing = current.find((entry) => entry.week === week)
      const next: WeekOverride = {
        week,
        kind: 'cancelled',
        date: '',
        note: '',
        ...existing,
        ...patch,
      }
      const rest = current.filter((entry) => entry.week !== week)
      return [...rest, next].sort((a, b) => a.week - b.week)
    })
  }

  const clearOverride = (week: number) => {
    setOverrides((current) => current.filter((entry) => entry.week !== week))
  }

  const save = async () => {
    setBusy(true)
    try {
      const { course: updated } = await api.updateCourse(course.id, {
        calendarId,
        termId: term?.id || '',
        meetingSlot: slot,
        weekOverrides: overrides,
        ...termDefaults(),
      })
      onSaved(updated)
      setMessage('排课已保存')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /** 学期名与起止日期能由校历确定，课程里空着就顺手补上。 */
  function termDefaults() {
    if (!term) return {}
    const patch: Partial<Course> = {}
    if (!course.term && calendar) patch.term = `${calendar.academicYear} ${term.name}`
    if (!course.startDate) patch.startDate = term.teachingStart
    if (!course.endDate) patch.endDate = term.teachingEnd
    return patch
  }

  const buildTimeline = async () => {
    setBusy(true)
    try {
      const nodes: Milestone[] = rows
        .filter((row) => row.override?.kind !== 'cancelled')
        .map((row) => ({
          id: `week-${row.week}`,
          date: row.override?.kind === 'moved' && row.override.date ? row.override.date : row.date,
          title: `第 ${row.week} 周 · ${row.topic}`,
          kind: 'lecture' as const,
          note: row.holiday ? `原定日遇「${row.holiday}」` : '',
          done: false,
        }))
      const kept = (course.schedule || []).filter((node) => !/^第\s*\d+\s*周/.test(node.title))
      const seen = new Set(kept.map((node) => `${node.date}|${node.title}`))
      const merged = [
        ...kept,
        ...nodes.filter((node) => !seen.has(`${node.date}|${node.title}`)),
      ]
      const { course: updated } = await api.updateCourse(course.id, {
        calendarId,
        termId: term?.id || '',
        meetingSlot: slot,
        weekOverrides: overrides,
        schedule: merged,
        ...termDefaults(),
      })
      onSaved(updated)
      setMessage(`已写入 ${nodes.length} 条周次节点，保留原有 ${kept.length} 条其他节点`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 className="section-title">排课</h2>
        <button
          className="btn"
          type="button"
          onClick={() =>
            void api.refreshCalendars().then(() => {
              void load()
              setMessage('校历已更新')
            })
          }
        >
          更新校历
        </button>
      </div>
      <p className="section-hint">
        {calendar
          ? `校历来自 ${calendar.university} ${calendar.academicYear}，共 ${calendar.terms.length} 个学期。`
          : '还没有校历数据，点「更新校历」从学校官网拉取。'}
        {course.weekly?.length
          ? ''
          : '　先把大纲里的周次确认写入，这里才能按周排日期。'}
      </p>

      <div className="field-row" style={{ maxWidth: 860 }}>
        <div className="field">
          <label htmlFor="sp-term">学期</label>
          <select
            id="sp-term"
            value={term?.id || ''}
            onChange={(event) => setTermId(event.target.value)}
          >
            {(calendar?.terms || []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.teachingStart ? `（${item.teachingStart} 开学）` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sp-weekday">每周上课日</label>
          <select
            id="sp-weekday"
            value={slot.weekday}
            onChange={(event) => setSlot({ ...slot, weekday: Number(event.target.value) })}
          >
            {WEEKDAYS.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sp-start">开始时间</label>
          <input
            id="sp-start"
            value={slot.start}
            onChange={(event) => setSlot({ ...slot, start: event.target.value })}
            placeholder="14:00"
          />
        </div>
        <div className="field">
          <label htmlFor="sp-end">结束时间</label>
          <input
            id="sp-end"
            value={slot.end}
            onChange={(event) => setSlot({ ...slot, end: event.target.value })}
            placeholder="16:00"
          />
        </div>
        <div className="field">
          <label htmlFor="sp-location">上课地点</label>
          <input
            id="sp-location"
            value={slot.location}
            onChange={(event) => setSlot({ ...slot, location: event.target.value })}
            placeholder="E21-1005f"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="muted">
          {course.weekly?.length
            ? '校历或学期还没选好。'
            : '还没有周次数据。先在时间轴页确认课程大纲的提取结果并写入课程。'}
        </p>
      ) : (
        <>
          <table className="file-table" style={{ maxWidth: 960 }}>
            <thead>
              <tr>
                <th style={{ width: 70 }}>周次</th>
                <th style={{ width: 120 }}>日期</th>
                <th>主题</th>
                <th style={{ width: 190 }}>假期冲突</th>
                <th style={{ width: 210 }}>处理</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.week}>
                  <td className="mono">第 {row.week} 周</td>
                  <td className="mono">{row.date}</td>
                  <td>{row.topic}</td>
                  <td>
                    {row.holiday ? (
                      <span className="level-tag" style={{ borderColor: '#e0b3bc', color: 'var(--due)' }}>
                        {row.holiday}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <select
                      value={row.override?.kind || ''}
                      onChange={(event) => {
                        const value = event.target.value
                        if (!value) clearOverride(row.week)
                        else setOverride(row.week, { kind: value as OverrideKind })
                      }}
                      style={{ width: '100%' }}
                    >
                      <option value="">正常上课</option>
                      {KINDS.map((kind) => (
                        <option key={kind.value} value={kind.value}>
                          {kind.label}
                        </option>
                      ))}
                    </select>
                    {row.override?.kind === 'moved' && (
                      <input
                        type="date"
                        value={row.override.date}
                        onChange={(event) => setOverride(row.week, { date: event.target.value })}
                        style={{ width: '100%', marginTop: 4 }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
            <button className="btn" type="button" onClick={() => void save()} disabled={busy}>
              保存排课
            </button>
            <button className="btn btn--primary" type="button" onClick={() => void buildTimeline()} disabled={busy}>
              按周次写入时间轴
            </button>
            {message && <span className="mono">{message}</span>}
          </div>
          <p className="section-hint" style={{ marginTop: 10 }}>
            被取消的周不会写进时间轴；标记为「延期」的按你填的日期写入；其他节点（考试、作业截止）保留不动。
          </p>
        </>
      )}
    </section>
  )
}
