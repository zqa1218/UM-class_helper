import { useCallback, useEffect, useState } from 'react'

import { api } from '../api'
import type { FileEntry } from '../types'
import Markdown from './Markdown'

interface Props {
  courseId: string
  stage: string
  title: string
  hint: string
  emptyHint: string
  prefer?: string[]
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i

export default function DocumentBrowser({
  courseId,
  stage,
  title,
  hint,
  emptyHint,
  prefer = [],
}: Props) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<string>('')
  const [content, setContent] = useState<string>('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { files: list } = await api.listFiles(courseId, stage)
      const sorted = [...list].sort((a, b) => {
        const ai = prefer.indexOf(a.name)
        const bi = prefer.indexOf(b.name)
        if (ai !== -1 || bi !== -1) {
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
        }
        return b.modified.localeCompare(a.modified)
      })
      setFiles(sorted)
      setSelected((current) => {
        if (current && sorted.some((file) => file.path === current)) return current
        return sorted[0]?.path || ''
      })
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [courseId, stage, prefer])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!selected) {
      setContent('')
      return
    }
    if (IMAGE.test(selected)) return
    let alive = true
    api
      .readText(courseId, `${stage}/${selected}`)
      .then(({ text }) => {
        if (alive) setContent(text)
      })
      .catch((err: unknown) => {
        if (alive) setContent(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [courseId, stage, selected])

  const current = files.find((file) => file.path === selected)
  const isImage = selected ? IMAGE.test(selected) : false
  const isJson = selected.toLowerCase().endsWith('.json')

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 className="section-title">{title}</h2>
        <button className="btn" type="button" onClick={() => void load()}>
          刷新
        </button>
      </div>
      <p className="section-hint">{hint}</p>

      {error && (
        <p className="notice notice--due" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="muted">正在读取…</p>
      ) : files.length === 0 ? (
        <div className="empty">{emptyHint}</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
            {files.map((file) => (
              <button
                key={file.path}
                type="button"
                className="btn"
                aria-pressed={file.path === selected}
                onClick={() => setSelected(file.path)}
                style={
                  file.path === selected
                    ? { borderColor: 'var(--signal)', background: 'var(--signal-soft)' }
                    : undefined
                }
              >
                {file.path}
              </button>
            ))}
          </div>

          {current && (
            <p className="mono" style={{ marginBottom: 12 }}>
              {current.path} · {current.sizeLabel} · {current.modified.slice(0, 19).replace('T', ' ')}
            </p>
          )}

          {isImage ? (
            <img
              src={api.rawUrl(courseId, `${stage}/${selected}`)}
              alt={selected}
              style={{ maxWidth: '100%', border: '1px solid var(--line)', borderRadius: 4 }}
            />
          ) : isJson ? (
            <pre className="job-log">{formatJson(content)}</pre>
          ) : selected.endsWith('.md') ? (
            <Markdown text={content} courseId={courseId} baseDir={stage} />
          ) : (
            <pre className="job-log">{content}</pre>
          )}
        </>
      )}
    </section>
  )
}

function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
