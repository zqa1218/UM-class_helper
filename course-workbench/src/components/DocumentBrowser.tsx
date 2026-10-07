import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { api } from '../api'
import { errorMessage, useLoader } from '../loader'
import type { FileEntry } from '../types'
import Markdown from './Markdown'
import Panel from './Panel'

interface Props {
  courseId: string
  stage: string
  title: string
  hint: string
  emptyHint: string
  prefer?: string[]
  /** 固定显示在文件列表上方的内容（由 Panel 原样透传） */
  extra?: ReactNode
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i

/** 常用文件排前面，其余的按修改时间倒序。 */
function sortFiles(files: FileEntry[], prefer: string[]): FileEntry[] {
  return [...files].sort((a, b) => {
    const ai = prefer.indexOf(a.name)
    const bi = prefer.indexOf(b.name)
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    }
    return b.modified.localeCompare(a.modified)
  })
}

export default function DocumentBrowser({
  courseId,
  stage,
  title,
  hint,
  emptyHint,
  prefer = [],
  extra,
}: Props) {
  const preferKey = prefer.join(',')
  const { data, error, loading, reload } = useLoader(
    async () => sortFiles((await api.listFiles(courseId, stage)).files, prefer),
    [courseId, stage, preferKey],
  )
  const files = useMemo(() => data || [], [data])
  const [selected, setSelected] = useState('')
  const [content, setContent] = useState('')

  useEffect(() => {
    setSelected((current) =>
      current && files.some((file) => file.path === current) ? current : files[0]?.path || '',
    )
  }, [files])

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
        if (alive) setContent(errorMessage(err))
      })
    return () => {
      alive = false
    }
  }, [courseId, stage, selected])

  const current = files.find((file) => file.path === selected)
  const isImage = selected ? IMAGE.test(selected) : false
  const isJson = selected.toLowerCase().endsWith('.json')

  return (
    <Panel
      title={title}
      hint={hint}
      extra={extra}
      onRefresh={() => void reload()}
      error={error}
      loading={loading}
      empty={files.length === 0 ? emptyHint : undefined}
    >
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
        {files.map((file) => (
          <button
            key={file.path}
            type="button"
            className="btn"
            aria-pressed={file.path === selected}
            onClick={() => setSelected(file.path)}
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
    </Panel>
  )
}

function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
