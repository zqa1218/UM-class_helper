import { useRef, useState } from 'react'

import type { Course } from '../types'

interface Props {
  onCreate: (payload: Partial<Course>, files: File[]) => Promise<void>
  onCancel: () => void
}

export default function NewCourse({ onCreate, onCancel }: Props) {
  const [form, setForm] = useState({
    name: '',
    term: '',
    teacher: '',
    startDate: '',
    endDate: '',
    description: '',
    keywords: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (!form.name.trim()) {
      setError('先给课程起个名字，提取完成后可以再改')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onCreate({
        name: form.name.trim(),
        term: form.term.trim(),
        teacher: form.teacher.trim(),
        startDate: form.startDate,
        endDate: form.endDate,
        description: form.description.trim(),
        keywords: form.keywords
          .split(/[,，\s]+/)
          .map((item) => item.trim())
          .filter(Boolean),
      }, files)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 620 }}>
      <h2 className="section-title">新建课程</h2>
      <p className="section-hint">
        每门课是独立项目。学校通知、教学大纲或课程介绍传上来，课程名以外的信息会由文件自动读出来，确认后再写入。
      </p>
      <div className="field">
        <label htmlFor="nc-name">课程名（必填，可以先用临时名字）</label>
        <input
          id="nc-name"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="认知神经科学"
        />
      </div>

      <div className="field">
        <label htmlFor="nc-files">课程资料文件</label>
        <div
          className="dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            setFiles((current) => [...current, ...Array.from(event.dataTransfer.files)])
          }}
        >
          <p style={{ margin: '0 0 6px' }}>把学校通知、教学大纲、课程介绍拖到这里，或</p>
          <button className="btn btn--primary" type="button" onClick={() => inputRef.current?.click()}>
            选择文件
          </button>
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
            支持 PDF、Word、图片、纯文本。可以一次传多个，之后也能继续补。
          </p>
          <input
            id="nc-files"
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files) {
                setFiles((current) => [...current, ...Array.from(event.target.files || [])])
              }
              event.target.value = ''
            }}
          />
        </div>
        {files.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="mono">
                {file.name}　
                <button
                  className="btn btn--danger"
                  type="button"
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details style={{ marginTop: 18 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--ink-500)', fontSize: 13 }}>
          也可以现在直接填（不填就等文件提取）
        </summary>
        <div style={{ marginTop: 14 }}>
      <div className="field-row">
        <div className="field">
          <label htmlFor="nc-term">学期</label>
          <input
            id="nc-term"
            value={form.term}
            onChange={(event) => setForm({ ...form, term: event.target.value })}
            placeholder="2026 秋"
          />
        </div>
        <div className="field">
          <label htmlFor="nc-teacher">授课教师</label>
          <input
            id="nc-teacher"
            value={form.teacher}
            onChange={(event) => setForm({ ...form, teacher: event.target.value })}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="nc-start">学期开始</label>
          <input
            id="nc-start"
            type="date"
            value={form.startDate}
            onChange={(event) => setForm({ ...form, startDate: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="nc-end">学期结束</label>
          <input
            id="nc-end"
            type="date"
            value={form.endDate}
            onChange={(event) => setForm({ ...form, endDate: event.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="nc-desc">课程简介</label>
        <textarea
          id="nc-desc"
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          placeholder="课程定位、先修要求、考核方式。这段文字会作为整理时的底色。"
        />
      </div>
      <div className="field">
        <label htmlFor="nc-keywords">关键词</label>
        <input
          id="nc-keywords"
          value={form.keywords}
          onChange={(event) => setForm({ ...form, keywords: event.target.value })}
          placeholder="fMRI, ERP, 注意, 记忆"
        />
      </div>
        </div>
      </details>
      {error && (
        <p className="notice notice--due" role="alert">
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button className="btn btn--primary" type="button" onClick={submit} disabled={busy}>
          {busy ? '正在创建…' : files.length ? '创建并提取' : '创建课程'}
        </button>
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>
          取消
        </button>
      </div>
    </div>
  )
}
