import mermaid from 'mermaid'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../api'
import type { FileEntry } from '../types'

mermaid.initialize({ startOnLoad: false, theme: 'neutral', fontFamily: 'inherit' })

interface Props {
  courseId: string
}

function extractBlocks(text: string): string[] {
  const blocks: string[] = []
  const pattern = /```mermaid\s*([\s\S]*?)```/g
  let match = pattern.exec(text)
  while (match) {
    blocks.push(match[1].trim())
    match = pattern.exec(text)
  }
  if (!blocks.length && /^\s*(graph|flowchart|mindmap|classDiagram)\b/m.test(text)) {
    blocks.push(text.trim())
  }
  return blocks
}

export default function GraphView({ courseId }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [svg, setSvg] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setSvg([])
    try {
      const { files: list } = await api.listFiles(courseId, '08_graph')
      setFiles(list)
      const rendered: string[] = []
      for (const file of list.filter((entry) => entry.ext === '.md' || entry.ext === '.mmd')) {
        const { text } = await api.readText(courseId, `08_graph/${file.path}`)
        const blocks = extractBlocks(text)
        for (let index = 0; index < blocks.length; index += 1) {
          try {
            const result = await mermaid.render(
              `graph-${file.name.replace(/\W/g, '')}-${index}`,
              blocks[index],
            )
            rendered.push(result.svg)
          } catch {
            rendered.push('')
          }
        }
      }
      setSvg(rendered.filter(Boolean))
      if (!list.length) setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 className="section-title">知识图谱</h2>
        <button className="btn" type="button" onClick={() => void load()}>
          刷新
        </button>
      </div>
      <p className="section-hint">
        从 08_graph 目录的 Mermaid 代码渲染。节点按知识点编号组织，不画装饰。
      </p>

      {error && (
        <p className="notice notice--due" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="muted">正在渲染…</p>
      ) : files.length === 0 ? (
        <div className="empty">还没有图谱。跑一次「生成知识图谱」任务，前置是先有大纲。</div>
      ) : svg.length === 0 ? (
        <div className="empty">
          08_graph 里有文件，但没找到能渲染的 Mermaid 代码块。检查文件里是否有 ```mermaid 包裹。
        </div>
      ) : (
        svg.map((markup, index) => (
          <div
            className="graph-box"
            key={index}
            style={{ marginBottom: 16 }}
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        ))
      )}
    </section>
  )
}
