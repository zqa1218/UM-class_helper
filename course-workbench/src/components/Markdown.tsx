import { marked } from 'marked'
import { useEffect, useMemo, useRef } from 'react'

import { api } from '../api'

function resolveRelative(baseDir: string, src: string): string {
  const parts = [...baseDir.split('/').filter(Boolean), ...src.split('/')]
  const out: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

interface Props {
  text: string
  courseId: string
  baseDir?: string
}

export default function Markdown({ text, courseId, baseDir = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => marked.parse(text, { async: false }) as string, [text])

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const images = Array.from(node.querySelectorAll('img'))
    for (const image of images) {
      const src = image.getAttribute('src') || ''
      if (/^(https?:|data:|\/api\/)/.test(src)) continue
      image.setAttribute('src', api.rawUrl(courseId, resolveRelative(baseDir, src)))
    }
    const links = Array.from(node.querySelectorAll('a'))
    for (const link of links) {
      const href = link.getAttribute('href') || ''
      if (/^(https?:|#|\/api\/)/.test(href)) {
        if (/^https?:/.test(href)) {
          link.setAttribute('target', '_blank')
          link.setAttribute('rel', 'noreferrer')
        }
        continue
      }
      link.setAttribute('href', api.rawUrl(courseId, resolveRelative(baseDir, href)))
      link.setAttribute('target', '_blank')
    }
  }, [html, courseId, baseDir])

  return <div className="md" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
}
