import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api'
import { errorMessage, useLoader } from '../loader'
import type { Job } from '../types'

interface Props {
  courseId: string
  /** 题库有更新时通知外面重跑一遍练习列表 */
  onBankChanged: () => void
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp)$/i

const JOB_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '认字中',
  done: '已完成',
  failed: '失败',
  interrupted: '已中断',
  canceled: '已取消',
}

/** 题目截图丢进来，交给「从图片整理题目集」任务认字、配答案、入库。 */
export default function QuizImages({ courseId, onBankChanged }: Props) {
  const [uploads, setUploads] = useState<{ name: string; state: string }[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data, reload: loadImages } = useLoader(
    async () => (await api.listFiles(courseId, '09_quiz')).files,
    [courseId],
  )
  const images = useMemo(
    () => (data || []).filter((file) => IMAGE_RE.test(file.path)),
    [data],
  )

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
    if (job?.status === 'done') onBankChanged()
  }, [job?.status, onBankChanged])

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
        await api.upload(courseId, '09_quiz', items[index], 'images')
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
        stage: 'quiz_from_images',
        title: '从图片整理题目集',
      })
      setJob(created)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  /**
   * 删图分两种：keep 只删文件、把题库里的图片引用摘掉，题留着；
   * drop 连这张图整理的题一起删，这种会先问一次。
   */
  const remove = async (path: string, mode: 'keep' | 'drop') => {
    const name = path.split('/').pop()
    if (mode === 'drop') {
      const confirmed = window.confirm(
        `删除 ${name}？这张图整理的题会一起从题库删掉，图片文件也删，无法撤销。`,
      )
      if (!confirmed) return
    }
    try {
      setError('')
      setNote('')
      const result = await api.deleteFile(courseId, `09_quiz/${path}`, mode)
      setNote(
        mode === 'drop'
          ? `已删除 ${name}${result.dropped ? `，连同 ${result.dropped} 道题` : '（题库里没有引用它的题）'}。`
          : `已删除 ${name}${result.kept ? `，${result.kept} 道题保留、已摘掉原图` : ''}。`,
      )
      setUploads([])
      await loadImages()
      if (result.dropped || result.kept) onBankChanged()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <details className="image-intake">
      <summary>
        图片题目
        <span className="muted"> · 放 {images.length} 张截图，识别后进上面的题库</span>
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
        <p style={{ margin: '0 0 6px' }}>题目截图放进 09_quiz/images/</p>
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
                href={api.rawUrl(courseId, `09_quiz/${file.path}`)}
                target="_blank"
                rel="noreferrer"
                title="打开原图"
              >
                <img src={api.rawUrl(courseId, `09_quiz/${file.path}`)} alt={file.name} loading="lazy" />
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
                  图+题
                </button>
              </div>
            </figure>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn--primary" type="button" disabled={running} onClick={() => void extract()}>
          {running ? '正在整理…' : '从图片整理题目集'}
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
        识图只负责把图里的题抄成文字，答案由模型对着课程材料找；图里没给答案又找不到依据的，
        解析会标「待老师确认」，方便你回头核。整理完题目和原图一起进题库，练习页能直接看原题。
        传错了就点图下面的「删图」——只删文件，题留着（重传同一张图，题目会重新挂上原图）；
        「图+题」会把这张图整理的题一起删掉，点之前会再问一次。
      </p>
    </details>
  )
}
