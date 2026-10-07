import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api'
import { errorMessage, useLoader } from '../loader'
import type { Job } from '../types'

interface Props {
  courseId: string
  /** 大纲有更新时通知外面重读一遍 */
  onOutlineChanged: () => void
}

const STAGE = '06_outline'
const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp)$/i

const JOB_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '认字中',
  done: '已完成',
  failed: '失败',
  interrupted: '已中断',
  canceled: '已取消',
}

/** 笔记照片丢进来，交给「从图片整理知识点与笔记」任务认字、提炼知识点与笔记。 */
export default function OutlineImages({ courseId, onOutlineChanged }: Props) {
  const [uploads, setUploads] = useState<{ name: string; state: string }[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data, reload: loadImages } = useLoader(
    async () => (await api.listFiles(courseId, STAGE)).files,
    [courseId],
  )
  const images = useMemo(() => (data || []).filter((file) => IMAGE_RE.test(file.path)), [data])

  const running = !!job && (job.status === 'queued' || job.status === 'running')

  useEffect(() => {
    if (!running || !job) return
    const timer = window.setInterval(() => {
      void api
        .getJob(courseId, job.id)
        .then((result) => setJob(result.job))
        .catch(() => undefined)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [courseId, running, job])

  useEffect(() => {
    if (job?.status === 'done') onOutlineChanged()
  }, [job?.status, onOutlineChanged])

  const send = async (list: FileList | File[]) => {
    const items = Array.from(list).filter((file) => IMAGE_RE.test(file.name))
    if (!items.length) {
      setError('只认图片：png / jpg / webp / gif / bmp')
      return
    }
    setError('')
    setUploads(items.map((file) => ({ name: file.name, state: '等待上传' })))
    for (let index = 0; index < items.length; index += 1) {
      const mark = (state: string) =>
        setUploads((current) => current.map((item, i) => (i === index ? { ...item, state } : item)))
      mark('上传中…')
      try {
        await api.upload(courseId, STAGE, items[index], 'images')
        mark('已入库')
      } catch (err) {
        mark('失败：' + errorMessage(err))
      }
    }
    await loadImages()
  }

  const extract = async () => {
    try {
      setError('')
      const { job: created } = await api.createJob(courseId, {
        stage: 'points_from_images',
        title: '从图片整理知识点与笔记',
      })
      setJob(created)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  /**
   * 删图分两种：keep 只删文件、把大纲里指向它的原图摘掉，知识点和笔记留着；
   * drop 连这张图整理的知识点和笔记段落一起删，这种会先问一次。
   */
  const remove = async (path: string, mode: 'keep' | 'drop') => {
    const name = path.split('/').pop()
    if (mode === 'drop') {
      const confirmed = window.confirm(
        `删除 ${name}？这张图整理的知识点会一起从大纲删掉，照片和对应的笔记段落也删，无法撤销。`,
      )
      if (!confirmed) return
    }
    try {
      setError('')
      setNote('')
      const result = await api.deleteFile(courseId, `${STAGE}/${path}`, mode)
      const detail =
        mode === 'drop'
          ? [
              result.dropped ? `${result.dropped} 道题` : '',
              result.pointsRemoved ? `${result.pointsRemoved} 个知识点` : '',
              result.notesRemoved ? `${result.notesRemoved} 段笔记` : '',
            ].filter(Boolean)
          : [
              result.kept ? `${result.kept} 道题` : '',
              result.pointsUntagged ? `${result.pointsUntagged} 个知识点` : '',
            ].filter(Boolean)
      setNote(
        mode === 'drop'
          ? `已删除 ${name}${detail.length ? `，连同 ${detail.join('、')}` : '（没有产物引用它）'}。`
          : `已删除 ${name}${detail.length ? `，${detail.join('、')}保留、已摘掉原图` : ''}。`,
      )
      setUploads([])
      await loadImages()
      if (result.dropped || result.kept || result.pointsRemoved || result.pointsUntagged) {
        onOutlineChanged()
      }
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <details className="image-intake">
      <summary>
        图片知识点
        <span className="muted"> · 放 {images.length} 张笔记照片，识别后进下面的知识点和「笔记」页</span>
      </summary>

      {error && <p className="notice notice--due">{error}</p>}
      {note && <p className="notice">{note}</p>}

      <div
        className="dropzone"
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
        <p style={{ margin: '0 0 6px' }}>笔记照片放进 06_outline/images/</p>
        <button className="btn" type="button" onClick={() => inputRef.current?.click()}>
          选择图片
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) void send(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      {uploads.length > 0 && (
        <ul className="upload-list">
          {uploads.map((upload, index) => (
            <li key={`${upload.name}-${index}`} className="mono">
              {upload.name} — {upload.state}
            </li>
          ))}
        </ul>
      )}

      {images.length > 0 && (
        <div className="thumb-grid">
          {images.map((file) => (
            <figure className="thumb" key={file.path}>
              <a
                href={api.rawUrl(courseId, `${STAGE}/${file.path}`)}
                target="_blank"
                rel="noreferrer"
                title="打开原图"
              >
                <img src={api.rawUrl(courseId, `${STAGE}/${file.path}`)} alt={file.name} loading="lazy" />
              </a>
              <span className="thumb__name mono">{file.path.replace(/^images\//, '')}</span>
              <div className="thumb__actions">
                <button className="btn btn--tiny" type="button" onClick={() => void remove(file.path, 'keep')}>
                  删图
                </button>
                <button
                  className="btn btn--tiny btn--danger"
                  type="button"
                  onClick={() => void remove(file.path, 'drop')}
                >
                  图+知识点
                </button>
              </div>
            </figure>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn--primary" type="button" disabled={running} onClick={() => void extract()}>
          {running ? '正在整理…' : '从图片整理知识点'}
        </button>
        {job && (
          <span className="mono">
            {JOB_LABEL[job.status] || job.status}
            {job.status === 'failed' && job.error ? '：' + job.error : ''}
            {job.status === 'done' && job.warning ? '（' + job.warning + '）' : ''}
          </span>
        )}
      </div>

      <p className="field-note">
        模型先逐张图用 read_image 认字，再只照着图里的内容提炼知识点：图里没有的定义、数据、结论一律不补，
        拿不准的标「待老师确认」，它自己的解读单独标「我的理解」。知识点进 06_outline/outline.json
        的「图片笔记整理」单元，人读版是 06_outline/图片知识点.md，笔记写进 07_notes/图片笔记.md。
        传错了就点图下面的「删图」——只删照片，知识点和笔记留着（重传同一张图再跑一次，原图会重新挂上）；
        「图+知识点」会把这张图整理的知识点和笔记段落一起删掉，点之前会再问一次。
      </p>
    </details>
  )
}
