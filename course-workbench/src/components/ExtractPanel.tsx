import { useCallback, useEffect, useState } from 'react'

import { api } from '../api'
import { errorMessage } from '../loader'
import { DATE_LIKE, KIND_OPTIONS as KINDS, addDaysIso } from '../milestone'
import type {
  Course,
  ExtractedCourse,
  ExtractedScheduleItem,
  MilestoneKind,
  WeeklyItem,
} from '../types'

const TEXT_FIELDS: { key: keyof ExtractedCourse; label: string; type?: string }[] = [
  { key: 'name', label: '课程名' },
  { key: 'code', label: '课程代码' },
  { key: 'titleEn', label: '英文名' },
  { key: 'titleZh', label: '中文名' },
  { key: 'term', label: '学期' },
  { key: 'teacher', label: '授课教师' },
  { key: 'institution', label: '开课单位' },
  { key: 'prerequisites', label: '先修要求' },
  { key: 'startDate', label: '学期开始', type: 'date' },
  { key: 'endDate', label: '学期结束', type: 'date' },
]

/** 大纲只写周次时，按「学期起始日 + (周次-1) 周」推算每周日期。 */
function weeklyToSchedule(
  weekly: WeeklyItem[] | undefined,
  startDate: string,
): ExtractedScheduleItem[] {
  if (!weekly?.length || !DATE_LIKE.test(startDate)) return []
  return weekly
    .filter((item) => Number(item.week) > 0)
    .map((item) => ({
      date: addDaysIso(startDate, (Number(item.week) - 1) * 7),
      title: `第 ${item.week} 周 · ${item.topic || '未命名主题'}`,
      kind: 'lecture' as MilestoneKind,
      note: item.instructor ? `授课：${item.instructor}` : '',
    }))
}

interface Props {
  course: Course
  onApplied: (course: Course) => void
  onStarted: () => void
}

export default function ExtractPanel({ course, onApplied, onStarted }: Props) {
  const [extracted, setExtracted] = useState<ExtractedCourse | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [schedule, setSchedule] = useState<ExtractedScheduleItem[]>([])
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const kbFiles = course.stages.find((stage) => stage.key === '10_kb')?.files || 0

  const sync = useCallback(async () => {
    try {
      const [{ extracted: data }, { jobs }] = await Promise.all([
        api.loadExtracted(course.id),
        api.listJobs(course.id),
      ])
      setRunning(
        jobs.some(
          (job) =>
            job.stage === 'extract_course' &&
            (job.status === 'running' || job.status === 'queued'),
        ),
      )
      setExtracted(data)
      if (data && !data.appliedAt) {
        setDraft((current) => {
          if (Object.keys(current).length) return current
          const next: Record<string, string> = {}
          for (const field of TEXT_FIELDS) {
            const value = data[field.key]
            next[field.key as string] = typeof value === 'string' ? value : ''
          }
          next.description = typeof data.description === 'string' ? data.description : ''
          next.keywords = Array.isArray(data.keywords) ? data.keywords.join('、') : ''
          return next
        })
        setSchedule((current) => {
          if (current.length) return current
          if (data.schedule?.length) return data.schedule.map((item) => ({ ...item }))
          return weeklyToSchedule(
            data.weekly,
            typeof data.startDate === 'string' ? data.startDate : '',
          )
        })
      }
      setError('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [course.id])

  useEffect(() => {
    void sync()
  }, [sync])

  useEffect(() => {
    if (extracted && !extracted.appliedAt) return
    const timer = window.setInterval(() => {
      void sync()
    }, 4000)
    return () => window.clearInterval(timer)
  }, [extracted, sync])

  const start = async () => {
    setBusy(true)
    try {
      await api.createJob(course.id, {
        stage: 'extract_course',
        title: '从文件提取课程信息',
      })
      setRunning(true)
      onStarted()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const apply = async (dismiss: boolean) => {
    setBusy(true)
    try {
      const { course: updated } = await api.applyExtracted(course.id, {
        dismiss,
        mode,
        // 面板里的值是用户看过并改过的，提交即采用
        overwrite: !dismiss,
        fields: dismiss
          ? undefined
          : {
              ...draft,
              keywords: draft.keywords
                ? draft.keywords.split(/[、,，\s]+/).filter(Boolean)
                : [],
              instructors: extracted?.instructors || [],
              cilos: extracted?.cilos || [],
              assessment: extracted?.assessment || [],
              weekly: extracted?.weekly || [],
              textbooks: extracted?.textbooks || [],
              references: extracted?.references || [],
              almanacUrl: extracted?.almanacUrl || '',
              schedule,
            },
      })
      onApplied(updated)
      setExtracted((current) => (current ? { ...current, appliedAt: 'now' } : current))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const updateRow = (index: number, patch: Partial<ExtractedScheduleItem>) => {
    setSchedule((current) =>
      current.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    )
  }

  if (extracted?.appliedAt) {
    return (
      <p className="notice" style={{ marginBottom: 18 }}>
        课程信息已从 10_kb 的文件写入。
        <button
          className="btn"
          type="button"
          style={{ marginLeft: 10 }}
          onClick={() => void start()}
          disabled={busy || kbFiles === 0}
        >
          重新提取
        </button>
      </p>
    )
  }

  if (!extracted && !running) {
    return (
      <div className="notice" style={{ marginBottom: 18 }}>
        {kbFiles === 0
          ? '还没有课程信息文件。把学校通知、教学大纲或课程介绍传到「材料」里的课程知识库，就能自动读出来。'
          : `课程知识库里有 ${kbFiles} 个文件，可以从里面读出课程名、教师、学期和重要节点。`}
        <button
          className="btn btn--primary"
          type="button"
          style={{ marginLeft: 10 }}
          onClick={() => void start()}
          disabled={busy || kbFiles === 0}
        >
          从文件提取课程信息
        </button>
      </div>
    )
  }

  if (!extracted) {
    return (
      <p className="notice" style={{ marginBottom: 18 }}>
        正在读 10_kb 里的文件…提取完成后这里会列出结果，由你确认再写入课程。
      </p>
    )
  }

  return (
    <section style={{ marginBottom: 26 }}>
      <h2 className="section-title">从文件读到的课程信息</h2>
      <p className="section-hint">
        确认或改完再写入。默认只填空白字段、把新节点加到时间轴上，不覆盖你已经填过的内容。
      </p>

      <div className="field-row" style={{ maxWidth: 760 }}>
        {TEXT_FIELDS.map((field) => {
          const value = draft[field.key as string] || ''
          const useDate = field.type === 'date' && (!value || DATE_LIKE.test(value))
          return (
            <div className="field" key={field.key as string}>
              <label htmlFor={`ex-${field.key as string}`}>{field.label}</label>
              <input
                id={`ex-${field.key as string}`}
                type={useDate ? 'date' : 'text'}
                value={value}
                onChange={(event) => setDraft({ ...draft, [field.key as string]: event.target.value })}
              />
              {extracted.fieldNotes?.[field.key as string] && (
                <span className="field-note" title={extracted.fieldNotes[field.key as string]}>
                  {extracted.fieldNotes[field.key as string]}
                </span>
              )}
            </div>
          )
        })}
      </div>

      <div className="field" style={{ maxWidth: 760 }}>
        <label htmlFor="ex-desc">课程简介</label>
        <textarea
          id="ex-desc"
          value={draft.description || ''}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        />
      </div>

      <div className="field" style={{ maxWidth: 760 }}>
        <label htmlFor="ex-keywords">关键词</label>
        <input
          id="ex-keywords"
          value={draft.keywords || ''}
          onChange={(event) => setDraft({ ...draft, keywords: event.target.value })}
          placeholder="用顿号或逗号分隔"
        />
      </div>

      <div className="notice" style={{ maxWidth: 860 }}>
        档案部分：授课信息 {extracted.instructors?.length || 0} 人 · 学习成果{' '}
        {extracted.cilos?.length || 0} 条 · 考核 {extracted.assessment?.length || 0} 项 · 周次{' '}
        {extracted.weekly?.length || 0} 周 · 教材 {extracted.textbooks?.length || 0} 本 · 参考书{' '}
        {extracted.references?.length || 0} 本。这些会原样写进课程档案。
      </div>

      <h3 className="section-title" style={{ marginTop: 18 }}>
        时间轴节点（{schedule.length} 条）
      </h3>
      {(extracted.weekly?.length || 0) > 0 && (
        <p className="section-hint">
          大纲只写周次时，按「{draft.startDate || '学期开始'} + (周次 − 1) 周」推算。
          <button
            className="btn"
            type="button"
            style={{ marginLeft: 10 }}
            disabled={!DATE_LIKE.test(draft.startDate || '')}
            onClick={() => {
              // 只替换「第 N 周」这种周次节点，考核节点保留，别被覆盖掉
              const weeklyRows = weeklyToSchedule(extracted.weekly, draft.startDate || '')
              const kept = schedule.filter((row) => !/^第\s*\d+\s*周/.test(row.title))
              setSchedule([...weeklyRows, ...kept])
            }}
          >
            按周次重新生成
          </button>
          {!DATE_LIKE.test(draft.startDate || '') && (
            <span className="mono">　先在上面填「学期开始」</span>
          )}
        </p>
      )}
      {schedule.some((row) => !DATE_LIKE.test(row.date)) && (
        <p className="notice notice--due" style={{ maxWidth: 860 }}>
          有 {schedule.filter((row) => !DATE_LIKE.test(row.date)).length} 条节点没有日期。
          时间轴上的节点必须有日期，写入时这些会被跳过——补齐日期，或从表格里删掉。
        </p>
      )}
      {schedule.length === 0 ? (
        <p className="muted">文件里没读到有明确日期的节点。</p>
      ) : (
        <table className="file-table" style={{ maxWidth: 860 }}>
          <thead>
            <tr>
              <th style={{ width: 150 }}>日期</th>
              <th>标题</th>
              <th style={{ width: 110 }}>类型</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {schedule.map((item, index) => (
              <tr key={`${item.date}-${index}`}>
                <td>
                  <input
                    type={DATE_LIKE.test(item.date) ? 'date' : 'text'}
                    value={item.date}
                    onChange={(event) => updateRow(index, { date: event.target.value })}
                    style={{ width: '100%' }}
                  />
                </td>
                <td>
                  <input
                    value={item.title}
                    onChange={(event) => updateRow(index, { title: event.target.value })}
                    style={{ width: '100%' }}
                  />
                </td>
                <td>
                  <select
                    value={item.kind}
                    onChange={(event) =>
                      updateRow(index, { kind: event.target.value as MilestoneKind })
                    }
                    style={{ width: '100%' }}
                  >
                    {KINDS.map((kind) => (
                      <option key={kind.value} value={kind.value}>
                        {kind.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="btn btn--danger"
                    type="button"
                    onClick={() =>
                      setSchedule((current) => current.filter((_, position) => position !== index))
                    }
                  >
                    删
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(extracted.uncertain || []).length > 0 && (
        <div className="notice notice--due" style={{ maxWidth: 860, marginTop: 16 }}>
          <strong>需要你核实：</strong>
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            {extracted.uncertain?.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 18, flexWrap: 'wrap' }}>
        <label className="mono" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={mode === 'replace'}
            onChange={(event) => setMode(event.target.checked ? 'replace' : 'merge')}
          />
          用文件里的节点整体替换现有时间轴
        </label>
        <button className="btn btn--primary" type="button" onClick={() => void apply(false)} disabled={busy}>
          写入课程
        </button>
        <button className="btn" type="button" onClick={() => void apply(true)} disabled={busy}>
          忽略这次提取
        </button>
      </div>

      {error && (
        <p className="notice notice--due" role="alert" style={{ marginTop: 14 }}>
          {error}
        </p>
      )}
    </section>
  )
}
