import { api } from '../api'
import { useLoader } from '../loader'
import type { Outline, QuizItem } from '../types'
import DocumentBrowser from './DocumentBrowser'
import Panel from './Panel'

interface Props {
  courseId: string
}

interface OutlineData {
  outline: Outline | null
  bank: QuizItem[]
}

/** 大纲与题库一起读；文件缺失不算错误，交给空态处理。 */
async function loadOutlineData(courseId: string): Promise<OutlineData> {
  const [outline, bank] = await Promise.all([
    api.loadOutline(courseId).catch(() => null),
    api.loadBank(courseId).catch(() => [] as QuizItem[]),
  ])
  return { outline, bank }
}

export default function OutlineView({ courseId }: Props) {
  const { data, loading, reload } = useLoader(() => loadOutlineData(courseId), [courseId])
  const outline = data?.outline || null
  const bank = data?.bank || []

  if (loading) return <Panel title="知识点大纲" loading loadingText="正在读取大纲…" />

  if (!outline?.units?.length) {
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
    <Panel
      title="知识点大纲"
      hint={
        <>
          共 {totalPoints} 个知识点，其中 {coveredPoints} 个已经有题。出题范围就按这里的编号说，例如
          「CN03 全部 + CN05-02」。
        </>
      }
      onRefresh={() => void reload()}
    >
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
                  <span className="inline-actions">
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
    </Panel>
  )
}
