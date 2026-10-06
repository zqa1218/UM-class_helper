import { useMemo, useState } from 'react'

import { api } from '../api'
import { useLoader } from '../loader'
import type { QuizItem } from '../types'
import Panel from './Panel'

interface Props {
  courseId: string
}

const TYPE_LABEL: Record<string, string> = {
  single: '单选',
  multi: '多选',
  truefalse: '判断',
  short: '简答',
}

export default function QuizView({ courseId }: Props) {
  const [tag, setTag] = useState('')
  const [onlyWrong, setOnlyWrong] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [result, setResult] = useState<Record<string, boolean>>({})

  const { data, loading, reload } = useLoader(async () => {
    try {
      return { items: await api.loadBank(courseId), missing: false }
    } catch {
      return { items: [] as QuizItem[], missing: true }
    }
  }, [courseId])
  const items = useMemo(() => data?.items || [], [data])

  const tags = useMemo(() => {
    const set = new Set<string>()
    for (const item of items) {
      for (const point of item.pointIds || []) {
        set.add(point.split('-').slice(0, 2).join('-'))
      }
    }
    return [...set].sort()
  }, [items])

  const visible = useMemo(() => {
    const needle = tag.trim().toUpperCase()
    return items.filter((item) => {
      if (onlyWrong && !(item.wrongCount && item.wrongCount > 0)) return false
      if (!needle) return true
      return (item.pointIds || []).some((point) => point.toUpperCase().startsWith(needle))
    })
  }, [items, tag, onlyWrong])

  const togglePick = (item: QuizItem, key: string) => {
    if (revealed[item.id]) return
    setPicked((current) => {
      const existing = current[item.id] || []
      if (item.type === 'multi') {
        return {
          ...current,
          [item.id]: existing.includes(key)
            ? existing.filter((entry) => entry !== key)
            : [...existing, key],
        }
      }
      return { ...current, [item.id]: [key] }
    })
  }

  const reveal = async (item: QuizItem) => {
    const chosen = (picked[item.id] || []).slice().sort().join('')
    const answer = (item.answer || []).map((entry) => String(entry).trim().toUpperCase()).sort().join('')
    const correct = chosen !== '' && chosen === answer
    setRevealed((current) => ({ ...current, [item.id]: true }))
    setResult((current) => ({ ...current, [item.id]: correct }))
    if (chosen) {
      try {
        await api.recordAnswer(courseId, item.id, correct)
      } catch {
        /* 记录失败不影响练习 */
      }
    }
  }

  const reset = () => {
    setRevealed({})
    setPicked({})
    setResult({})
  }

  return (
    <Panel
      title="题库练习"
      hint="默认练习模式：先答题，再显示答案与解析。作答结果会记回题库，用于错题重练。"
      onRefresh={() => void reload()}
      loading={loading}
      loadingText="正在读取题库…"
      empty={
        data?.missing
          ? '还没有题库。先在大纲里选好范围，再跑一次「出题」任务。'
          : visible.length === 0
            ? '这个范围里还没有题。'
            : undefined
      }
      actions={
        <button className="btn" type="button" onClick={reset}>
          重做本页
        </button>
      }
    >

      <div className="field-row" style={{ maxWidth: 640, marginBottom: 10 }}>
        <div className="field">
          <label htmlFor="quiz-tag">范围</label>
          <input
            id="quiz-tag"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            placeholder="例如 CN03-02，留空表示全部"
          />
        </div>
        <div className="field">
          <label>筛选</label>
          <label className="mono" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={onlyWrong}
              onChange={(event) => setOnlyWrong(event.target.checked)}
            />
            只看做错过的
          </label>
        </div>
      </div>

      {tags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {tags.map((entry) => (
            <button
              key={entry}
              type="button"
              className="btn"
              aria-pressed={entry === tag}
              onClick={() => setTag(entry)}
            >
              {entry}
            </button>
          ))}
        </div>
      )}

      <>
        <p className="mono">共 {visible.length} 题</p>
        {visible.map((item) => {
          const shown = revealed[item.id]
          const chosen = picked[item.id] || []
          const answer = (item.answer || []).map((entry) => String(entry).trim().toUpperCase())
          return (
            <article className="quiz-item" key={item.id}>
              <div className="quiz-item__meta">
                <span>{item.id}</span>
                <span>{TYPE_LABEL[item.type] || item.type}</span>
                {item.difficulty && <span>{item.difficulty}</span>}
                <span>{(item.pointIds || []).join('、')}</span>
                {item.isExtension && <span>拓展</span>}
              </div>
              <p className="quiz-item__stem">{item.stem}</p>
              {item.options &&
                Object.entries(item.options).map(([key, text]) => {
                  const letter = key.toUpperCase()
                  const isPicked = chosen.includes(letter)
                  const isAnswer = answer.includes(letter)
                  return (
                    <button
                      key={key}
                      type="button"
                      className="option"
                      data-picked={isPicked}
                      data-correct={shown && isAnswer}
                      data-wrong={shown && isPicked && !isAnswer}
                      onClick={() => togglePick(item, letter)}
                    >
                      <span className="option__key">{letter}</span>
                      <span>{text}</span>
                    </button>
                  )
                })}
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                {!shown ? (
                  <button
                    className="btn btn--primary"
                    type="button"
                    onClick={() => void reveal(item)}
                    disabled={chosen.length === 0}
                  >
                    显示答案
                  </button>
                ) : (
                  <span className="mono">
                    答案：{answer.join('、')}　{result[item.id] ? '答对了' : '再看看解析'}
                  </span>
                )}
              </div>
              {shown && item.explanation && (
                <div className="explain">
                  {item.explanation}
                  {(item.sources || []).length > 0 && (
                    <div className="mono" style={{ marginTop: 6 }}>
                      溯源：{item.sources?.join('；')}
                    </div>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </>
    </Panel>
  )
}
