import type { ReactNode } from 'react'

interface Props {
  title: string
  hint?: ReactNode
  /** 固定在正文上方的一块内容（加载中和空态时也显示） */
  extra?: ReactNode
  /** 刷新按钮右侧的额外按钮 */
  actions?: ReactNode
  onRefresh?: () => void
  error?: string
  loading?: boolean
  loadingText?: string
  /** 传了才显示空态；有内容时传 undefined */
  empty?: ReactNode
  children?: ReactNode
}

/** 各面板共用的骨架：标题 + 刷新 + 提示 + 错误条 + 加载 / 空态 / 内容。 */
export default function Panel({
  title,
  hint,
  extra,
  actions,
  onRefresh,
  error,
  loading,
  loadingText = '正在读取…',
  empty,
  children,
}: Props) {
  return (
    <section>
      <div className="panel-head">
        <h2 className="section-title">{title}</h2>
        {onRefresh && (
          <button className="btn" type="button" onClick={onRefresh}>
            刷新
          </button>
        )}
        {actions}
      </div>
      {hint && <p className="section-hint">{hint}</p>}
      {extra}
      {error && (
        <p className="notice notice--due" role="alert">
          {error}
        </p>
      )}
      {loading ? <p className="muted">{loadingText}</p> : empty ? <div className="empty">{empty}</div> : children}
    </section>
  )
}
