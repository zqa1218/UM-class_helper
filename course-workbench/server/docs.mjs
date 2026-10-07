import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * 把课件（PDF / PPTX）按页抽成文本，喂给 API 模型。
 * 走自调 API 这条路时模型没有 pdf 插件，也没有 pdftotext，
 * 所以抽取这一步在工作台里自己做，模型只管整理。
 */

/** 一次给模型多少字符；课件页多就分几次读，别一口气把上下文塞爆。 */
export const MAX_DOC_CHARS = 60 * 1024

const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&(lt|gt|quot|apos);/g, (_, name) => ENTITIES[name])
    .replace(/&amp;/g, '&')
}

/** PDF 的文字块按纵坐标分行；挤在一起的碎片拼一行，比全用空格接可读得多。 */
function pdfItemsToText(items) {
  const lines = []
  let buffer = []
  let lastY = null
  const flush = () => {
    const line = buffer.join('').replace(/\s+/g, ' ').trim()
    if (line) lines.push(line)
    buffer = []
  }
  for (const item of items) {
    if (typeof item?.str !== 'string') continue
    const y = Array.isArray(item.transform) ? Math.round(item.transform[5]) : null
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) flush()
    buffer.push(item.str)
    if (item.hasEOL) flush()
    if (y !== null) lastY = y
  }
  flush()
  return lines.join('\n')
}

async function pdfPages(absPath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await fsp.readFile(absPath))
  const task = pdfjs.getDocument({ data, useSystemFonts: false, verbosity: 0 })
  const doc = await task.promise
  try {
    const pages = []
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      pages.push({ label: `第 ${n} 页`, text: pdfItemsToText(content.items) })
    }
    return pages
  } finally {
    await task.destroy()
  }
}

/** 一个 PPTX 页里，一个 <a:p> 是一行，行里的 <a:t> 是文字块。 */
function pptxPageText(xml) {
  const lines = []
  for (const paragraph of String(xml).split(/<a:p[\s/>]/).slice(1)) {
    const runs = [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((match) => decodeXml(match[1]))
    const line = runs.join('').replace(/\s+/g, ' ').trim()
    if (line) lines.push(line)
  }
  return lines.join('\n')
}

async function pptxPages(absPath) {
  const { unzipSync } = await import('fflate')
  const files = unzipSync(new Uint8Array(await fsp.readFile(absPath)))
  const slides = Object.keys(files)
    .map((name) => ({ name, order: Number((name.match(/^ppt\/slides\/slide(\d+)\.xml$/) || [])[1]) }))
    .filter((entry) => Number.isFinite(entry.order))
    .sort((a, b) => a.order - b.order)
  if (!slides.length) throw new Error('这个 pptx 里没找到幻灯片（是不是 .ppt 老格式或者文件坏了？）')
  const decoder = new TextDecoder('utf-8')
  return slides.map((slide, index) => ({
    label: `第 ${index + 1} 张（slide${slide.order}）`,
    text: pptxPageText(decoder.decode(files[slide.name])),
  }))
}

/** 按扩展名分派；只认 pdf / pptx。 */
export async function extractDocPages(absPath) {
  const ext = path.extname(absPath).toLowerCase()
  if (ext === '.pdf') return { kind: 'pdf', pages: await pdfPages(absPath) }
  if (ext === '.pptx') return { kind: 'pptx', pages: await pptxPages(absPath) }
  throw new Error(`read_document 只认 pdf / pptx，这个是 ${ext || '没有扩展名'}（.ppt 老格式请先另存为 pptx 或 pdf）`)
}

/** 页太多就分几次读：一次给一段，并告诉模型下次从第几页接着读。 */
export function formatDocPages(kind, rel, pages, from, to) {
  const unit = kind === 'pptx' ? '张' : '页'
  if (!pages.length) return `【${rel}｜没读到任何${unit}】`
  const clamp = (value, fallback) => {
    const number = Number(value)
    return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback
  }
  const start = Math.min(clamp(from, 1), pages.length)
  const end = Math.max(start, Math.min(clamp(to, pages.length), pages.length))
  const out = [`【${rel}｜${kind}，共 ${pages.length} ${unit}，这里给第 ${start}-${end} ${unit}】`]
  let used = 0
  let last = start - 1
  for (let n = start; n <= end; n += 1) {
    const page = pages[n - 1]
    const body = page.text || `（这一${unit}抽不到文字，多半是图片或扫描件，要看内容得用 read_image 看截图）`
    const block = `${page.label}\n${body}`
    if (last >= start && used + block.length > MAX_DOC_CHARS) break
    used += block.length + 2
    out.push(block)
    last = n
  }
  if (last < end) out.push(`（到这里字符太多了，第 ${last + 1}-${end} ${unit}下次再读：from=${last + 1}）`)
  else if (end < pages.length) out.push(`（还有第 ${end + 1}-${pages.length} ${unit}，接着读请传 from=${end + 1}）`)
  return out.join('\n\n')
}
