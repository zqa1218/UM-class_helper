import mermaid from 'mermaid'

import { api } from '../api'
import { useLoader } from '../loader'
import Panel from './Panel'

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

interface Rendered {
  files: { path: string; name: string }[]
  svg: string[]
}

/** 读 08_graph 下的 Mermaid 代码块并渲染成 SVG；渲染不了的块跳过，不打断整页。 */
async function renderGraph(courseId: string): Promise<Rendered> {
  const { files } = await api.listFiles(courseId, '08_graph')
  const svg: string[] = []
  for (const file of files.filter((entry) => entry.ext === '.md' || entry.ext === '.mmd')) {
    const { text } = await api.readText(courseId, `08_graph/${file.path}`)
    const blocks = extractBlocks(text)
    for (let index = 0; index < blocks.length; index += 1) {
      try {
        const result = await mermaid.render(
          `graph-${file.name.replace(/\W/g, '')}-${index}`,
          blocks[index],
        )
        svg.push(result.svg)
      } catch {
        /* 跳过渲染失败的块 */
      }
    }
  }
  return { files, svg }
}

export default function GraphView({ courseId }: Props) {
  const { data, error, loading, reload } = useLoader(() => renderGraph(courseId), [courseId])
  const files = data?.files || []
  const svg = data?.svg || []

  const emptyMessage = files.length
    ? '08_graph 里有文件，但没找到能渲染的 Mermaid 代码块。检查文件里是否有 ```mermaid 包裹。'
    : '还没有图谱。跑一次「生成知识图谱」任务，前置是先有大纲。'

  return (
    <Panel
      title="知识图谱"
      hint="从 08_graph 目录的 Mermaid 代码渲染。节点按知识点编号组织，不画装饰。"
      onRefresh={() => void reload()}
      error={error}
      loading={loading}
      loadingText="正在渲染…"
      empty={svg.length ? undefined : emptyMessage}
    >
      {svg.map((markup, index) => (
        <div className="graph-box" key={index} dangerouslySetInnerHTML={{ __html: markup }} />
      ))}
    </Panel>
  )
}
