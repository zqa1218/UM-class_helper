import { useCallback, useEffect, useRef, useState } from 'react'

/** 把 unknown 异常转成能直接显示的一行文案。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 面板级数据加载：统一 loading / error / reload 三件套，替掉每个组件各写一遍的
 * useState + try/catch + useEffect。deps 变化自动重载，reload() 手动重跑。
 */
export function useLoader<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const latest = useRef(load)
  latest.current = load

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const value = await latest.current()
      setData(value)
      setError('')
      return value
    } catch (err) {
      setError(errorMessage(err))
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload, ...deps])

  return { data, error, loading, reload, setData, setError }
}
