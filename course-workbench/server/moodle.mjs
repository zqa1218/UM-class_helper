import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * UM Moodle 导入：给一个课程 id，把课件（PPT / PDF）拉进 00_source/week-NN/，
 * 顺便把每节课的时间整理成课程节点。不用人工点网页，只要一份登录凭据。
 *
 * 两种凭据，有哪个用哪个：
 * - token：Moodle Web service / 手机端的 token，走 JSON 接口（core_course_get_contents 等），最省事；
 * - session：浏览器里登录后的 MoodleSession cookie，走网页解析。UM 是全 SSO，一般用这个。
 * 凭据只从 workbench.config.json 的 moodle 段或环境变量读，不落进课程目录，也不回给前端。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) course-workbench'
const DEFAULT_BASE = 'https://ummoodle.um.edu.mo'
const DEFAULT_INCLUDE = ['ppt', 'pptx', 'pdf']
const REQUEST_MS = 60 * 1000
const DOWNLOAD_MS = 10 * 60 * 1000

export function moodleConfig(config = {}) {
  const m = { ...(config.moodle || {}) }
  const env = process.env
  const first = (...values) => String(values.find((value) => value) || '')
  return {
    baseUrl: first(env.WORKBENCH_MOODLE_BASE_URL, m.baseUrl, DEFAULT_BASE).replace(/\/+$/, ''),
    token: first(env.WORKBENCH_MOODLE_TOKEN, m.token),
    session: first(env.WORKBENCH_MOODLE_SESSION, m.session),
    include: normalizeExts(m.include),
  }
}

function normalizeExts(value) {
  const list = Array.isArray(value) && value.length ? value : DEFAULT_INCLUDE
  return [...new Set(list.map((item) => String(item).replace(/^\./, '').toLowerCase()).filter(Boolean))]
}

/** 给前端看的连接状态；凭据本身不外传。 */
export function moodleStatus(cfg) {
  return {
    baseUrl: cfg.baseUrl,
    include: cfg.include,
    mode: cfg.token ? 'token' : cfg.session ? 'cookie' : '',
    configured: Boolean(cfg.token || cfg.session),
  }
}

const AUTH_HINT = [
  '还没配 Moodle 登录凭据。两种办法，挑一个：',
  '① 浏览器登录 ummoodle 后按 F12 → Application → Cookies，把 MoodleSession 的值填进',
  '   workbench.config.json 的 moodle.session（或设环境变量 WORKBENCH_MOODLE_SESSION）；',
  '② 有 Moodle Web service token 的话，填 moodle.token（或设 WORKBENCH_MOODLE_TOKEN），走 JSON 接口更稳。',
].join('')

function assertAuth(cfg) {
  if (!cfg.token && !cfg.session) throw new Error(AUTH_HINT)
}

/** 用户可能贴整条 cookie，也可能只贴 MoodleSession 的值。 */
function cookieHeader(session) {
  const raw = String(session).trim().replace(/^cookie:\s*/i, '')
  return /(^|;\s*)MoodleSession=/.test(raw) ? raw : `MoodleSession=${raw}`
}

async function get(cfg, url, { timeout = REQUEST_MS, redirect = 'follow' } = {}) {
  const headers = { 'user-agent': UA, accept: '*/*' }
  if (!cfg.token && cfg.session) headers.cookie = cookieHeader(cfg.session)
  return await fetch(url, { headers, redirect, signal: AbortSignal.timeout(timeout) })
}

async function ws(cfg, fn, params = {}) {
  const url = new URL(cfg.baseUrl + '/webservice/rest/server.php')
  url.searchParams.set('wstoken', cfg.token)
  url.searchParams.set('wsfunction', fn)
  url.searchParams.set('moodlewsrestformat', 'json')
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item, index) => url.searchParams.set(`${key}[${index}]`, String(item)))
    else url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(REQUEST_MS) })
  const text = await response.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Moodle 接口没返回 JSON（HTTP ${response.status}）：` + text.slice(0, 200))
  }
  if (data && (data.exception || data.error)) {
    const code = data.errorcode ? `（${data.errorcode}）` : ''
    throw new Error('Moodle 接口报错' + code + '：' + String(data.message || data.error))
  }
  return data
}

/** 连一下，确认凭据还能用。 */
export async function moodleCheck(cfg) {
  assertAuth(cfg)
  if (cfg.token) {
    const info = await ws(cfg, 'core_webservice_get_site_info')
    return { ok: true, mode: 'token', site: String(info?.sitename || ''), user: String(info?.username || '') }
  }
  const response = await get(cfg, `${cfg.baseUrl}/my/`, { redirect: 'manual' })
  if (response.status >= 300 && response.status < 400) {
    throw new Error('Moodle 说这个会话没登录（被跳到 ' + (response.headers.get('location') || '登录页') + '）。重新登录一次，把新的 MoodleSession 填进来。')
  }
  const text = await response.text()
  if (/name="logintoken"/.test(text) || /id="page-login-index"/.test(text)) {
    throw new Error('Moodle 返回的是登录页，说明 MoodleSession 已过期或填错了。')
  }
  return { ok: true, mode: 'cookie', site: decodeEntities(titleOf(text)), user: '' }
}

/** 课程大纲：优先 token 的 JSON 接口，否则解析课程页。 */
export async function fetchMoodleCourse(cfg, courseId) {
  assertAuth(cfg)
  const id = String(courseId).trim()
  if (!/^\d+$/.test(id)) throw new Error('课程 id 应该是网址里 view.php?id= 后面那串数字，例如 44187')
  return cfg.token ? await courseViaService(cfg, id) : await courseViaHtml(cfg, id)
}

/** 给界面看的预览：下载地址里可能带着 token，换成文件名再往外给。 */
export function publicMoodleCourse(course) {
  return {
    id: course.id,
    fullname: course.fullname,
    shortname: course.shortname,
    startDate: course.startDate,
    source: course.source,
    events: (course.events || []).map((event) => ({
      name: event.name,
      date: event.date,
      time: event.time,
    })),
    sections: course.sections.map((section) => ({
      index: section.index,
      name: section.name,
      text: section.text,
      date: section.date,
      time: section.time,
      modules: section.modules.map((mod) => ({
        id: mod.id,
        name: mod.name,
        modname: mod.modname,
        files: mod.files.map((file) => ({ name: file.name, size: file.size })),
      })),
    })),
  }
}

async function courseViaService(cfg, id) {
  const found = await ws(cfg, 'core_course_get_courses_by_field', { field: 'id', value: id })
  const meta = (found?.courses || [])[0] || {}
  let raw = []
  try {
    raw = await ws(cfg, 'core_course_get_contents', { courseid: id })
  } catch (error) {
    throw new Error('读不到这门课的目录：' + String(error.message) + '（确认这个账号选了这门课）')
  }
  const events = await ws(cfg, 'core_calendar_get_action_events_by_course', {
    courseid: id,
    limitnum: 0,
  }).catch(() => [])

  const sections = (Array.isArray(raw) ? raw : []).map((section) => {
    const when = parseWhen(`${section.name || ''} ${stripTags(section.summary || '')}`)
    return {
      index: Number(section.section) || 0,
      name: clean(section.name) || `第 ${section.section} 节`,
      text: clean(stripTags(section.summary || '')).slice(0, 300),
      date: when.date,
      time: when.time,
      modules: (section.modules || []).map((mod) => ({
        id: mod.id,
        name: clean(mod.name),
        modname: String(mod.modname || ''),
        url: String(mod.url || ''),
        files: (mod.contents || [])
          .filter((file) => wanted(cfg, file.filename || file.fileurl))
          .map((file) => ({
            name: clean(file.filename) || fileNameFromUrl(file.fileurl),
            url: withToken(file.fileurl, cfg.token),
            size: Number(file.filesize) || 0,
          })),
      })),
    }
  })

  return {
    id,
    fullname: clean(meta.fullname) || `Moodle 课程 ${id}`,
    shortname: clean(meta.shortname),
    startDate: meta.startdate ? new Date(Number(meta.startdate) * 1000).toISOString().slice(0, 10) : '',
    source: 'token',
    sections: sections.filter((section) => section.modules.length || section.index > 0),
    events: (Array.isArray(events) ? events : (events?.events || [])).map((event) => ({
      name: clean(event.name),
      date: event.timestart ? new Date(Number(event.timestart) * 1000).toISOString().slice(0, 10) : '',
      time: event.timestart
        ? new Date(Number(event.timestart) * 1000).toTimeString().slice(0, 5)
        : '',
      modname: String(event.modulename || ''),
    })).filter((event) => event.date),
  }
}

async function courseViaHtml(cfg, id) {
  const response = await get(cfg, `${cfg.baseUrl}/course/view.php?id=${id}`, { redirect: 'manual' })
  if (response.status >= 300 && response.status < 400) {
    const to = response.headers.get('location') || ''
    throw new Error(
      /login|sso|adfs/i.test(to)
        ? 'Moodle 把请求跳到了登录页，说明 MoodleSession 过期或不对。重新登录后换上新 cookie 再试。'
        : `Moodle 跳转到了 ${to}，没能读到课程页。`,
    )
  }
  const text = await response.text()
  if (/name="logintoken"/.test(text) || /id="page-login-index"/.test(text)) {
    throw new Error('Moodle 返回的是登录页，说明 MoodleSession 过期或不对。')
  }
  const title = titleOf(text)
  const sections = parseCourseHtml(text)
  if (!sections.length) {
    throw new Error('这个页面上没找到课程小节。确认 id 是课程 id、账号选修了这门课，或改用 moodle.token 走 JSON 接口。')
  }
  // 网页模式的文件要再点一层才看得见。预览时先解析好，界面上才知道这一节要拉哪些文件；
  // 非文件型活动（论坛、测验）不花请求。
  for (const section of sections) {
    for (const mod of section.modules) {
      mod.files = await resolveModuleFiles(cfg, mod)
    }
  }
  const events = []
  for (const section of sections) {
    if (section.date) events.push({ name: section.name, date: section.date, time: section.time, modname: '' })
  }
  return {
    id,
    fullname: clean(title.replace(/^Course:\s*/i, '').split('|')[0]) || `Moodle 课程 ${id}`,
    shortname: '',
    startDate: '',
    source: 'cookie',
    sections,
    events,
  }
}

/** 解析课程页：li#section-N 是小节，里面的 li.activity 是活动。导出是为了能拿真实页面单独验。 */
export function parseCourseHtml(html) {
  const marks = []
  const sectionRe = /<li[^>]*\bid="section-(\d+)"[^>]*>/g
  for (const match of html.matchAll(sectionRe)) {
    marks.push({ number: Number(match[1]), start: match.index, tagEnd: match.index + match[0].length, tag: match[0] })
  }
  const sections = []
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i]
    const body = html.slice(mark.tagEnd, i + 1 < marks.length ? marks[i + 1].start : html.length)
    const name =
      clean(attr(mark.tag, 'data-sectionname')) ||
      clean(stripTags(regexOne(body, /<h3[^>]*class="[^"]*sectionname[^"]*"[^>]*>([\s\S]*?)<\/h3>/i))) ||
      (mark.number === 0 ? '课程说明' : `第 ${mark.number} 节`)
    const summary = regexOne(body, /<div[^>]*class="[^"]*(?:summarytext|section-summary)[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    const when = parseWhen(`${name} ${stripTags(summary || '')}`)
    sections.push({
      index: mark.number,
      name,
      text: clean(stripTags(summary || '')).slice(0, 300),
      date: when.date,
      time: when.time,
      modules: parseModules(body),
    })
  }
  return sections
}

function parseModules(body) {
  const marks = []
  const activityRe = /<li[^>]*\bclass="[^"]*\bactivity\b[^"]*"[^>]*\bid="module-(\d+)"[^>]*>/g
  for (const match of body.matchAll(activityRe)) {
    marks.push({ id: Number(match[1]), start: match.index, tagEnd: match.index + match[0].length, tag: match[0] })
  }
  return marks.map((mark, index) => {
    const chunk = body.slice(mark.tagEnd, index + 1 < marks.length ? marks[index + 1].start : body.length)
    // 活动名在 activity-item 的 data-activityname 里最干净；退回 instancename 时要先抠掉「File」这类给读屏用的隐藏文字
    const visible = chunk.replace(/<span[^>]*class="[^"]*accesshide[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
    const modname = (attr(mark.tag, 'class').match(/modtype_([a-z0-9_]+)/) || [])[1] || ''
    const name =
      clean(attr(mark.tag, 'data-activityname')) ||
      clean(attr(chunk, 'data-activityname')) ||
      clean(stripTags(regexOne(visible, /<span[^>]*class="[^"]*instancename[^"]*"[^>]*>([\s\S]*?)<\/span>/i)))
    const url = decodeEntities(
      regexOne(visible, /<a[^>]+href="([^"]*\/mod\/[^"]*\/view\.php\?[^"]*)"/i) ||
        attr(mark.tag, 'data-url'),
    )
    return { id: mark.id, name, modname, url, files: [] }
  })
}

/** 文件型活动要再点一层：resource 会 303 到 pluginfile，folder 在页面里列文件。 */
async function resolveModuleFiles(cfg, mod) {
  // token 模式下文件已经在 contents 里，不用再去点页面
  if (cfg.token) return []
  if (!mod.url || !['resource', 'folder', 'url', 'book', 'page'].includes(mod.modname)) return []
  let response
  try {
    response = await get(cfg, mod.url, { redirect: 'manual' })
  } catch {
    return []
  }
  if (response.status >= 300 && response.status < 400) {
    const to = decodeEntities(response.headers.get('location') || '')
    return to && wanted(cfg, to) ? [{ name: fileNameFromUrl(to), url: to, size: 0 }] : []
  }
  const text = await response.text()
  const found = new Map()
  for (const re of [
    /<a[^>]+href="([^"]*pluginfile\.php[^"]*)"/gi,
    /<object[^>]+data="([^"]*pluginfile\.php[^"]*)"/gi,
    /<embed[^>]+src="([^"]*pluginfile\.php[^"]*)"/gi,
    /<source[^>]+src="([^"]*pluginfile\.php[^"]*)"/gi,
  ]) {
    for (const match of text.matchAll(re)) {
      const url = decodeEntities(match[1])
      if (wanted(cfg, url)) found.set(url, { name: fileNameFromUrl(url), url, size: 0 })
    }
  }
  if (!found.size && mod.modname === 'url') return []
  return [...found.values()]
}

/** 把课件拉下来。返回落盘清单；同名文件不覆盖，跳过并在 skipped 里说明。 */
export async function importMoodleFiles({ cfg, course, destRoot, only, onProgress = () => {} }) {
  const pick = new Set((only || []).map(String))
  const files = []
  const skipped = []
  let order = 0
  const plans = []
  for (const section of course.sections) {
    if (pick.size && !pick.has(String(section.index))) continue
    const found = []
    for (const mod of section.modules) {
      const modFiles = mod.files.length ? mod.files : await resolveModuleFiles(cfg, mod)
      for (const file of modFiles) found.push({ ...file, module: mod.name })
    }
    if (!found.length) continue
    order += 1
    plans.push({ section, week: weekOf(section.name, order), found })
  }

  for (const plan of plans) {
    const dirName = `week-${String(plan.week).padStart(2, '0')}`
    await fsp.mkdir(path.join(destRoot, dirName), { recursive: true })
    for (const file of plan.found) {
      const rel = `${dirName}/${safeName(file.name)}`
      const target = path.join(destRoot, rel)
      if (await exists(target)) {
        skipped.push({ name: file.name, reason: '同名文件已存在，没覆盖' })
        continue
      }
      onProgress(`↓ ${rel}`)
      try {
        const size = await download(cfg, file.url, target)
        files.push({ ...file, section: plan.section.name, week: plan.week, date: plan.section.date, path: rel, size })
      } catch (error) {
        skipped.push({ name: file.name, reason: String(error.message) })
      }
    }
  }
  return { files, skipped }
}

async function download(cfg, url, target) {
  const response = await get(cfg, url, { timeout: DOWNLOAD_MS })
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) throw new Error('下载到 0 字节')
  await fsp.writeFile(target, buffer)
  return buffer.length
}

/** 每节课的时间：小节名/摘要里的日期时间，读不到就留给日历事件。 */
export function parseWhen(text) {
  const source = String(text || '')
  const clock = source.match(/(?:^|[^\d])(\d{1,2}):(\d{2})(?!\d)/)
  return {
    date: parseDate(source),
    time: clock ? `${clock[1].padStart(2, '0')}:${clock[2]}` : '',
  }
}

/**
 * 只认写法明确、不容易误判的日期：带年份的、中文的年月日、英文月份，
 * 「1-2」「0 / 6」这种数字串一律不当日期，宁可留给人工补。
 */
function parseDate(source) {
  let match = source.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/)
  if (match) return iso(match[1], match[2], match[3])

  match = source.match(/(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})/)
  if (match) {
    const first = Number(match[1])
    const second = Number(match[2])
    const dayFirst = first > 12 || second <= 12
    return dayFirst ? iso(match[3], second, first) : iso(match[3], first, second)
  }

  match = source.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/) // 9月15日
  if (match) return iso(undefined, match[1], match[2])
  match = source.match(/(\d{1,2})\s*日\s*(\d{1,2})\s*月/) // 15日9月
  if (match) return iso(undefined, match[2], match[1])

  match = source.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/)
  if (match) {
    const month = MONTHS[match[1].slice(0, 3).toLowerCase()]
    if (month) return iso(undefined, month, match[2])
  }
  match = source.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\b/)
  if (match) {
    const month = MONTHS[match[2].slice(0, 3).toLowerCase()]
    if (month) return iso(undefined, month, match[1])
  }
  return ''
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function iso(year, month, day) {
  const m = Number(month)
  const d = Number(day)
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return ''
  const y = Number(year) || new Date().getFullYear()
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** 小节名里的周次：第 3 周 / Week 3 / W3。读不到就用顺序。 */
export function weekOf(name, index) {
  const match = String(name || '').match(/第\s*(\d{1,2})\s*周|week\s*0*(\d{1,2})|\bw(\d{1,2})\b/i)
  const week = match ? Number(match[1] || match[2] || match[3]) : 0
  return week > 0 && week <= 30 ? week : index
}

function wanted(cfg, nameOrUrl) {
  const ext = String(nameOrUrl || '').split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() || ''
  return cfg.include.includes(ext)
}

function withToken(url, token) {
  const raw = String(url || '')
  if (!raw || !token) return raw
  if (/\btoken=/.test(raw)) return raw
  return raw + (raw.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token)
}

function fileNameFromUrl(url) {
  const raw = String(url || '').split('?')[0].split('#')[0]
  const name = decodeURIComponent(raw.split('/').pop() || '')
  return name || 'download.bin'
}

function safeName(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  return cleaned.slice(0, 120) || 'download.bin'
}

function attr(tag, name) {
  const match = String(tag).match(new RegExp(name + '="([^"]*)"'))
  return match ? match[1] : ''
}

function regexOne(text, re) {
  const match = String(text).match(re)
  return match ? match[1] : ''
}

function titleOf(html) {
  return regexOne(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || ''
}

function stripTags(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
}

function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function clean(text) {
  return decodeEntities(String(text || '')).replace(/\s+/g, ' ').trim()
}

async function exists(target) {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}
