import { useMemo, useState } from 'react'

import type { Course, Milestone, MilestoneKind } from '../types'

const KIND_LABEL: Record<MilestoneKind, string> = {
  lecture: '讲课',
  deadline: '截止',
  exam: '考试',
  reading: '阅读',
  other: '其他',
}

function parseDate(value: string): number {
  const time = Date.parse(`${value}T00:00:00`)
  return Number.isNaN(time) ? NaN : time
}

function daysUntil(date: string): number {
  const target = parseDate(date)
  if (Number.isNaN(target)) return NaN
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today.getTime()) / 86400000)
}

interface Props {
  course: Course
  onSave: (schedule: Milestone[]) => void
}

export default function Timeline({ course, onSave }: Props) {
  const [draft, setDraft] = useState({
    date: '',
    title: '',
    kind: 'lecture' as MilestoneKind,
    note: '',
  })
  const [adding, setAdding] = useState(false)

  const schedule = course.schedule || []

  const range = useMemo(() => {
    const dates = schedule.map((m) => parseDate(m.date)).filter((n) => !Number.isNaN(n))
    const start = parseDate(course.startDate) || (dates.length ? Math.min(...dates) : NaN)
    const end = parseDate(course.endDate) || (dates.length ? Math.max(...dates) : NaN)
    return { start, end }
  }, [schedule, course.startDate, course.endDate])

  const span = range.end - range.start
  const ratio = (date: string) => {
    const time = parseDate(date)
    if (Number.isNaN(time) || Number.isNaN(span) || span <= 0) return 0
    return Math.min(1, Math.max(0, (time - range.start) / span))
  }

  const todayRatio = (() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (Number.isNaN(span) || span <= 0) return null
    const value = (today.getTime() - range.start) / span
    return value >= 0 && value <= 1 ? value : null
  })()

  const ticks = useMemo(() => {
    if (Number.isNaN(range.start) || Number.isNaN(range.end) || span <= 0) return []
    return Array.from({ length: 9 }, (_, index) => range.start + (span * index) / 8)
  }, [range.start, range.end, span])

  const addMilestone = () => {
    if (!draft.date || !draft.title.trim()) return
    const next: Milestone = {
      id: `m${Date.now().toString(36)}`,
      date: draft.date,
      title: draft.title.trim(),
      kind: draft.kind,
      note: draft.note.trim(),
      done: false,
    }
    onSave([...schedule, next])
    setDraft({ date: '', title: '', kind: 'lecture', note: '' })
    setAdding(false)
  }

  const toggleDone = (id: string) => {
    onSave(schedule.map((m) => (m.id === id ? { ...m, done: !m.done } : m)))
  }

  const remove = (id: string) => {
    onSave(schedule.filter((m) => m.id !== id))
  }

  const next = schedule
    .filter((m) => !m.done && daysUntil(m.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))[0]

  return (
    <section>
      <h2 className="section-title">课程时间轴</h2>
      <p className="section-hint">
        导入教学大纲后由工作台补齐，也可以手动加。日期用 YYYY-MM-DD。
      </p>

      {schedule.length === 0 ? (
        <div className="empty">
          还没有节点。先把课程介绍或教学大纲传进「课程知识库」，或在这里手动添加。
        </div>
      ) : (
        <>
          <div className="band">
            {ticks.map((time, index) => (
              <span
                key={index}
                className="band__tick"
                style={{ left: `${(index / 8) * 100}%`, height: index % 4 === 0 ? '14px' : '8px' }}
              />
            ))}
            {todayRatio !== null && (
              <span className="band__today" style={{ left: `${todayRatio * 100}%` }} />
            )}
            {schedule.map((milestone) => {
              const left = ratio(milestone.date) * 100
              const distance = daysUntil(milestone.date)
              const stemHeight = distance > 60 ? 34 : distance > 21 ? 25 : distance > 7 ? 17 : 10
              return (
                <span
                  key={milestone.id}
                  className="band__marker"
                  data-kind={milestone.kind}
                  data-done={milestone.done}
                  style={{ left: `${left}%` }}
                  title={`${milestone.date} ${milestone.title}`}
                >
                  <span className="band__stem" style={{ height: `${stemHeight}px` }} />
                  <span className="band__dot" />
                </span>
              )
            })}
          </div>
          <div className="band__axis">
            <span>{course.startDate || new Date(range.start).toISOString().slice(0, 10)}</span>
            <span>{course.endDate || new Date(range.end).toISOString().slice(0, 10)}</span>
          </div>
        </>
      )}

      {next && (
        <p className="notice" style={{ marginTop: 18 }}>
          下一个节点：{next.date} {next.title}
          {Number.isFinite(daysUntil(next.date)) && `　还有 ${daysUntil(next.date)} 天`}
        </p>
      )}

      <ul className="milestone-list">
        {schedule.map((milestone) => (
          <li
            className="milestone-row"
            key={milestone.id}
            data-kind={milestone.kind}
            data-done={milestone.done}
          >
            <span className="milestone-row__date">{milestone.date}</span>
            <span className="milestone-row__mark" />
            <span>
              <span className="milestone-row__title">{milestone.title}</span>
              {milestone.note && <div className="milestone-row__note">{milestone.note}</div>}
            </span>
            <span style={{ display: 'flex', gap: 6 }}>
              <span className="mono">{KIND_LABEL[milestone.kind]}</span>
              <button className="btn" type="button" onClick={() => toggleDone(milestone.id)}>
                {milestone.done ? '撤销' : '完成'}
              </button>
              <button className="btn btn--danger" type="button" onClick={() => remove(milestone.id)}>
                删除
              </button>
            </span>
          </li>
        ))}
      </ul>

      <hr className="rule" />

      {adding ? (
        <div style={{ maxWidth: 560 }}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="ms-date">日期</label>
              <input
                id="ms-date"
                type="date"
                value={draft.date}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="ms-kind">类型</label>
              <select
                id="ms-kind"
                value={draft.kind}
                onChange={(event) =>
                  setDraft({ ...draft, kind: event.target.value as MilestoneKind })
                }
              >
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="ms-title">标题</label>
            <input
              id="ms-title"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="第 3 讲 · 事件相关电位基础"
            />
          </div>
          <div className="field">
            <label htmlFor="ms-note">备注</label>
            <input
              id="ms-note"
              value={draft.note}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
              placeholder="预习材料、提交要求等"
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--primary" type="button" onClick={addMilestone}>
              添加节点
            </button>
            <button className="btn" type="button" onClick={() => setAdding(false)}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <button className="btn" type="button" onClick={() => setAdding(true)}>
          添加节点
        </button>
      )}
    </section>
  )
}
