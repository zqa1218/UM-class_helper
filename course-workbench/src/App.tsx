import { useCallback, useEffect, useState } from 'react'

import { api } from './api'
import CourseProfile from './components/CourseProfile'
import DocumentBrowser from './components/DocumentBrowser'
import ExtractPanel from './components/ExtractPanel'
import GraphView from './components/GraphView'
import Materials from './components/Materials'
import NewCourse from './components/NewCourse'
import OutlineView from './components/OutlineView'
import QuizView from './components/QuizView'
import SchedulePanel from './components/SchedulePanel'
import TasksView from './components/TasksView'
import Timeline from './components/Timeline'
import type { Course, Milestone } from './types'

type TabKey = 'overview' | 'materials' | 'outline' | 'records' | 'notes' | 'graph' | 'quiz' | 'tasks'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '时间轴' },
  { key: 'materials', label: '材料' },
  { key: 'outline', label: '大纲' },
  { key: 'records', label: '校对' },
  { key: 'notes', label: '笔记' },
  { key: 'graph', label: '图谱' },
  { key: 'quiz', label: '题库' },
  { key: 'tasks', label: '任务' },
]

const RECORD_STAGES = [
  { key: '03_align', label: '页与讲述对齐' },
  { key: '04_corrections', label: '纠错清单' },
  { key: '05_supplements', label: '学科补充' },
]

const KIND_TEXT: Record<string, string> = {
  lecture: '讲课',
  deadline: '截止',
  exam: '考试',
  reading: '阅读',
  other: '其他',
}

function daysUntil(date: string): number {
  const target = Date.parse(`${date}T00:00:00`)
  if (Number.isNaN(target)) return NaN
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today.getTime()) / 86400000)
}

export default function App() {
  const [courses, setCourses] = useState<Course[]>([])
  const [current, setCurrent] = useState<Course | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')
  const [creating, setCreating] = useState(false)
  const [recordStage, setRecordStage] = useState(RECORD_STAGES[0].key)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(
    async (keepId?: string) => {
      try {
        const { courses: list } = await api.listCourses()
        setCourses(list)
        const target = keepId || current?.id
        const found = list.find((course) => course.id === target) || list[0] || null
        if (found) {
          const { course } = await api.getCourse(found.id)
          setCurrent(course)
        } else {
          setCurrent(null)
        }
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setReady(true)
      }
    },
    [current?.id],
  )

  useEffect(() => {
    void refresh()
    // 只在首次挂载时拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectCourse = async (id: string) => {
    setCreating(false)
    setTab('overview')
    const { course } = await api.getCourse(id)
    setCurrent(course)
  }

  const createCourse = async (payload: Partial<Course>, files: File[]) => {
    const { course } = await api.createCourse(payload)
    for (const file of files) {
      await api.upload(course.id, '10_kb', file)
    }
    setCreating(false)
    setTab('overview')
    if (files.length) {
      await api.createJob(course.id, {
        stage: 'extract_course',
        title: '从文件提取课程信息',
      })
    }
    await refresh(course.id)
  }

  const runExtract = async () => {
    if (!current) return
    try {
      await api.createJob(current.id, {
        stage: 'extract_course',
        title: '从文件提取课程信息',
      })
      setTab('overview')
      await refresh(current.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const saveSchedule = async (schedule: Milestone[]) => {
    if (!current) return
    const { course } = await api.updateCourse(current.id, { schedule })
    setCurrent(course)
    setCourses((list) => list.map((entry) => (entry.id === course.id ? course : entry)))
  }

  const removeCourse = async () => {
    if (!current) return
    const confirmed = window.confirm(
      `删除「${current.name}」？课程目录和里面的材料、笔记、题库都会一起删掉，无法撤销。`,
    )
    if (!confirmed) return
    await api.deleteCourse(current.id)
    setCurrent(null)
    await refresh('')
  }

  const next = current?.nextMilestone || null
  const distance = next ? daysUntil(next.date) : NaN

  return (
    <div className="app">
      <aside className="spine">
        <div className="spine__brand">
          <span className="spine__title">课程工作台</span>
          <span className="spine__sub">course workbench</span>
        </div>

        <div>
          <div className="spine__label">课程</div>
          <div className="course-list">
            {courses.map((course) => (
              <button
                key={course.id}
                type="button"
                className="course-chip"
                aria-current={current?.id === course.id}
                onClick={() => void selectCourse(course.id)}
              >
                <span className="course-chip__name">{course.name}</span>
                <span className="course-chip__meta">
                  {course.pointCount} 知识点 · {course.quizCount} 题
                </span>
              </button>
            ))}
            <button
              type="button"
              className="course-chip"
              aria-current={creating}
              onClick={() => {
                setCreating(true)
                setCurrent(null)
              }}
            >
              <span className="course-chip__name">＋ 新建课程</span>
              <span className="course-chip__meta">每门课一个独立项目</span>
            </button>
          </div>
        </div>

        {current && (
          <div>
            <div className="spine__label">流水线进度</div>
            <div className="stage-rail">
              {current.stages.map((stage) => (
                <span
                  key={stage.key}
                  className="stage-pill"
                  data-state={stage.files > 0 ? 'ready' : 'empty'}
                  title={`${stage.label} · ${stage.files} 个文件`}
                >
                  {stage.key.slice(0, 2)}
                </span>
              ))}
            </div>
          </div>
        )}

        {next && (
          <div className="milestone-callout" data-kind={next.kind}>
            <div className="spine__label">下一个节点 · {KIND_TEXT[next.kind]}</div>
            <div className="milestone-callout__date">
              {Number.isFinite(distance) ? (distance >= 0 ? `${distance} 天` : '已过') : '—'}
            </div>
            <div className="milestone-callout__title">
              {next.date}　{next.title}
            </div>
          </div>
        )}
      </aside>

      <main className="main">
        {error && (
          <div className="panel">
            <p className="notice notice--due" role="alert">
              读取失败：{error}
            </p>
          </div>
        )}

        {creating ? (
          <div className="panel">
            <NewCourse
              onCreate={createCourse}
              onCancel={() => {
                setCreating(false)
                void refresh()
              }}
            />
          </div>
        ) : !ready ? (
          <div className="panel">
            <p className="muted">正在连接本地服务…</p>
          </div>
        ) : !current ? (
          <div className="panel">
            <h2 className="section-title">还没有课程</h2>
            <p className="section-hint">
              每门课是一个独立项目：先建课程、导入课程介绍和教学大纲，之后每次课把录音与课件丢进「材料」，
              再跑任务生成大纲、笔记和题库。
            </p>
            <button className="btn btn--primary" type="button" onClick={() => setCreating(true)}>
              新建课程
            </button>
          </div>
        ) : (
          <>
            <header className="course-header">
              <div className="course-header__top">
                <h1 className="course-header__name">{current.name}</h1>
                <span className="course-header__term">
                  {current.code ? `${current.code} · ` : ''}
                  {current.term || '未填学期'}
                  {current.teacher ? ` · ${current.teacher}` : ''}
                </span>
              </div>
              {current.description && <p className="course-header__desc">{current.description}</p>}
              <div className="stat-row">
                <span className="stat">
                  <span className="stat__value">{current.materialCount}</span>
                  <span className="stat__label">材料</span>
                </span>
                <span className="stat">
                  <span className="stat__value">{current.pointCount}</span>
                  <span className="stat__label">知识点</span>
                </span>
                <span className="stat">
                  <span className="stat__value">{current.quizCount}</span>
                  <span className="stat__label">题目</span>
                </span>
                <span className="stat">
                  <span className="stat__value">
                    {current.doneMilestones}/{current.milestoneCount}
                  </span>
                  <span className="stat__label">节点完成</span>
                </span>
                <span style={{ marginLeft: 'auto' }}>
                  <button className="btn btn--danger" type="button" onClick={() => void removeCourse()}>
                    删除课程
                  </button>
                </span>
              </div>
            </header>

            <nav className="tabs" role="tablist">
              {TABS.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  role="tab"
                  className="tab"
                  aria-selected={tab === entry.key}
                  onClick={() => setTab(entry.key)}
                >
                  {entry.label}
                </button>
              ))}
            </nav>

            <div className="panel">
              {tab === 'overview' && (
                <>
                  <ExtractPanel
                    key={current.id}
                    course={current}
                    onApplied={(course) => {
                      setCurrent(course)
                      setCourses((list) =>
                        list.map((entry) => (entry.id === course.id ? course : entry)),
                      )
                    }}
                    onStarted={() => void refresh(current.id)}
                  />
                  <Timeline course={current} onSave={saveSchedule} />
                  <hr className="rule" />
                  <SchedulePanel
                    key={`schedule-${current.id}`}
                    course={current}
                    onSaved={(course) => {
                      setCurrent(course)
                      setCourses((list) =>
                        list.map((entry) => (entry.id === course.id ? course : entry)),
                      )
                    }}
                  />
                  <hr className="rule" />
                  <CourseProfile course={current} />
                </>
              )}

              {tab === 'materials' && (
                <Materials
                  course={current}
                  onChanged={() => void refresh(current.id)}
                  onExtract={() => void runExtract()}
                />
              )}

              {tab === 'outline' && <OutlineView courseId={current.id} />}

              {tab === 'records' && (
                <section>
                  <h2 className="section-title">校对与补充</h2>
                  <p className="section-hint">
                    转写稿的可疑处、课件与讲述的冲突、以及带出处的学科补充，都在这里逐条留痕。
                  </p>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
                    {RECORD_STAGES.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        className="btn"
                        aria-pressed={recordStage === entry.key}
                        onClick={() => setRecordStage(entry.key)}
                        style={
                          recordStage === entry.key
                            ? { borderColor: 'var(--signal)', background: 'var(--signal-soft)' }
                            : undefined
                        }
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                  <DocumentBrowser
                    key={recordStage}
                    courseId={current.id}
                    stage={recordStage}
                    title={RECORD_STAGES.find((entry) => entry.key === recordStage)?.label || ''}
                    hint="由任务生成。低置信条目会标「待老师确认」，原文不会被改写。"
                    emptyHint="这个目录还是空的。先跑对应的整理任务。"
                    prefer={['align.md', 'corrections.md', 'supplements.md']}
                  />
                </section>
              )}

              {tab === 'notes' && (
                <DocumentBrowser
                  courseId={current.id}
                  stage="07_notes"
                  title="笔记与讲课流程"
                  hint="图文笔记、讲课流程、一页总结都在这里；图会直接内嵌显示。"
                  emptyHint="还没有笔记。先有转写和课件解析，再跑「写笔记、讲课流程与总结」。"
                  prefer={['notes.md', 'lecture-flow.md', 'summary.md']}
                />
              )}

              {tab === 'graph' && <GraphView courseId={current.id} />}

              {tab === 'quiz' && <QuizView courseId={current.id} />}

              {tab === 'tasks' && (
                <TasksView courseId={current.id} onFinished={() => void refresh(current.id)} />
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
