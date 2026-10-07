import { useMemo, useState } from 'react'

import { api } from '../api'
import { errorMessage, useLoader } from '../loader'
import type { Course, MoodleCourse } from '../types'

interface Props {
  course: Course
  /** 导完让外层重读课程：时间轴可能补进了新节点 */
  onImported: () => void
}

const SOURCE_LABEL: Record<string, string> = { token: 'Moodle 接口', cookie: '课程页' }

/** 会挂文件的那些活动类型，跟服务端认的一致。 */
const FILE_TYPES = ['resource', 'folder', 'url', 'book', 'page']

/** 课程 id 可以填数字，也可以直接粘 view.php?id=44187 这种整条网址。 */
export function courseIdFrom(input: string): string {
  const value = String(input || '').trim()
  const fromUrl = value.match(/[?&]id=(\d{1,9})/)
  if (fromUrl) return fromUrl[1]
  return /^\d{1,9}$/.test(value) ? value : ''
}

function sizeLabel(bytes: number): string {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

/** 填一次 Moodle 课程 id，PPT / PDF 自己按周落到 00_source/，人只要补录音。 */
export default function MoodleImport({ course, onImported }: Props) {
  const { data: status, reload: reloadStatus } = useLoader(() => api.moodleStatus(), [])
  const [rawId, setRawId] = useState('')
  const [preview, setPreview] = useState<MoodleCourse | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [withSchedule, setWithSchedule] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [importer, setImporter] = useState('')

  const moodle = status?.moodle
  const fileCount = useMemo(
    () =>
      (preview?.sections || []).reduce(
        (sum, section) => sum + section.modules.reduce((n, mod) => n + mod.files.length, 0),
        0,
      ),
    [preview],
  )
  const pickedFiles = useMemo(
    () =>
      (preview?.sections || [])
        .filter((section) => picked.includes(section.index))
        .reduce((sum, section) => sum + section.modules.reduce((n, mod) => n + mod.files.length, 0), 0),
    [preview, picked],
  )

  const read = async () => {
    const target = courseIdFrom(rawId)
    if (!target) {
      setError('填课程 id（网址里 view.php?id= 后面那串数字，例如 44187），或者直接粘整条网址。')
      return
    }
    setBusy('reading')
    setError('')
    setNote('')
    setPreview(null)
    try {
      const { course: found } = await api.moodleCourse(target)
      setPreview(found)
      setPicked(
        found.sections
          .filter((section) => section.modules.length > 0)
          .map((section) => section.index),
      )
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy('')
    }
  }

  const runImport = async () => {
    if (!preview) return
    setBusy('importing')
    setError('')
    setNote('')
    try {
      const result = await api.moodleImport({
        id: course.id,
        courseId: preview.id,
        sections: picked,
        schedule: withSchedule,
      })
      const parts = [`拉了 ${result.files.length} 个文件到 00_source/`]
      if (result.skipped.length) parts.push(`跳过 ${result.skipped.length} 个（同名已存在或下载失败）`)
      if (result.milestones.length) parts.push(`时间轴补了 ${result.milestones.length} 个上课节点`)
      setNote(parts.join('，') + '。录音还是自己放进对应周次，再跑盘点。')
      onImported()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy('')
    }
  }

  const check = async () => {
    setBusy('checking')
    setError('')
    setNote('')
    try {
      const { result } = await api.moodleCheck()
      setImporter(
        `连上了 ${result.site || moodle?.baseUrl || ''}${result.user ? '（' + result.user + '）' : ''}`,
      )
      await reloadStatus()
    } catch (err) {
      setImporter('')
      setError(errorMessage(err))
    } finally {
      setBusy('')
    }
  }

  const toggle = (index: number) => {
    setPicked((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
    )
  }

  return (
    <details className="image-intake">
      <summary>
        从 Moodle 导入
        <span className="muted">
          {' '}
          · {moodle?.configured ? `${SOURCE_LABEL[moodle.mode] || moodle.mode}已接好` : '还没配登录凭据'}
        </span>
      </summary>

      {error && <p className="notice notice--due">{error}</p>}
      {note && <p className="notice">{note}</p>}
      {importer && <p className="notice">{importer}</p>}

      {!moodle?.configured && (
        <p className="notice">
          先配一次登录凭据，工作台才能自己拉课件。两种办法挑一个：
          <br />① 浏览器登录 {moodle?.baseUrl || 'ummoodle.um.edu.mo'} 后按 F12 → Application → Cookies，
          把 <span className="mono">MoodleSession</span> 的值填进{' '}
          <span className="mono">workbench.config.json</span> 的{' '}
          <span className="mono">moodle.session</span>（或环境变量{' '}
          <span className="mono">WORKBENCH_MOODLE_SESSION</span>）；
          <br />② 有 Moodle Web service token 的话填 <span className="mono">moodle.token</span>，走 JSON 接口更稳。
          <button className="btn" type="button" style={{ marginLeft: 10 }} onClick={() => void reloadStatus()}>
            重新检测
          </button>
        </p>
      )}

      {moodle?.configured && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="mono"
              style={{ padding: '6px 9px', minWidth: 240 }}
              placeholder="课程 id，例如 44187（也可以粘网址）"
              value={rawId}
              onChange={(event) => setRawId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void read()
              }}
            />
            <button className="btn" type="button" disabled={busy !== ''} onClick={() => void read()}>
              {busy === 'reading' ? '读取中…' : '读取目录'}
            </button>
            <button className="btn btn--tiny" type="button" disabled={busy !== ''} onClick={() => void check()}>
              {busy === 'checking' ? '检测中…' : '检测连接'}
            </button>
          </div>

          {preview && (
            <div style={{ marginTop: 14 }}>
              <p style={{ margin: '0 0 8px' }}>
                <strong>{preview.fullname}</strong>
                <span className="muted">
                  {' '}
                  · 课程 id {preview.id} · 读自{SOURCE_LABEL[preview.source] || preview.source} ·{' '}
                  {fileCount > 0 ? `共 ${fileCount} 个 PPT / PDF` : '还没解析出文件'}
                </span>
              </p>

              {preview.sections.length === 0 ? (
                <p className="muted">这门课没读到小节，确认 id 对不对、账号有没有选这门课。</p>
              ) : (
                <ul className="upload-list">
                  {preview.sections.map((section) => {
                    const names = section.modules.flatMap((mod) => mod.files.map((file) => file.name))
                    const activities = section.modules.map((mod) => mod.name).filter(Boolean)
                    const mayHaveFiles = section.modules.some((mod) => FILE_TYPES.includes(mod.modname))
                    return (
                      <li key={section.index}>
                        <label style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                          <input
                            type="checkbox"
                            checked={picked.includes(section.index)}
                            disabled={section.modules.length === 0}
                            onChange={() => toggle(section.index)}
                          />
                          <span>
                            <strong>{section.name}</strong>
                            <span className="muted">
                              {' '}
                              ·{' '}
                              {names.length
                                ? `${names.length} 个文件`
                                : mayHaveFiles
                                  ? '文件没解析出来'
                                  : '这一节没课件'}
                              {section.date ? ` · ${section.date}${section.time ? ' ' + section.time : ''}` : ''}
                            </span>
                            <span className="mono" style={{ display: 'block', color: 'var(--ink-300)' }}>
                              {(names.length ? names : activities).join(' / ') || '这一节没课件'}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}

              <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
                <input
                  type="checkbox"
                  checked={withSchedule}
                  onChange={() => setWithSchedule((value) => !value)}
                />
                <span>
                  读到的上课日期顺手写进时间轴
                  <span className="muted"> · 同一天同一节不会重复加，之后可以在时间轴页改</span>
                </span>
              </label>

              <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <button
                  className="btn btn--primary"
                  type="button"
                  disabled={busy !== '' || picked.length === 0}
                  onClick={() => void runImport()}
                >
                  {busy === 'importing'
                    ? '正在下载…'
                    : fileCount > 0
                      ? `导入勾选的 ${pickedFiles} 个课件`
                      : `导入勾选的 ${picked.length} 节`}
                </button>
                <button className="btn" type="button" disabled={busy !== ''} onClick={() => setPicked(preview.sections.map((s) => s.index))}>
                  全选
                </button>
                <button className="btn" type="button" disabled={busy !== ''} onClick={() => setPicked([])}>
                  全不选
                </button>
              </div>
            </div>
          )}

          <p className="field-note">
            文件按小节的周次落进 <span className="mono">00_source/week-NN/</span>（小节名里带「第 3 周 / Week 3」就按它排，
            认不出来按顺序排），同名文件不覆盖，导完写一份{' '}
            <span className="mono">00_source/moodle-import.md</span> 清单。课件在工作台里只读不改，
            录音仍然自己传进对应周次——课件是机器拉的，声音得你给。
          </p>
        </>
      )}
    </details>
  )
}
