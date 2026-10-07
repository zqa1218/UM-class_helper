#!/usr/bin/env node
/**
 * 冒烟测试：真起一个服务，走一遍最关键的路径。
 * 用临时课程目录 + 本地假接口，不联网、不碰 courses/。跑法：npm run smoke
 */
import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCalendar, parseIcs } from '../server/calendar.mjs'
import { missingArtifacts } from '../server/pipeline.mjs'

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

// ---- 假的 OpenAI 兼容接口：不联网也能验「工作台自己调 API」这条路 ----
const API_PORT = Number(process.env.SMOKE_API_PORT || PORT + 1)
// 1x1 的 PNG，只用来占位当「题目截图」
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)
const OCR_TEXT = '1. 神经系统的基本结构和功能单位是（ ）A. 神经元 B. 神经胶质细胞 答案：A'
const IMG_ITEMS = [
  {
    id: 'IMG-001',
    type: 'single',
    stem: '神经系统的基本结构和功能单位是（ ）',
    options: { A: '神经元', B: '神经胶质细胞' },
    answer: ['A'],
    explanation: '图片已给答案。',
    pointIds: ['CN01-01'],
    difficulty: '基础',
    sources: ['题目图片 q1.png 第 1 题（图片已给答案）'],
    images: ['09_quiz/images/q1.png'],
    isExtension: false,
  },
  {
    id: 'IMG-002',
    type: 'single',
    stem: '动作电位上升支主要由哪种离子内流形成？',
    options: { A: 'K+', B: 'Na+', C: 'Cl-' },
    answer: ['B'],
    explanation: '待老师确认：按课程材料，上升支由 Na+ 内流形成。',
    pointIds: ['CN02-03'],
    difficulty: '中等',
    sources: ['题目图片 q1.png 第 2 题'],
    images: ['09_quiz/images/q1.png'],
    isExtension: false,
  },
]
let seenTools = false
// 笔记照片提炼出来的知识点，字段与真跑时约定的结构一致
const OUTLINE_DOC = {
  course: '冒烟测试课',
  units: [
    {
      id: 'IMG',
      title: '图片笔记整理',
      sections: [
        {
          id: 'IMG-01',
          title: '神经元',
          points: [
            {
              id: 'IMG-01-01',
              title: '神经元',
              definition: '神经系统的基本结构和功能单位',
              keywords: ['神经元'],
              level: '基础',
              sources: ['图片 06_outline/images/note1.png'],
              images: ['06_outline/images/note1.png'],
              hasSupplement: false,
            },
            {
              id: 'IMG-01-02',
              title: '神经胶质细胞',
              definition: '支持、营养神经元的细胞',
              keywords: ['胶质细胞'],
              level: '基础',
              sources: ['图片 06_outline/images/note1.png'],
              images: ['06_outline/images/note1.png'],
              hasSupplement: false,
            },
          ],
        },
      ],
    },
  ],
}
let seenRounds = 0
let seenImage = false
let visionCalls = 0
const fakeApi = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    const reply = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    if (req.url !== '/v1/chat/completions') return reply(404, { error: '未知接口' })
    try {
      const payload = JSON.parse(body)
      seenRounds += 1
      if ((payload.tools || []).length) seenTools = true
      const messages = payload.messages || []
      // 带图片的请求 = 识图调用，只回抄写结果
      if (Array.isArray(messages[0]?.content)) {
        seenImage = true
        visionCalls += 1
        return reply(200, {
          id: 'smoke-vision',
          object: 'chat.completion',
          model: payload.model,
          choices: [
            { index: 0, message: { role: 'assistant', content: OCR_TEXT }, finish_reason: 'stop' },
          ],
        })
      }
      const prompt = String(messages[1]?.content || '')
      const toolTexts = messages
        .filter((entry) => entry.role === 'tool')
        .map((entry) => String(entry.content || ''))
      const lastTool = toolTexts[toolTexts.length - 1] || ''
      const call = (name, args) => ({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-' + name + '-' + toolTexts.length,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      })
      if (prompt.includes('从图片整理题目集')) {
        let message
        if (!toolTexts.length) {
          message = call('list_files', { path: '09_quiz/images' })
        } else if (toolTexts.some((text) => text.includes('已写入 09_quiz/bank.json'))) {
          message = { role: 'assistant', content: '整理完 2 题：1 题答案从图里读到，1 题自己解。' }
        } else if (toolTexts.some((text) => text.startsWith('【'))) {
          // 抄回来的文字接着入库：题库和人读的题目集一起写，验多工具调用
          message = {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-bank',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({
                    path: '09_quiz/bank.json',
                    content: JSON.stringify({ updated: '2026-10-06', items: IMG_ITEMS }, null, 2),
                  }),
                },
              },
              {
                id: 'call-set',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({
                    path: '09_quiz/图片题目集.md',
                    content: '# 图片题目集\n\n## IMG-001\n答案：A\n',
                  }),
                },
              },
            ],
          }
        } else if (lastTool.includes('q1.png')) {
          message = call('read_image', { path: '09_quiz/images/q1.png' })
        } else {
          message = { role: 'assistant', content: '09_quiz/images/ 里没有图片，先传题目截图。' }
        }
        return reply(200, {
          id: 'smoke-quiz',
          object: 'chat.completion',
          model: payload.model,
          choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
        })
      }
      if (prompt.includes('从图片整理知识点与笔记')) {
        let message
        if (!toolTexts.length) {
          message = call('list_files', { path: '06_outline/images' })
        } else if (toolTexts.some((text) => text.includes('已写入 06_outline/outline.json'))) {
          message = { role: 'assistant', content: '整理完 1 张图、2 个知识点。' }
        } else if (toolTexts.some((text) => text.startsWith('【'))) {
          // 抄回来的文字接着提炼：大纲、人读的知识点、笔记三份一起写
          message = {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-outline',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({
                    path: '06_outline/outline.json',
                    content: JSON.stringify(OUTLINE_DOC, null, 2),
                  }),
                },
              },
              {
                id: 'call-points',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({
                    path: '06_outline/图片知识点.md',
                    content: '# 图片知识点\n\n## note1.png\n\n- IMG-01-01 神经元\n- IMG-01-02 神经胶质细胞\n',
                  }),
                },
              },
              {
                id: 'call-notes',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({
                    path: '07_notes/图片笔记.md',
                    content: '# 图片笔记\n\n## note1.png\n\n神经元是神经系统的基本结构和功能单位。（IMG-01-01）\n',
                  }),
                },
              },
            ],
          }
        } else if (lastTool.includes('note1.png')) {
          message = call('read_image', { path: '06_outline/images/note1.png' })
        } else {
          message = { role: 'assistant', content: '06_outline/images/ 里没有图片，先传笔记照片。' }
        }
        return reply(200, {
          id: 'smoke-points',
          object: 'chat.completion',
          model: payload.model,
          choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
        })
      }
      // 只认「提取课程信息」这个任务：调一次 write_file，把请求里的 prompt 也顺带验了
      const wanted = prompt.includes('从文件提取课程信息')
      const worked = toolTexts.length > 0
      const message =
        wanted && !worked
          ? {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-smoke-1',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: JSON.stringify({
                      path: '10_kb/extracted.json',
                      content: '{"name":"冒烟课"}',
                    }),
                  },
                },
              ],
            }
          : { role: 'assistant', content: wanted ? '已写出 10_kb/extracted.json。' : '没什么可做的。' }
      return reply(200, {
        id: 'smoke',
        object: 'chat.completion',
        model: payload.model,
        choices: [
          {
            index: 0,
            message,
            finish_reason: message.tool_calls ? 'tool_calls' : 'stop',
          },
        ],
      })
    } catch (error) {
      return reply(500, { error: String(error && error.message) })
    }
  })
})
await new Promise((resolve) => fakeApi.listen(API_PORT, '127.0.0.1', resolve))

// ---- 起服务 ----
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'course-workbench-smoke-'))
const server = spawn(process.execPath, [path.join(appRoot, 'server/index.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    COURSE_ROOT: tmp,
    WORKBENCH_API_BASE_URL: `http://127.0.0.1:${API_PORT}/v1`,
    WORKBENCH_API_MODEL: 'smoke-model',
    WORKBENCH_API_KEY: 'smoke-key',
  },
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
  check('健康检查报出走的是 API', health?.runner === 'api', String(health?.runner))
  check(
    '健康检查报出模型与 key 状态',
    health?.model === 'smoke-model' && health?.hasApiKey === true,
    JSON.stringify(health),
  )

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

  const absent = await missingArtifacts(dir, 'extract_course')
  check(
    '产物检查：没有产物就报缺',
    absent.join(',') === '10_kb/extracted.json',
    JSON.stringify(absent),
  )
  await fsp.writeFile(path.join(dir, '10_kb/extracted.json'), '{"name":"x"}', 'utf8')
  check('产物检查：产物齐了就算通过', (await missingArtifacts(dir, 'extract_course')).length === 0)

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
  // %2e%2e 会被 URL 归一化掉，真正能走到 id 的是编码过的反斜杠
  const traversal = await request(`/api/courses/${encodeURIComponent('a\\..\\..')}`, { method: 'DELETE' })
  check('课程 id 越界被挡住（a%5C..%5C..）', traversal.status === 400, String(traversal.status))
  check('越界删除没有动到课程目录以外', !!(await fsp.stat(path.join(appRoot, 'package.json')).catch(() => null)))
  check('越界删除没有动到别的课程', !!(await fsp.stat(dir).catch(() => null)))
  const escapeUpload = await request(`/api/courses/${id}/upload?stage=00_source&rel=../../escape&name=x.txt`, {
    method: 'POST',
    body: 'x',
  })
  check('上传越界被挡住', escapeUpload.status >= 400, String(escapeUpload.status))
  const outside = await fsp.stat(path.join(tmp, '..', 'escape')).catch(() => null)
  check('越界文件没有真的写出去', outside === null)

  const text = await json(`/api/courses/${id}/text?path=${encodeURIComponent('10_kb/课程资料标准.md')}`)
  check('课程资料标准可读回', (text.body?.text || '').includes('七部分结构'))

  // ---- 自己调 API 的整条路：工具循环 + 产物验收 ----
  const waitForJob = async (jobId) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const result = await json(`/api/courses/${id}/jobs/${jobId}`)
      const status = result.body?.job?.status
      if (status === 'done' || status === 'failed') return result.body
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return null
  }

  const jobCreated = await json(`/api/courses/${id}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage: 'extract_course' }),
  })
  check('建任务返回 201', jobCreated.status === 201, String(jobCreated.status))
  check('任务记下走的是 API', jobCreated.body?.job?.runner === 'api', String(jobCreated.body?.job?.runner))
  check(
    '提示词按 API 模式组装（让模型先读资料标准）',
    (jobCreated.body?.job?.prompt || '').includes('10_kb/课程资料标准.md'),
  )
  const worked = await waitForJob(jobCreated.body?.job?.id)
  check('API 模式任务自己跑完', worked?.job?.status === 'done', String(worked?.job?.error))
  const produced = await fsp.readFile(path.join(dir, '10_kb/extracted.json'), 'utf8').catch(() => '')
  check('模型用工具写出的产物落盘', produced.includes('冒烟课'), produced)
  check('请求里带了工具定义', seenTools)
  check('日志记下工具调用', (worked?.log || '').includes('write_file'), (worked?.log || '').slice(-200))
  check('日志记下模型小结', (worked?.job?.summary || '').includes('已写出'), String(worked?.job?.summary))

  const idle = await json(`/api/courses/${id}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage: '10_kb' }),
  })
  const idleDone = await waitForJob(idle.body?.job?.id)
  check('模型不动手时任务报失败', idleDone?.job?.status === 'failed', String(idleDone?.job?.status))
  check(
    '失败原因写明缺了产物',
    String(idleDone?.job?.error || '').includes('没有产出预期的产物'),
    String(idleDone?.job?.error),
  )
  check('跑过的轮数记在原始日志里', seenRounds >= 3, String(seenRounds))

  // ---- 图片题目：截图 → 认字 → 入库 ----
  const noImage = await json(`/api/courses/${id}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage: 'quiz_from_images' }),
  })
  const noImageDone = await waitForJob(noImage.body?.job?.id)
  check('图库里没有图片时任务报失败', noImageDone?.job?.status === 'failed', String(noImageDone?.job?.status))
  check(
    '失败原因指着缺 bank.json',
    String(noImageDone?.job?.error || '').includes('09_quiz/bank.json'),
    String(noImageDone?.job?.error),
  )

  const shot = await request(`/api/courses/${id}/upload?stage=09_quiz&rel=images&name=q1.png`, {
    method: 'POST',
    body: PNG_1PX,
  })
  check('题目截图上传进 09_quiz/images', shot.status === 201, String(shot.status))
  const quizFiles = await json(`/api/courses/${id}/files?stage=09_quiz`)
  check(
    '题目截图出现在题库目录里',
    (quizFiles.body?.files || []).some((file) => file.path === 'images/q1.png'),
    JSON.stringify(quizFiles.body?.files),
  )

  const fromImages = await json(`/api/courses/${id}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage: 'quiz_from_images' }),
  })
  const imgDone = await waitForJob(fromImages.body?.job?.id)
  check('从图片整理题目集跑完', imgDone?.job?.status === 'done', String(imgDone?.job?.error))
  const bank = await fsp
    .readFile(path.join(dir, '09_quiz/bank.json'), 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => null)
  check('题目进了 bank.json', (bank?.items || []).length === 2, JSON.stringify(bank?.items?.length))
  check(
    '题目带着原图路径与出处',
    (bank?.items || []).every(
      (item) => (item.images || []).includes('09_quiz/images/q1.png') && (item.sources || []).length > 0,
    ),
  )
  check(
    '题目集另存了一份人读版',
    !!(await fsp.stat(path.join(dir, '09_quiz/图片题目集.md')).catch(() => null)),
  )
  check('识图接口真的收到了图片', seenImage)
  check('日志记下 read_image', (imgDone?.log || '').includes('read_image'), (imgDone?.log || '').slice(-200))
  const quizText = await json(`/api/courses/${id}/text?path=${encodeURIComponent('09_quiz/bank.json')}`)
  check('题库能通过接口读回', (quizText.body?.text || '').includes('IMG-001'))

  // 同一批图再跑一遍：没长新题，任务仍然算跑完，但要留一条提示，别让人以为白跑了
  const rerun = await json(`/api/courses/${id}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage: 'quiz_from_images' }),
  })
  const rerunDone = await waitForJob(rerun.body?.job?.id)
  check('重复跑同一批图仍然是 done', rerunDone?.job?.status === 'done', String(rerunDone?.job?.error))
  check(
    '条数没涨时留一句提示',
    String(rerunDone?.job?.warning || '').includes('题库条数没有变化'),
    String(rerunDone?.job?.warning),
  )

  // ---- 删图：keep 留题只摘图，drop 连题一起删 ----
  const readBank = async () =>
    JSON.parse(await fsp.readFile(path.join(dir, '09_quiz/bank.json'), 'utf8'))
  const keepDelete = await json(`/api/courses/${id}/file?path=${encodeURIComponent('09_quiz/images/q1.png')}&questions=keep`, {
    method: 'DELETE',
  })
  check('删图（保留题目）返回 200', keepDelete.status === 200, String(keepDelete.status))
  check('删图时报告保留了 2 道题', keepDelete.body?.kept === 2, JSON.stringify(keepDelete.body))
  check('图片文件真的没了', !(await fsp.stat(path.join(dir, '09_quiz/images/q1.png')).catch(() => null)))
  const afterKeep = await readBank()
  check('题目还在', (afterKeep.items || []).length === 2, String(afterKeep.items?.length))
  check(
    '题目里不再挂着删掉的图',
    (afterKeep.items || []).every((item) => (item.images || []).length === 0),
    JSON.stringify(afterKeep.items?.[0]?.images),
  )

  const reUpload = await request(`/api/courses/${id}/upload?stage=09_quiz&rel=images&name=q1.png`, {
    method: 'POST',
    body: PNG_1PX,
  })
  check('重新传回图片', reUpload.status === 201, String(reUpload.status))
  // 重跑一次任务，让题目重新挂上这张图（keep 时已经把引用摘掉了）
  const rerun2 = await json(`/api/courses/${id}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage: 'quiz_from_images' }),
  })
  await waitForJob(rerun2.body?.job?.id)
  check(
    '重跑后题目重新挂上原图',
    ((await readBank()).items || []).every((item) =>
      (item.images || []).includes('09_quiz/images/q1.png'),
    ),
  )
  const dropDelete = await json(`/api/courses/${id}/file?path=${encodeURIComponent('09_quiz/images/q1.png')}&questions=drop`, {
    method: 'DELETE',
  })
  check('图+题一起删返回 200', dropDelete.status === 200, String(dropDelete.status))
  check('报告删掉了 2 道题', dropDelete.body?.dropped === 2, JSON.stringify(dropDelete.body))
  check('题库跟着清空', (await readBank()).items.length === 0)

  const escapeDelete = await json(`/api/courses/${id}/file?path=${encodeURIComponent('../../../package.json')}`, {
    method: 'DELETE',
  })
  check('删文件越界被挡住', escapeDelete.status === 400, String(escapeDelete.status))
  check(
    '越界删除没动到应用文件',
    !!(await fsp.stat(path.join(appRoot, 'package.json')).catch(() => null)),
  )
  const dirDelete = await json(`/api/courses/${id}/file?path=${encodeURIComponent('09_quiz/images')}`, {
    method: 'DELETE',
  })
  check('目录不给删', dirDelete.status === 400, String(dirDelete.status))
  const missingDelete = await json(`/api/courses/${id}/file?path=${encodeURIComponent('09_quiz/images/none.png')}`, {
    method: 'DELETE',
  })
  check('删不存在的文件返回 404', missingDelete.status === 404, String(missingDelete.status))

  // ---- 图片知识点：笔记照片 → 知识点 + 笔记 ----
  const readOutline = async () =>
    JSON.parse(await fsp.readFile(path.join(dir, '06_outline/outline.json'), 'utf8'))
  const allPoints = (doc) =>
    (doc.units || []).flatMap((unit) => (unit.sections || []).flatMap((section) => section.points || []))

  const catalog = await json('/api/stages')
  check(
    '任务里有 points_from_images',
    (catalog.body?.tasks || []).some((t) => t.key === 'points_from_images'),
  )

  const noPhoto = await json(`/api/courses/${id}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage: 'points_from_images' }),
  })
  const noPhotoDone = await waitForJob(noPhoto.body?.job?.id)
  check('没有照片时知识点任务报失败', noPhotoDone?.job?.status === 'failed', String(noPhotoDone?.job?.status))
  check(
    '失败原因指着缺 图片知识点.md',
    String(noPhotoDone?.job?.error || '').includes('06_outline/图片知识点.md'),
    String(noPhotoDone?.job?.error),
  )

  const noteShot = await request(`/api/courses/${id}/upload?stage=06_outline&rel=images&name=note1.png`, {
    method: 'POST',
    body: PNG_1PX,
  })
  check('笔记照片上传进 06_outline/images', noteShot.status === 201, String(noteShot.status))
  const outlineFiles = await json(`/api/courses/${id}/files?stage=06_outline`)
  check(
    '笔记照片出现在大纲目录里',
    (outlineFiles.body?.files || []).some((file) => file.path === 'images/note1.png'),
    JSON.stringify(outlineFiles.body?.files),
  )

  const visionBefore = visionCalls
  const pointsJob = await json(`/api/courses/${id}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage: 'points_from_images' }),
  })
  const pointsDone = await waitForJob(pointsJob.body?.job?.id)
  check('从图片整理知识点跑完', pointsDone?.job?.status === 'done', String(pointsDone?.job?.error))
  check('整理知识点时也走了识图接口', visionCalls > visionBefore, `${visionBefore} → ${visionCalls}`)
  check(
    '知识点进了 outline.json',
    allPoints(await readOutline()).length === 2,
    JSON.stringify(allPoints(await readOutline()).length),
  )
  check(
    '知识点挂着原图路径',
    allPoints(await readOutline()).every((point) =>
      (point.images || []).includes('06_outline/images/note1.png'),
    ),
  )
  check(
    '人读的图片知识点.md 落盘',
    !!(await fsp.stat(path.join(dir, '06_outline/图片知识点.md')).catch(() => null)),
  )
  check(
    '笔记落盘',
    !!(await fsp.stat(path.join(dir, '07_notes/图片笔记.md')).catch(() => null)),
  )

  // 同一张图再跑一遍：知识点没长，任务算跑完，但要留提示
  const pointsRerun = await json(`/api/courses/${id}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage: 'points_from_images' }),
  })
  const pointsRerunDone = await waitForJob(pointsRerun.body?.job?.id)
  check('重复跑同一批照片仍然是 done', pointsRerunDone?.job?.status === 'done', String(pointsRerunDone?.job?.error))
  check(
    '知识点没涨时留一句提示',
    String(pointsRerunDone?.job?.warning || '').includes('知识点条数没有变化'),
    String(pointsRerunDone?.job?.warning),
  )

  // ---- 删笔记照片：keep 留知识点只摘图，drop 连知识点和笔记段落一起删 ----
  const keepPoint = await json(
    `/api/courses/${id}/file?path=${encodeURIComponent('06_outline/images/note1.png')}&questions=keep`,
    { method: 'DELETE' },
  )
  check('删笔记照片（保留知识点）返回 200', keepPoint.status === 200, String(keepPoint.status))
  check('报告摘掉了 2 个知识点的原图', keepPoint.body?.pointsUntagged === 2, JSON.stringify(keepPoint.body))
  check(
    '照片文件真的没了',
    !(await fsp.stat(path.join(dir, '06_outline/images/note1.png')).catch(() => null)),
  )
  check('知识点还在', allPoints(await readOutline()).length === 2)
  check(
    '知识点不再挂着删掉的照片',
    allPoints(await readOutline()).every((point) => (point.images || []).length === 0),
  )
  check(
    '人读的 md 里小节还在',
    (await fsp.readFile(path.join(dir, '06_outline/图片知识点.md'), 'utf8')).includes('note1.png'),
  )

  const noteBack = await request(`/api/courses/${id}/upload?stage=06_outline&rel=images&name=note1.png`, {
    method: 'POST',
    body: PNG_1PX,
  })
  check('重新传回笔记照片', noteBack.status === 201, String(noteBack.status))
  // 重跑一次任务，让知识点重新挂上这张图（keep 时已经把引用摘掉了）
  const pointsAgain = await json(`/api/courses/${id}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage: 'points_from_images' }),
  })
  await waitForJob(pointsAgain.body?.job?.id)
  check(
    '重跑后知识点重新挂上原图',
    allPoints(await readOutline()).every((point) =>
      (point.images || []).includes('06_outline/images/note1.png'),
    ),
  )

  const dropPoint = await json(
    `/api/courses/${id}/file?path=${encodeURIComponent('06_outline/images/note1.png')}&questions=drop`,
    { method: 'DELETE' },
  )
  check('图+知识点一起删返回 200', dropPoint.status === 200, String(dropPoint.status))
  check('报告删掉了 2 个知识点', dropPoint.body?.pointsRemoved === 2, JSON.stringify(dropPoint.body))
  check('报告删掉了 2 段笔记', dropPoint.body?.notesRemoved === 2, JSON.stringify(dropPoint.body))
  check(
    'outline.json 里没有残留知识点',
    allPoints(await readOutline()).length === 0,
    JSON.stringify(await readOutline()),
  )
  check(
    '笔记段落跟着删掉',
    !(await fsp.readFile(path.join(dir, '07_notes/图片笔记.md'), 'utf8')).includes('note1.png'),
  )
  check(
    '知识点 md 里的小节跟着删掉',
    !(await fsp.readFile(path.join(dir, '06_outline/图片知识点.md'), 'utf8')).includes('note1.png'),
  )
} finally {
  server.kill()
  fakeApi.close()
  await fsp.rm(tmp, { recursive: true, force: true })
}

console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
process.exit(failures ? 1 : 0)
