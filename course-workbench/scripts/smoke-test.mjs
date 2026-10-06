#!/usr/bin/env node
/**
 * 冒烟测试：真起一个服务，走一遍最关键的路径。
 * 用临时课程目录，不碰 courses/。跑法：npm run smoke
 */
import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCalendar, parseIcs } from '../server/calendar.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(here, '..')
const PORT = Number(process.env.SMOKE_PORT || 8799)
const base = `http://127.0.0.1:${PORT}`
const STAGES = JSON.parse(
  await fsp.readFile(path.join(appRoot, 'skills/lecture-knowledge-pipeline/stages.json'), 'utf8'),
)

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : ' :: ' + detail}`)
}

// ---- 校历解析：不依赖网络 ----
const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260817',
  "SUMMARY:First day of 1st semester's classes",
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261001',
  'SUMMARY:National Day',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261205',
  "SUMMARY:Last day of 1st semester's classes",
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261207',
  'DTEND;VALUE=DATE:20261212',
  "SUMMARY:1st semester's final examinations",
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

const events = parseIcs(ICS)
check('parseIcs 解析出 4 个日程', events.length === 4, 'got ' + events.length)
const term = buildCalendar(events, { id: 'smoke' }).terms[0]
check('学期起始日解析正确', term?.teachingStart === '2026-08-17', JSON.stringify(term?.teachingStart))
check('学期结束日解析正确', term?.teachingEnd === '2026-12-05', JSON.stringify(term?.teachingEnd))
check('假期被识别出来', (term?.holidays || []).some((d) => d.date === '2026-10-01'))
check('考试周解析出来', term?.examStart === '2026-12-07' && term?.examEnd === '2026-12-12')

// ---- 起服务 ----
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'course-workbench-smoke-'))
const server = spawn(process.execPath, [path.join(appRoot, 'server/index.mjs')], {
  env: { ...process.env, PORT: String(PORT), COURSE_ROOT: tmp },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
server.stdout.on('data', (chunk) => { serverLog += chunk })
server.stderr.on('data', (chunk) => { serverLog += chunk })

const request = (url, init) => fetch(base + url, init)
const json = async (url, init) => {
  const response = await request(url, init)
  return { status: response.status, body: await response.json().catch(() => null) }
}

try {
  let health = null
  for (let attempt = 0; attempt < 40 && !health; attempt += 1) {
    try {
      const result = await json('/api/health')
      if (result.status === 200) health = result.body
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  check('服务起来了 /api/health', !!health?.ok, serverLog.trim())
  check('健康检查报出阶段数', health?.stages === STAGES.length, String(health?.stages))

  const stages = await json('/api/stages')
  check('列出整理任务', (stages.body?.tasks || []).length > 0)
  check('任务里有 extract_course', (stages.body?.tasks || []).some((t) => t.key === 'extract_course'))

  const created = await json('/api/courses', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '冒烟测试课' }),
  })
  check('建课返回 201', created.status === 201, String(created.status))
  const id = created.body?.course?.id
  check('建课返回课程 id', !!id, JSON.stringify(created.body))

  const dir = path.join(tmp, id)
  const missing = []
  for (const stage of STAGES) {
    if (!(await fsp.stat(path.join(dir, stage.key)).catch(() => null))) missing.push(stage.key)
  }
  check('按 stages.json 建好全部阶段目录', missing.length === 0, missing.join(','))
  check('course.json 落盘', !!(await fsp.stat(path.join(dir, 'course.json')).catch(() => null)))
  const ledger = await fsp.readFile(path.join(dir, 'COURSE.md'), 'utf8')
  check('台账模板渲染出标题', ledger.includes('课程流水线台账'))
  check('台账每个阶段一行', STAGES.every((s) => ledger.includes(s.key + '/')))
  const standard = await fsp.readFile(path.join(dir, '10_kb/课程资料标准.md'), 'utf8')
  check('资料标准写进课程（与技能同一份）', standard.includes('课程资料标准') && standard.includes('七部分结构'))

  const uploaded = await request(
    `/api/courses/${id}/upload?stage=00_source&rel=week-01&name=note.txt`,
    { method: 'POST', body: 'hello' },
  )
  check('上传返回 201', uploaded.status === 201, String(uploaded.status))

  const files = await json(`/api/courses/${id}/files?stage=00_source`)
  const list = files.body?.files || []
  check('上传的文件出现在列表里', list.length === 1, JSON.stringify(list))
  check('文件路径按周归档', list[0]?.path === 'week-01/note.txt', String(list[0]?.path))
  check('体积格式化正确', list[0]?.sizeLabel === '5 B', String(list[0]?.sizeLabel))

  const courses = await json('/api/courses')
  check('课程列表带 11 个阶段状态', (courses.body?.courses?.[0]?.stages || []).length === STAGES.length)
  check('材料计数跟着变', courses.body?.courses?.[0]?.materialCount === 1, String(courses.body?.courses?.[0]?.materialCount))

  const escaped = await request(`/api/courses/${id}/text?path=${encodeURIComponent('../../../etc/passwd')}`)
  check('读文件越界被挡住', escaped.status >= 400, String(escaped.status))
  const escapeUpload = await request(`/api/courses/${id}/upload?stage=00_source&rel=../../escape&name=x.txt`, {
    method: 'POST',
    body: 'x',
  })
  check('上传越界被挡住', escapeUpload.status >= 400, String(escapeUpload.status))
  const outside = await fsp.stat(path.join(tmp, '..', 'escape')).catch(() => null)
  check('越界文件没有真的写出去', outside === null)

  const text = await json(`/api/courses/${id}/text?path=${encodeURIComponent('10_kb/课程资料标准.md')}`)
  check('课程资料标准可读回', (text.body?.text || '').includes('七部分结构'))
} finally {
  server.kill()
  await fsp.rm(tmp, { recursive: true, force: true })
}

console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
process.exit(failures ? 1 : 0)
