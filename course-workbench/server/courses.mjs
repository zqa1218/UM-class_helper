import fsp from 'node:fs/promises'
import path from 'node:path'

export const STAGES = [
  { key: '10_kb', label: '课程知识库', hint: '课程介绍、大纲、教材、文献' },
  { key: '00_source', label: '原始材料', hint: '每次课的录音与课件' },
  { key: '01_transcript', label: '转写稿', hint: '带时间戳的文本' },
  { key: '02_slides', label: '逐页文本与关键图', hint: '每页文本 + 关键页图片' },
  { key: '03_align', label: '页与讲述对齐', hint: '哪儿讲到了哪一页' },
  { key: '04_corrections', label: '纠错清单', hint: '逐条给依据与置信度' },
  { key: '05_supplements', label: '学科补充', hint: '带出处的延伸内容' },
  { key: '06_outline', label: '知识点大纲', hint: '编号大纲，出题的依据' },
  { key: '07_notes', label: '笔记与总结', hint: '图文笔记、讲课流程' },
  { key: '08_graph', label: '知识图谱', hint: '知识点之间的关系图' },
  { key: '09_quiz', label: '题库', hint: '题目、答案、解析' },
]

export const JOB_DIR = '_jobs'

/** 课程资料标准：随每门新课写入 10_kb/，同时约束提取任务读取的字段。 */
export const MATERIAL_STANDARD = `# 课程资料标准

本工作台按这套结构收集和整理课程资料。学校发的课程大纲只要落在这个结构里，
提取出来的字段就是稳定的，不同课程之间可以横向比较、统一出题和复习。

## 要传什么

| 文件 | 必需 | 说明 |
|---|---|---|
| 课程大纲 / Syllabus | 是 | 优先用学校发布的正式版本，PDF 或 Word |
| 学校通知 / 教学安排 | 否 | 补充调课、考核变化、集体安排 |
| 教材与参考书清单 | 否 | 大纲里已有就不用单独传 |

## 标准结构

### 1 课程信息

| 字段 | 说明 | 例 |
|---|---|---|
| 课程代码 | 学校给的编号 | CCBS7001 |
| 课程名称 | 英文与中文各一份 | PRINCIPLES OF NEUROSCIENCE / 神經科學原理 |
| 开课单位 | 学院或系 | 心理与认知科学学院 |
| 课程简介 | 原样保留，不要改写 | |
| 先修要求 | 没有就留空 | 高中生物与化学 |

### 2 授课信息

每位教师一条：姓名、邮箱、电话、办公室、答疑时间。多位数教师各列一条。

### 3 预期学习成果 CILO

编号加描述，例：CILO-1 学生能够解释神经系统的结构与功能。有几条记几条。

### 4 考核方式

项目名称加权重，权重合计 100%。例：课堂参与 10%、测验 20%、期末考试 50%、论文 10%。

### 5 课程内容

按大纲顺序列出主题清单，不要合并或重排。

### 6 周次安排

- 学期起止日期，以及学校的校历链接（如有）。
- 每周一条：周次、主题、授课教师、子主题。
- 大纲通常只写周次不写日期。只写周次时，工作台按「学期起始日 + (周次 - 1) 周」
  推算出每周日期，你在确认环节可以逐条改。

### 7 教材与参考书

教材与参考书分开列，保留完整引用（作者、年份、书名、出版社）。

## 校历与排课

学期起止、假期、复习周、考试周不用从大纲里猜，工作台直接从学校校历读取。
澳门大学有 .ics 订阅（UMAlmanac2627.ics），点「更新校历」即可拉取。

| 输入 | 来源 | 例 |
|---|---|---|
| 第 1 教学周的周一 | 校历自动 | 2026-08-17 |
| 每周上课日与时间 | 你提供 | 周二 14:00–16:00，E21-1005f |
| 假期与调课例外 | 你确认 | 第 6 周遇国庆，取消 |

日期算法：第 1 教学周周一 +（周次 − 1）× 7 +（上课日 − 1），再按例外调整。
落在假期的周会被标出来，由你决定取消、延期到某天，还是照常。

## 材料怎么放

录音和课件按周次归档，一周一个目录：

    00_source/
      week-01/  第 1 讲的录音与课件
      week-02/
      ...

文件名里带周次的会自动归位，认不出的单独列在 manifest 的「未归周」里，不会乱猜。

## 教材怎么进知识库

教材按书一本一个目录，目录名由引用自动生成：

    10_kb/textbooks/
      bear-connors-paradiso-2020/
        book.json      书目与获取途径
        book.pdf       你从图书馆或出版社拿到的合法副本
        chapters/      切章后的文本

工作台不替你下载教材，也不接受盗版来源。你从学校图书馆、出版社平台或开放获取渠道
拿到 PDF，放进对应目录，再跑「教材索引」任务，它会抽出目录、切章、把章节映射到周次。
没有副本时，这一栏只保留书目与获取途径，不影响其他环节。

出版社或图书馆的合法途径写在 10_kb/textbooks/README.md 里。

## 附则怎么处理

考勤规定、考试规则、学生事务服务这类全校通用条款不进入知识库，
原文件保留在 10_kb/ 备查即可，提取时不要把它们当成课程内容。
`

const STAGE_KEYS = new Set(STAGES.map((s) => s.key))

export function isStage(key) {
  return STAGE_KEYS.has(key)
}

export function slugify(name) {
  const cleaned = String(name)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
  if (cleaned) return cleaned.slice(0, 60)
  return `course-${Date.now()}`
}

export async function pathExists(target) {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

export async function readJson(file, fallback = null) {
  try {
    const raw = await fsp.readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function courseDir(root, id) {
  return path.join(root, id)
}

export function coursePaths(root, id) {
  const dir = courseDir(root, id)
  return {
    dir,
    meta: path.join(dir, 'course.json'),
    ledger: path.join(dir, 'COURSE.md'),
    jobs: path.join(dir, JOB_DIR),
  }
}

/** 防止越界读取：解析后的路径必须落在课程目录内。 */
export function resolveInCourse(root, id, relPath = '') {
  const dir = courseDir(root, id)
  const target = path.resolve(dir, relPath)
  const base = path.resolve(dir)
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('路径超出课程目录')
  }
  return target
}

export async function listCourses(root) {
  if (!(await pathExists(root))) return []
  const entries = await fsp.readdir(root, { withFileTypes: true })
  const courses = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) {
      continue
    }
    const metaPath = path.join(root, entry.name, 'course.json')
    const meta = await readJson(metaPath)
    if (!meta) continue
    courses.push(await summarize(root, entry.name, meta))
  }
  courses.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  return courses
}

async function countFiles(dir) {
  let files = 0
  let bytes = 0
  const walk = async (current) => {
    let entries
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        files += 1
        try {
          bytes += (await fsp.stat(full)).size
        } catch {
          /* 忽略统计失败 */
        }
      }
    }
  }
  await walk(dir)
  return { files, bytes }
}

async function stageStates(root, id) {
  const dir = courseDir(root, id)
  const states = []
  for (const stage of STAGES) {
    const { files, bytes } = await countFiles(path.join(dir, stage.key))
    states.push({
      ...stage,
      files,
      bytes,
      status: files === 0 ? 'empty' : stage.key === '09_quiz' ? 'ready' : 'ready',
    })
  }
  return states
}

async function summarize(root, id, meta) {
  const dir = courseDir(root, id)
  const stages = await stageStates(root, id)
  const schedule = Array.isArray(meta.schedule) ? meta.schedule : []
  const today = new Date().toISOString().slice(0, 10)
  const pending = schedule.filter((m) => !m.done && m.date).sort((a, b) => a.date.localeCompare(b.date))
  // 优先显示今天及以后的最近节点，全过期时才回退到最早的未完成节点
  const upcoming = pending.filter((m) => m.date >= today)
  const nextMilestone = upcoming[0] || pending[0] || null
  const outlineFile = path.join(dir, '06_outline', 'outline.json')
  let pointCount = 0
  const outline = await readJson(outlineFile)
  if (outline?.units) {
    for (const unit of outline.units) {
      for (const section of unit.sections || []) {
        pointCount += (section.points || []).length
      }
    }
  }
  const bank = await readJson(path.join(dir, '09_quiz', 'bank.json'))
  return {
    ...meta,
    id,
    stages,
    directory: dir,
    nextMilestone,
    milestoneCount: schedule.length,
    doneMilestones: schedule.filter((m) => m.done).length,
    pointCount,
    quizCount: Array.isArray(bank?.items) ? bank.items.length : 0,
    materialCount: stages.find((s) => s.key === '00_source')?.files ?? 0,
  }
}

export async function getCourse(root, id) {
  const paths = coursePaths(root, id)
  const meta = await readJson(paths.meta)
  if (!meta) return null
  return summarize(root, id, meta)
}

const LEDGER = (meta, directory) => `# ${meta.name} · 课程流水线台账

- 建立日期：${new Date().toISOString().slice(0, 10)}
- 课程目录：${directory}
- 学期：${meta.term || '未填'}
- 授课教师：${meta.teacher || '未填'}

## 输入清单

| 类别 | 文件 | 备注 |
|---|---|---|
| 课程介绍 / 大纲 | 见 10_kb/ | |
| 录音 | 见 00_source/ | |
| 课件 | 见 00_source/ | |

## 阶段状态

状态取值：未开始 / 进行中 / 已完成 / 待确认

| 阶段 | 目录 | 状态 | 备注 |
|---|---|---|---|
${STAGES.map((s, i) => `| ${i} · ${s.label} | \`${s.key}/\` | 未开始 | |`).join('\n')}

## 待老师确认项

纠错阶段中置信度低、需要向讲者核实的条目列在这里。

## 出题记录

| 日期 | 范围 | 题量 | 文件 |
|---|---|---|---|
`

export async function createCourse(root, input) {
  const name = String(input.name || '').trim()
  if (!name) throw new Error('课程名不能为空')
  let id = slugify(input.id || name)
  let suffix = 1
  while (await pathExists(courseDir(root, id))) {
    suffix += 1
    id = `${slugify(input.id || name)}-${suffix}`
  }

  const now = new Date().toISOString()
  const meta = {
    id,
    name,
    term: input.term || '',
    teacher: input.teacher || '',
    institution: input.institution || '',
    description: input.description || '',
    keywords: Array.isArray(input.keywords) ? input.keywords : [],
    startDate: input.startDate || '',
    endDate: input.endDate || '',
    calendarId: '',
    termId: '',
    meetingSlot: null,
    weekOverrides: [],
    code: input.code || '',
    titleEn: input.titleEn || '',
    titleZh: input.titleZh || '',
    prerequisites: input.prerequisites || '',
    instructors: [],
    cilos: [],
    assessment: [],
    weekly: [],
    textbooks: [],
    references: [],
    almanacUrl: '',
    createdAt: now,
    updatedAt: now,
    schedule: normalizeSchedule(input.schedule),
  }

  const dir = courseDir(root, id)
  await fsp.mkdir(dir, { recursive: true })
  for (const stage of STAGES) {
    await fsp.mkdir(path.join(dir, stage.key), { recursive: true })
  }
  await fsp.mkdir(path.join(dir, JOB_DIR), { recursive: true })
  await writeJson(path.join(dir, 'course.json'), meta)
  await fsp.writeFile(path.join(dir, 'COURSE.md'), LEDGER(meta, dir), 'utf8')
  await fsp.writeFile(
    path.join(dir, '10_kb', '课程资料标准.md'),
    MATERIAL_STANDARD,
    'utf8',
  )
  return getCourse(root, id)
}

function normalizeSchedule(schedule) {
  if (!Array.isArray(schedule)) return []
  return schedule
    .filter((item) => item && item.date)
    .map((item, index) => ({
      id: String(item.id || `m${index + 1}`),
      date: String(item.date),
      title: String(item.title || '未命名节点'),
      kind: ['lecture', 'deadline', 'exam', 'reading', 'other'].includes(item.kind)
        ? item.kind
        : 'lecture',
      note: String(item.note || ''),
      done: Boolean(item.done),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

const OVERRIDE_KINDS = ['cancelled', 'moved', 'online', 'extra', 'other']

export function normalizeSlot(slot) {
  if (!slot || typeof slot !== 'object') return null
  const weekday = Number(slot.weekday)
  return {
    weekday: weekday >= 1 && weekday <= 7 ? weekday : 1,
    start: String(slot.start || ''),
    end: String(slot.end || ''),
    location: String(slot.location || ''),
  }
}

export function normalizeOverrides(list) {
  if (!Array.isArray(list)) return []
  return list
    .filter((item) => item && Number(item.week) > 0)
    .map((item) => ({
      week: Number(item.week),
      kind: OVERRIDE_KINDS.includes(item.kind) ? item.kind : 'other',
      date: String(item.date || ''),
      note: String(item.note || ''),
    }))
    .sort((a, b) => a.week - b.week)
}

export async function updateCourse(root, id, patch = {}) {
  const paths = coursePaths(root, id)
  const meta = await readJson(paths.meta)
  if (!meta) return null
  const next = { ...meta }
  for (const key of ['name', 'term', 'teacher', 'institution', 'description', 'startDate', 'endDate']) {
    if (typeof patch[key] === 'string') next[key] = patch[key]
  }
  if (Array.isArray(patch.keywords)) next.keywords = patch.keywords.map(String)
  if (Array.isArray(patch.schedule)) next.schedule = normalizeSchedule(patch.schedule)
  if (typeof patch.calendarId === 'string') next.calendarId = patch.calendarId
  if (typeof patch.termId === 'string') next.termId = patch.termId
  if ('meetingSlot' in patch) next.meetingSlot = normalizeSlot(patch.meetingSlot)
  if (Array.isArray(patch.weekOverrides)) next.weekOverrides = normalizeOverrides(patch.weekOverrides)
  next.updatedAt = new Date().toISOString()
  await writeJson(paths.meta, next)
  return getCourse(root, id)
}

const EXTRACTED_PATH = '10_kb/extracted.json'
const TEXT_FIELDS = [
  'name',
  'code',
  'titleEn',
  'titleZh',
  'term',
  'teacher',
  'institution',
  'description',
  'prerequisites',
  'startDate',
  'endDate',
  'almanacUrl',
]

const LIST_FIELDS = [
  'instructors',
  'cilos',
  'assessment',
  'weekly',
  'textbooks',
  'references',
]

/**
 * 把 10_kb/extracted.json 的提取结果写进课程。
 * 默认只填空白字段、按日期加节点，不覆盖已有内容；
 * options.overwrite 为真时用提取值覆盖，options.mode 为 replace 时整体替换时间轴。
 */
export async function applyExtracted(root, id, options = {}) {
  const paths = coursePaths(root, id)
  const current = await readJson(paths.meta)
  if (!current) return null

  const stored = await readJson(resolveInCourse(root, id, EXTRACTED_PATH))
  const source = { ...(stored || {}), ...(options.fields || {}) }

  if (options.dismiss) {
    if (stored) {
      stored.appliedAt = new Date().toISOString()
      await writeJson(resolveInCourse(root, id, EXTRACTED_PATH), stored)
    }
    return getCourse(root, id)
  }

  const next = { ...current }
  for (const key of TEXT_FIELDS) {
    const value = source[key]
    if (typeof value !== 'string' || !value.trim()) continue
    if (options.overwrite || !String(current[key] || '').trim()) {
      next[key] = value.trim()
    }
  }

  if (Array.isArray(source.keywords) && source.keywords.length) {
    next.keywords = [...new Set([...(current.keywords || []), ...source.keywords.map(String)])]
  }

  for (const key of LIST_FIELDS) {
    const value = source[key]
    if (!Array.isArray(value) || value.length === 0) continue
    next[key] = options.overwrite || !Array.isArray(current[key]) || current[key].length === 0
      ? value
      : current[key]
  }

  const incoming = normalizeSchedule(source.schedule)
  if (options.mode === 'replace') {
    next.schedule = incoming
  } else if (incoming.length) {
    const existing = Array.isArray(current.schedule) ? current.schedule : []
    const seen = new Set(existing.map((item) => `${item.date}|${item.title}`))
    next.schedule = normalizeSchedule([
      ...existing,
      ...incoming.filter((item) => !seen.has(`${item.date}|${item.title}`)),
    ])
  }

  next.updatedAt = new Date().toISOString()
  await writeJson(paths.meta, next)

  if (stored) {
    stored.appliedAt = new Date().toISOString()
    await writeJson(resolveInCourse(root, id, EXTRACTED_PATH), stored)
  }
  return getCourse(root, id)
}

export async function deleteCourse(root, id) {
  const dir = courseDir(root, id)
  if (!(await pathExists(dir))) return false
  await fsp.rm(dir, { recursive: true, force: true })
  return true
}

/** 保证每门课都有资料标准文件，早于该文件出现的课程会被补齐。 */
export async function ensureMaterialStandard(root) {
  let entries = []
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return 0
  }
  let written = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    if (!(await pathExists(path.join(dir, 'course.json')))) continue
    const target = path.join(dir, '10_kb', '课程资料标准.md')
    if (await pathExists(target)) continue
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, MATERIAL_STANDARD, 'utf8')
    written += 1
  }
  return written
}

export async function listFiles(root, id, subPath = '') {
  const target = resolveInCourse(root, id, subPath)
  const results = []
  const walk = async (current, rel) => {
    let entries
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(current, entry.name)
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(full, relPath)
      } else if (entry.isFile()) {
        const stat = await fsp.stat(full)
        results.push({
          path: relPath,
          name: entry.name,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          ext: path.extname(entry.name).toLowerCase(),
        })
      }
    }
  }
  await walk(target, '')
  results.sort((a, b) => b.modified.localeCompare(a.modified))
  return results
}
