import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api'
import { errorMessage, useLoader } from '../loader'
import type { Course, FileEntry } from '../types'
import Panel from './Panel'

type StageKey = '00_source' | '10_kb'

const STAGE_OPTIONS: { key: StageKey; label: string; hint: string }[] = [
  { key: '00_source', label: '本次课材料', hint: '按周次归位' },
  { key: '10_kb', label: '课程知识库', hint: '课程介绍、教学大纲、教材' },
]

const UNFILED = '__unfiled__'

interface WeekRow {
  week: number
  topic: string
  date: string
  folder: string
  cancelled: boolean
}

interface Props {
  course: Course
  onChanged: () => void
  onExtract?: () => void
}

export default function Materials({ course, onChanged, onExtract }: Props) {
  const [stage, setStage] = useState<StageKey>('00_source')
  const [selected, setSelected] = useState<string>('')
  const [dragging, setDragging] = useState(false)
  const [uploads, setUploads] = useState<{ name: string; state: string }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: fileData, error, reload: load } = useLoader(
    async () => (await api.listFiles(course.id, stage)).files,
    [course.id, stage],
  )
  const files = useMemo(() => fileData || [], [fileData])

  const { data: bookData, reload: loadBooks } = useLoader(async () => {
    if (stage !== '10_kb') return null
    return (await api.listTextbooks(course.id)).books
  }, [course.id, stage])
  const books = bookData || []

  const weeks = useMemo<WeekRow[]>(() => {
    const nodes = course.schedule || []
    const source =
      (course.weekly || []).length > 0
        ? (course.weekly || []).map((item, index) => ({
            week: item.week ?? index + 1,
            topic: item.topic || '',
          }))
        : nodes
            .map((node) => {
              const match = /^第\s*(\d+)\s*周/.exec(node.title)
              return match
                ? { week: Number(match[1]), topic: node.title.replace(/^第\s*\d+\s*周\s*·?\s*/, '') }
                : null
            })
            .filter((item): item is { week: number; topic: string } => item !== null)

    return source
      .sort((a, b) => a.week - b.week)
      .map((item) => {
        const node = nodes.find((entry) =>
          new RegExp(`^第\\s*${item.week}\\s*周`).test(entry.title),
        )
        const override = (course.weekOverrides || []).find((entry) => entry.week === item.week)
        return {
          week: item.week,
          topic: item.topic,
          date: override?.kind === 'moved' && override.date ? override.date : node?.date || '',
          folder: `week-${String(item.week).padStart(2, '0')}`,
          cancelled: override?.kind === 'cancelled',
        }
      })
  }, [course.weekly, course.schedule, course.weekOverrides])

  // 默认选中第一个还没材料的课时，省得每次手动点
  useEffect(() => {
    if (stage !== '00_source') {
      setSelected('')
      return
    }
    setSelected((current) => {
      if (current) return current
      if (!weeks.length) return UNFILED
      const firstEmpty = weeks.find(
        (row) => !files.some((file) => file.path.startsWith(`${row.folder}/`)),
      )
      return (firstEmpty || weeks[0]).folder
    })
  }, [stage, weeks, files])

  const grouped = useMemo(() => {
    const map = new Map<string, FileEntry[]>()
    for (const file of files) {
      const folder = file.path.includes('/') ? file.path.split('/')[0] : UNFILED
      const list = map.get(folder) || []
      list.push(file)
      map.set(folder, list)
    }
    return map
  }, [files])

  const send = async (list: FileList | File[]) => {
    const items = Array.from(list)
    if (!items.length) return
    const rel = stage === '00_source' && selected !== UNFILED ? selected : ''
    setUploads(items.map((file) => ({ name: file.name, state: '等待上传' })))
    for (let index = 0; index < items.length; index += 1) {
      const file = items[index]
      setUploads((current) =>
        current.map((item, i) => (i === index ? { ...item, state: '上传中…' } : item)),
      )
      try {
        await api.upload(course.id, stage, file, rel)
        setUploads((current) =>
          current.map((item, i) => (i === index ? { ...item, state: '已入库' } : item)),
        )
      } catch (err) {
          const message = errorMessage(err)
        setUploads((current) =>
          current.map((item, i) => (i === index ? { ...item, state: `失败：${message}` } : item)),
        )
      }
    }
    await load()
    onChanged()
  }

  const active = STAGE_OPTIONS.find((option) => option.key === stage) || STAGE_OPTIONS[0]
  const currentWeek = weeks.find((row) => row.folder === selected) || null
  const targetLabel =
    stage === '10_kb'
      ? '课程知识库'
      : currentWeek
        ? `第 ${currentWeek.week} 周${currentWeek.date ? ` · ${currentWeek.date}` : ''}`
        : '未归周'
  const currentFiles = grouped.get(stage === '10_kb' ? UNFILED : selected) || []

  return (
    <Panel
      title="材料"
      hint={
        stage === '10_kb'
          ? '课程介绍、教学大纲、教材放在这里，用来提取课程档案。'
          : '先选是哪一周的课，再放录音和课件。文件会落进这一周自己的目录，后面按周整理。'
      }
      error={error}
    >

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {STAGE_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            className="btn"
            aria-pressed={option.key === stage}
            onClick={() => setStage(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {stage === '00_source' && (
        <div className="week-picker">
          {weeks.length === 0 ? (
            <p className="notice">
              还没有周次。先在「时间轴」页把课程大纲的周次写入课程，这里才能按周放材料。
            </p>
          ) : (
            <>
              {!weeks.some((row) => row.date) && (
                <p className="notice notice--due" style={{ marginBottom: 10 }}>
                  周次还没有日期。去「时间轴」页的排课里选好学期和每周上课日，日期就出来了。
                </p>
              )}
              <div className="week-chips">
                {weeks.map((row) => {
                  const count = (grouped.get(row.folder) || []).length
                  return (
                    <button
                      key={row.folder}
                      type="button"
                      className="week-chip"
                      aria-pressed={selected === row.folder}
                      data-filled={count > 0}
                      data-cancelled={row.cancelled}
                      onClick={() => setSelected(row.folder)}
                      title={row.topic}
                    >
                      <span className="week-chip__no">第 {row.week} 周</span>
                      <span className="week-chip__date mono">{row.date || '待排课'}</span>
                      <span className="week-chip__count">
                        {row.cancelled ? '已取消' : count > 0 ? `${count} 个文件` : '空'}
                      </span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  className="week-chip"
                  aria-pressed={selected === UNFILED}
                  data-filled={(grouped.get(UNFILED) || []).length > 0}
                  onClick={() => setSelected(UNFILED)}
                >
                  <span className="week-chip__no">未归周</span>
                  <span className="week-chip__date mono">认不出周次的</span>
                  <span className="week-chip__count">
                    {(grouped.get(UNFILED) || []).length || '空'}
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div
        className="dropzone"
        style={{ marginTop: 16 }}
        data-active={dragging}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void send(event.dataTransfer.files)
        }}
      >
        <p style={{ margin: '0 0 6px' }}>
          放进 <strong>{targetLabel}</strong>
        </p>
        <button className="btn btn--primary" type="button" onClick={() => inputRef.current?.click()}>
          选择文件
        </button>
        <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
          {stage === '10_kb'
            ? '支持 PDF、Word、图片、纯文本'
            : '录音 m4a / mp3 / wav / mp4，课件 pptx / pdf；可以一次选多个'}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) void send(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      {uploads.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '14px 0 0' }}>
          {uploads.map((upload, index) => (
            <li key={`${upload.name}-${index}`} className="mono">
              {upload.name} — {upload.state}
            </li>
          ))}
        </ul>
      )}

      {stage === '10_kb' && files.length > 0 && onExtract && (
        <p className="notice" style={{ marginTop: 14 }}>
          这些文件可以自动读出课程名、教师、学期和重要节点。
          <button className="btn btn--primary" type="button" style={{ marginLeft: 10 }} onClick={onExtract}>
            从文件提取课程信息
          </button>
        </p>
      )}

      {stage === '10_kb' && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h3 className="section-title">教材知识库（{books.length} 本）</h3>
            <button
              className="btn"
              type="button"
              onClick={() =>
                void api.scaffoldTextbooks(course.id).then((result) => {
                  setUploads([
                    { name: '教材目录', state: `共 ${result.total} 本，新建 ${result.created.length} 个` },
                  ])
                  void loadBooks()
                  void load()
                })
              }
            >
              生成教材目录
            </button>
          </div>
          <p className="section-hint">
            一本一个目录，放你从图书馆或出版社拿到的合法副本，再跑「教材索引」任务切章建索引。
            工作台不下载教材，也不接盗版来源。
          </p>
          {books.length === 0 ? (
            <p className="muted">还没有教材目录。点「生成教材目录」，会按课程档案里的书目建好文件夹。</p>
          ) : (
            <ul className="profile-plain">
              {books.map((book) => (
                <li key={book.slug}>
                  <span className="level-tag">{book.role === 'textbook' ? '教材' : '参考书'}</span>{' '}
                  <strong>{book.title || book.citation.split('(')[0].trim()}</strong>
                  <div className="mono">
                    {book.year}
                    {book.publisher ? `　${book.publisher}` : ''}
                    {book.isbn ? `　ISBN ${book.isbn}` : ''}
                    {`　${book.chapters?.length || 0} 章`}
                    {`　${book.files?.length || 0} 个文件`}
                  </div>
                  <div className="mono" style={{ color: 'var(--ink-300)' }}>
                    10_kb/textbooks/{book.slug}/
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <hr className="rule" />

      <h3 className="section-title">
        {targetLabel} 的材料（{currentFiles.length}）
      </h3>
      {currentFiles.length === 0 ? (
        <p className="muted">这一栏还是空的。</p>
      ) : (
        <table className="file-table">
          <thead>
            <tr>
              <th>文件</th>
              <th>大小</th>
              <th>加入时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {currentFiles.map((file) => (
              <tr key={file.path}>
                <td className="mono">{file.path}</td>
                <td className="mono">{file.sizeLabel}</td>
                <td className="mono">{file.modified.slice(0, 19).replace('T', ' ')}</td>
                <td>
                  <a
                    className="btn"
                    href={api.rawUrl(course.id, `${stage}/${file.path}`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}
