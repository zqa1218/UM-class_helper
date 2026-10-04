import fsp from 'node:fs/promises'
import path from 'node:path'

import { coursePaths, pathExists, readJson, resolveInCourse, slugify, writeJson } from './courses.mjs'

/** 从引用里抽年份。取不到就是空字符串，不猜。 */
function yearOf(citation) {
  const match = /\((\d{4})\)/.exec(citation)
  return match ? match[1] : ''
}

/** 作者姓氏拼成目录名：去掉名字首字母缩写，避免目录名过长。 */
function slugOf(citation) {
  const head = citation
    .split('(')[0]
    .replace(/\b[A-Z]\./g, ' ')
    .replace(/[&,.]/g, ' ')
    .trim()
  const words = head.split(/\s+/).filter(Boolean).slice(0, 3)
  const year = yearOf(citation)
  const base = slugify(words.join('-') || 'book').toLowerCase()
  return year ? `${base}-${year}` : base
}

/**
 * 从引用里拆出书名。这是解析不是推断：拆不出来就留空，
 * 由用户在 book.json 里补，不能让工作台编一个书名。
 */
function titleOf(citation) {
  const after = citation.split(/\(\d{4}\)\.\s*/)[1]
  if (!after) return ''
  const firstSentence = after.split(/(?<=\.)\s/)[0] || after
  return firstSentence.replace(/\.$/, '').trim()
}

function buildEntry(citation, role) {
  const year = yearOf(citation)
  const title = titleOf(citation)
  const publisher = title ? citation.split(title)[1]?.replace(/^[.,\s]+/, '').replace(/\.$/, '').trim() || '' : ''
  return {
    slug: slugOf(citation),
    role,
    citation: citation.trim(),
    year,
    title,
    publisher,
    isbn: '',
    access: '',
    status: 'pending',
    files: [],
    chapters: [],
    note: 'title 与 publisher 由引用解析得到，解析不出就是空；isbn 与 access 需要你补。',
  }
}

const TEXTBOOK_README = `# 教材知识库

这一个目录放本课程用到的教材与参考书。一本一个子目录，里面三样东西：

| 项目 | 说明 |
|---|---|
| book.json | 书目、获取途径、索引状态 |
| book.pdf | 你通过合法途径拿到的副本（可选） |
| chapters/ | 「教材索引」任务切好的分章文本 |

## 工作台不做什么

不下载教材，不走盗版渠道。这里只负责**结构化**：登记书目、记录获取途径、
把你有权使用的副本切章建索引，并把章节映射到课程周次。

## 你可以从哪里拿

按顺序试这三条，都拿不到就先空着，不影响其他环节：

1. **学校图书馆**——先用课程代码和书名在图书馆目录里搜，看有没有电子版或纸本馆藏。
   纸本可以扫描你自己需要的章节，供个人学习使用。
2. **出版社平台**——多数教材在出版社自己的平台上有电子版或章节预览。
3. **开放获取**——少部分经典教材有官方免费版本，例如神经科学领域有书整本挂在
   NCBI Bookshelf 上。这类链接请自己核实后再用。

## 查证工具

工作台装了三个检索 skill，用来核书目和找合法副本，不用手动翻网页：

| skill | 用途 |
|---|---|
| paper-lookup | 18 个学术库，含 Unpaywall 与 CORE，专门找**合法的开放获取全文** |
| literature-search | OpenAlex / Crossref / arXiv 检索，返回结构化书目 |
| academic-search | 文献检索与综述梳理 |

用它们做的两件事：一是把 book.json 里的 ISBN、DOI、出版信息核准；
二是查这本书有没有开放获取版本。**查不到就留空，不要用盗版源补。**

## 目录名怎么来的

按引用里的作者姓氏与年份生成，例如 \`bear-connors-paradiso-2020\`。
不要改名，索引任务按目录名对应书目。
`

/** 依据 course.json 里的教材与参考书，建好书目目录与说明文件。 */
export async function buildTextbookScaffold(root, id) {
  const meta = await readJson(coursePaths(root, id).meta)
  if (!meta) return null

  const base = resolveInCourse(root, id, '10_kb/textbooks')
  await fsp.mkdir(base, { recursive: true })
  // 说明文件由工作台维护，每次都刷新，避免和标准脱节
  await fsp.writeFile(path.join(base, 'README.md'), TEXTBOOK_README, 'utf8')

  const entries = [
    ...(meta.textbooks || []).map((item) => buildEntry(String(item.citation || item), 'textbook')),
    ...(meta.references || []).map((item) => buildEntry(String(item.citation || item), 'reference')),
  ].filter((entry) => entry.citation)

  const created = []
  for (const entry of entries) {
    const dir = path.join(base, entry.slug)
    await fsp.mkdir(path.join(dir, 'chapters'), { recursive: true })
    const file = path.join(dir, 'book.json')
    if (await pathExists(file)) continue
    await writeJson(file, entry)
    created.push(entry.slug)
  }

  return { base, total: entries.length, created, entries }
}

export async function listTextbooks(root, id) {
  const base = resolveInCourse(root, id, '10_kb/textbooks')
  let names = []
  try {
    names = await fsp.readdir(base, { withFileTypes: true })
  } catch {
    return []
  }
  const books = []
  for (const entry of names) {
    if (!entry.isDirectory()) continue
    const book = await readJson(path.join(base, entry.name, 'book.json'))
    if (book) books.push(book)
  }
  return books
}
