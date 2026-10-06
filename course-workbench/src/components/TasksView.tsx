import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { errorMessage, useLoader } from '../loader'
import type { StageTask } from '../types'
import Panel from './Panel'

interface Props {
  courseId: string
  onFinished: () => void
}

const STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '进行中',
  done: '已完成',
  failed: '失败',
  interrupted: '已中断',
  canceled: '已取消',
}

export default function TasksView({ courseId, onFinished }: Props) {
  const [tasks, setTasks] = useState<StageTask[]>([])
  const [selected, setSelected] = useState('')
  const [log, setLog] = useState('')
  const [instruction, setInstruction] = useState('')
  const [sandbox, setSandbox] = useState('')
  const finishedRef = useRef<Set<string>>(new Set())

  const { data, error, reload: loadJobs, setError } = useLoader(
    async () => (await api.listJobs(courseId)).jobs,
    [courseId],
  )
  const jobs = data || []

  useEffect(() => {
    void api
      .health()
      .then((health) => setSandbox(health.codexSandbox || ''))
      .catch(() => undefined)
    void api
      .stages()
      .then((result) => setTasks(result.tasks))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const active = jobs.some((job) => job.status === 'running' || job.status === 'queued')
    if (!active) return
    const timer = window.setInterval(() => {
      void loadJobs()
    }, 2500)
    return () => window.clearInterval(timer)
  }, [jobs, loadJobs])

  useEffect(() => {
    if (!selected) {
      setLog('')
      return
    }
    let alive = true
    const tick = async () => {
      try {
        const { job, log: text } = await api.getJob(courseId, selected)
        if (!alive) return
        setLog(text)
        if (
          (job.status === 'done' || job.status === 'failed') &&
          !finishedRef.current.has(job.id)
        ) {
          finishedRef.current.add(job.id)
          onFinished()
        }
      } catch (err) {
        if (alive) setLog(errorMessage(err))
      }
    }
    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, 2500)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [courseId, selected, onFinished])

  const run = async (stage: string, title: string) => {
    try {
      const { job } = await api.createJob(courseId, {
        stage,
        title,
        instruction: instruction.trim(),
      })
      setSelected(job.id)
      setInstruction('')
      await loadJobs()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const current = jobs.find((job) => job.id === selected) || null

  return (
    <Panel
      title="整理任务"
      hint="每个任务会调起一次 Codex 会话，在课程目录里按流水线技能执行，产物直接落到对应目录。一次只跑一个，排在后面的会等前面结束。"
      error={error}
    >
      {sandbox === 'danger-full-access' && (
        <p className="notice notice--due" style={{ marginBottom: 16 }}>
          当前沙箱模式是 danger-full-access：任务里的 Codex 可以读写本机任意文件，不再限制在课程目录内。
          本机的沙箱助手因为 .codex\.sandbox-bin 权限问题用不了 workspace-write，所以先这样跑。
          想收紧的话，用管理员权限执行一次 icacls "%USERPROFILE%\.codex\.sandbox-bin" /setowner "%USERNAME%"，
          再把 workbench.config.json 里的 codexSandbox 改回 workspace-write。
        </p>
      )}

      <div className="field" style={{ maxWidth: 620 }}>
        <label htmlFor="task-instruction">附加要求（可选）</label>
        <textarea
          id="task-instruction"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="例：只处理第 5 讲；出题范围 CN03 全部，20 道单选、5 道多选，难度中等。"
        />
      </div>


      <div className="task-grid">
        {tasks.map((task) => (
          <div className="task" key={task.key}>
            <span className="task__key">{task.key}</span>
            <span className="task__title">{task.title}</span>
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => void run(task.key, task.title)}
            >
              运行
            </button>
          </div>
        ))}
        <div className="task">
          <span className="task__key">full</span>
          <span className="task__title">一条龙：材料到笔记</span>
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => void run('full', '一条龙：材料到笔记')}
          >
            运行
          </button>
        </div>
      </div>

      <hr className="rule" />

      <h3 className="section-title">运行记录</h3>
      {jobs.length === 0 ? (
        <p className="muted">还没有跑过任务。</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
          {jobs.map((job) => (
            <li className="milestone-row" key={job.id}>
              <span className="mono">{job.createdAt.slice(0, 16).replace('T', ' ')}</span>
              <span className="status" data-status={job.status}>
                {STATUS_LABEL[job.status] || job.status}
              </span>
              <span>
                <span className="milestone-row__title">{job.title}</span>
                {job.error && <div className="milestone-row__note">{job.error}</div>}
              </span>
              <span className="inline-actions">
                <button className="btn" type="button" onClick={() => setSelected(job.id)}>
                  看日志
                </button>
                {(job.status === 'running' || job.status === 'queued') && (
                  <button
                    className="btn btn--danger"
                    type="button"
                    onClick={() => void api.cancelJob(courseId, job.id).then(() => loadJobs())}
                  >
                    停止
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {current && (
        <>
          <h3 className="section-title" style={{ marginTop: 24 }}>
            {current.title} · {current.id}
          </h3>
          {current.summary && <div className="notice" style={{ marginBottom: 12 }}>{current.summary}</div>}
          <pre className="job-log">{log || '日志还在写入…'}</pre>
        </>
      )}
    </Panel>
  )
}
