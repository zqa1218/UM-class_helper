import { useCallback, useEffect, useState } from 'react'

import { api } from '../api'
import type { Outline, QuizItem } from '../types'
import DocumentBrowser from './DocumentBrowser'

interface Props {
  courseId: string
}

export default function OutlineView({ courseId }: Props) {
  const [outline, setOutline] = useState<Outline | null>(null)
  const [bank, setBank] = useState<QuizItem[]>([])
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const parsed = await api.loadOutline(courseId)
      setOutline(parsed)
      setMissing(false)
    } catch {
      setOutline(null)
      setMissing(true)
    }
    try {
      setBank(await api.loadBank(courseId))
    } catch {
      setBank([])
    }
    setLoading(false)
  }, [courseId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <p className="muted">正在读取大纲…</p>

  if (missing || !outline?.units?.length) {
    return (
      <DocumentBrowser
        courseId={courseId}
        stage="06_outline"
        title="知识点大纲"
        hint="还没有结构化大纲时，这里显示该目录下的原始文件。"
        emptyHint="还没有大纲。先跑「生成知识点大纲」任务，或先导入材料并完成转写、解析与纠错。"
        prefer={['outline.md', 'outline.json']}
      />
    )
  }

  const coverage = new Map<string, number>()
  for (const item of bank) {
    for (const point of item.pointIds || []) {
      coverage.set(point, (coverage.get(point) || 0) + 1)
    }
  }
  const totalPoints = outline.units.reduce(
    (sum, unit) =>
      sum + (unit.sections || []).reduce((count, section) => count + (section.points || []).length, 0),
    0,
  )
  const coveredPoints = [...coverage.keys()].filter((id) =>
    outline.units?.some((unit) =>
      (unit.sections || []).some((section) =>
        (section.points || []).some((point) => point.id === id),
      ),
    ),
  ).length

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 className="section-title">知识点大纲</h2>
        <button className="btn" type="button" onClick={() => void load()}>
          刷新
        </button>
      </div>
      <p className="section-hint">
        共 {totalPoints} 个知识点，其中 {coveredPoints} 个已经有题。出题范围就按这里的编号说，例如
        「CN03 全部 + CN05-02」。
      </p>

      {outline.units.map((unit) => (
        <div className="outline-unit" key={unit.id}>
          <div className="outline-unit__head">
            <span className="outline-unit__id">{unit.id}</span>
            <span className="outline-unit__title">{unit.title}</span>
          </div>
          {(unit.sections || []).map((section) => (
            <div key={section.id} style={{ marginTop: 12 }}>
              <div className="mono" style={{ marginBottom: 4 }}>
                {section.id} · {section.title}
              </div>
              {(section.points || []).map((point) => (
                <div className="outline-point" key={point.id}>
                  <span className="outline-point__id">{point.id}</span>
                  <span>
                    <span className="outline-point__title">{point.title}</span>
                    {point.definition && <div className="outline-point__def">{point.definition}</div>}
                    {(point.sources || []).length > 0 && (
                      <div className="outline-point__def mono">
                        来源：{point.sources?.join('；')}
                        {point.hasSupplement ? '　＋补充' : ''}
                      </div>
                    )}
                  </span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {point.level && (
                      <span className="level-tag" data-level={point.level}>
                        {point.level}
                      </span>
                    )}
                    <span className="mono">{coverage.get(point.id) || 0} 题</span>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}
