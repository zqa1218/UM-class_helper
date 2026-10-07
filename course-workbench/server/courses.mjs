import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = path.join(here, '..', 'skills', 'lecture-knowledge-pipeline')

async function readSkillFile(rel) {
  try {
    return await fsp.readFile(path.join(SKILL_DIR, rel), 'utf8')
  } catch {
    return ''
  }
}

/**
 * 阶段目录只认技能里的 stages.json：工作台和 $lecture-knowledge-pipeline 技能共用一份，
 * 不再各写一份再慢慢走偏。
 */
const stagesRaw = await readSkillFile('stages.json')
if (!stagesRaw) throw new Error('缺少 skills/lecture-knowledge-pipeline/stages.json：阶段目录的唯一来源')
export const STAGES = JSON.parse(stagesRaw)

const JOB_DIR = '_jobs'

/** 课程资料标准：写进每门课的 10_kb/，也是提取任务读的字段清单。 */
const MATERIAL_STANDARD = await readSkillFile('references/syllabus-standard.md')
if (!MATERIAL_STANDARD) throw new Error('缺少 skills/lecture-knowledge-pipeline/references/syllabus-standard.md')

/** 台账模板：和技能脚本共用同一个文件。 */
const LEDGER_TEMPLATE = await readSkillFile('assets/ledger-template.md')
if (!LEDGER_TEMPLATE) throw new Error('缺少 skills/lecture-knowledge-pipeline/assets/ledger-template.md')

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

/**
 * 课程 id 只能是 root 下的一层目录名。百分号编码的 `%2e%2e` 不会被 URL 归一化掉，
 * 一旦漏进 path.join 就会解析到课程目录以外，删除/读取都越界。
 */
export function isCourseId(id) {
  return (
    typeof id === 'string' &&
    id !== '' &&
    id !== '.' &&
    id !== '..' &&
    !id.includes('/') &&
    !id.includes('\\')
  )
}

function courseDir(root, id) {
  if (!isCourseId(id)) throw new Error('非法课程 id')
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

/** 递归目录遍历；跳过点开头的条目。两个调用方共用一份。 */
async function walkFiles(dir, onFile, rel = '') {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    const relPath = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) await walkFiles(full, onFile, relPath)
    else if (entry.isFile()) await onFile(relPath, full)
  }
}

/** 只数个数，不 stat：每次刷新都要跑，省掉逐文件的系统调用。 */
async function countFiles(dir) {
  let files = 0
  await walkFiles(dir, async () => {
    files += 1
  })
  return files
}

async function stageStates(root, id) {
  const dir = courseDir(root, id)
  const states = []
  for (const stage of STAGES) {
    const files = await countFiles(path.join(dir, stage.key))
    states.push({ ...stage, files, status: files === 0 ? 'empty' : 'ready' })
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

/** 按台账模板渲染；占位符见 skills/lecture-knowledge-pipeline/assets/ledger-template.md。 */
function renderLedger(meta, directory) {
  const rows = STAGES.map(
    (stage, index) => `| ${index} · ${stage.label} | \`${stage.key}/\` | 未开始 | |`,
  ).join('\n')
  const values = {
    name: meta.name,
    today: new Date().toISOString().slice(0, 10),
    root: directory,
    term: meta.term || '未填',
    teacher: meta.teacher || '未填',
    rows,
  }
  return LEDGER_TEMPLATE.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match,
  )
}

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
  await fsp.writeFile(path.join(dir, 'COURSE.md'), renderLedger(meta, dir), 'utf8')
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
  await walkFiles(target, async (relPath, full) => {
    const stat = await fsp.stat(full)
    results.push({
      path: relPath,
      name: path.basename(relPath),
      size: stat.size,
      modified: stat.mtime.toISOString(),
      ext: path.extname(relPath).toLowerCase(),
    })
  })
  results.sort((a, b) => b.modified.localeCompare(a.modified))
  return results
}
