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

import { strToU8, zipSync } from 'fflate'

import { runTool, toolSpecs } from '../server/agent.mjs'
import { buildCalendar, parseIcs } from '../server/calendar.mjs'
import { parseCourseHtml, parseWhen, weekOf } from '../server/moodle.mjs'
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

// ---- Moodle 课程页解析：结构照抄真实页面，不联网 ----
const MOODLE_PORT = Number(process.env.SMOKE_MOODLE_PORT || PORT + 2)
const MOODLE_BASE = `http://127.0.0.1:${MOODLE_PORT}`
const MOODLE_HTML = [
  '<!DOCTYPE html><html><head><title>Course: 医学神经科学 | ummoodle</title></head><body>',
  '<ul class="topics">',
  '<li id="section-0" class="section course-section main " data-sectionname="课程说明">',
  '<div class="content"><div class="summarytext"><p>本课程介绍神经系统。</p></div></div>',
  '<ul class="section img-text">',
  '<li class="activity forum modtype_forum " id="module-800" data-activityname="答疑区">',
  '<div class="activity-item" data-activityname="答疑区">',
  `<a href="${MOODLE_BASE}/mod/forum/view.php?id=800" class="aalink"><span class="instancename">答疑区<span class="accesshide">讨论区</span></span></a>`,
  '</div></li></ul></li>',
  '<li id="section-1" class="section course-section main " data-sectionname="第 1 周 · 9月1日 14:00 绪论">',
  '<div class="content"><div class="summarytext"><p>课件在下面。</p></div></div>',
  '<ul class="section img-text">',
  '<li class="activity resource modtype_resource " id="module-809" data-activityname="第1讲 绪论">',
  '<div class="activity-item" data-activityname="第1讲 绪论">',
  `<a href="${MOODLE_BASE}/mod/resource/view.php?id=809" class="aalink"><span class="instancename">第1讲 绪论<span class="accesshide">File</span></span></a>`,
  '</div></li>',
  '<li class="activity resource modtype_resource " id="module-810" data-activityname="讲义">',
  '<div class="activity-item" data-activityname="讲义">',
  `<a href="${MOODLE_BASE}/mod/resource/view.php?id=810" class="aalink"><span class="instancename">讲义<span class="accesshide">File</span></span></a>`,
  '</div></li>',
  '</ul></li>',
  '<li id="section-2" class="section course-section main " data-sectionname="第 2 周 · Week 2">',
  '<div class="content"><div class="summarytext"><p></p></div></div>',
  '<ul class="section img-text">',
  '<li class="activity resource modtype_resource " id="module-811" data-activityname="第2周 课件">',
  '<div class="activity-item" data-activityname="第2周 课件">',
  `<a href="${MOODLE_BASE}/mod/resource/view.php?id=811" class="aalink"><span class="instancename">第2周 课件<span class="accesshide">File</span></span></a>`,
  '</div></li>',
  '<li class="activity resource modtype_resource " id="module-812">',
  '<div class="activity-item">',
  `<a href="${MOODLE_BASE}/mod/resource/view.php?id=812" class="aalink"><span class="instancename">阅读材料<span class="accesshide">File</span></span></a>`,
  '</div></li>',
  '</ul></li>',
  '</ul></body></html>',
].join('\n')

const parsedSections = parseCourseHtml(MOODLE_HTML)
check('Moodle 课程页解析出 3 个小节', parsedSections.length === 3, 'got ' + parsedSections.length)
check(
  '小节名读得对',
  parsedSections[1]?.name === '第 1 周 · 9月1日 14:00 绪论',
  String(parsedSections[1]?.name),
)
check('小节里的日期读出来', parsedSections[1]?.date?.endsWith('-09-01'), String(parsedSections[1]?.date))
check('小节里的时间读出来', parsedSections[1]?.time === '14:00', String(parsedSections[1]?.time))
check(
  '活动解析出 modname 与链接',
  parsedSections[1]?.modules?.[0]?.modname === 'resource' &&
    parsedSections[1].modules[0].url.includes('id=809'),
  JSON.stringify(parsedSections[1]?.modules?.[0]),
)
check(
  '活动名抠掉了给读屏用的 File 字样',
  parsedSections[2]?.modules?.[1]?.name === '阅读材料',
  String(parsedSections[2]?.modules?.[1]?.name),
)
check(
  '非文件活动也算出来（论坛）',
  parsedSections[0]?.modules?.[0]?.modname === 'forum',
  String(parsedSections[0]?.modules?.[0]?.modname),
)

const when = parseWhen('第 3 周 · 2026-03-05 10:30')
check('读得出完整日期时间', when.date === '2026-03-05' && when.time === '10:30', JSON.stringify(when))
check('日/月/年写法认得出', parseWhen('15/03/2026').date === '2026-03-15')
check('中文月日认得出', parseWhen('9月15日 08:00').date?.endsWith('-09-15'))
check('英文月份认得出', parseWhen('Mar 7').date?.endsWith('-03-07'))
check('「Week 1-2」不当日期', parseWhen('Week 1-2').date === '')
check('「0 / 6」不当日期', parseWhen('0 / 6').date === '')
check('周次读「第 3 周」', weekOf('第 3 周 · 绪论', 1) === 3, String(weekOf('第 3 周 · 绪论', 1)))
check('周次读「Week 12」', weekOf('Week 12', 2) === 12, String(weekOf('Week 12', 2)))
check('周次读「W5」', weekOf('W5 实验课', 3) === 5, String(weekOf('W5 实验课', 3)))
check('读不出周次就用顺序', weekOf('课程说明', 0) === 0 && weekOf('Total 45 hours', 4) === 4)

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
// 课件整理出来的知识点，字段与真跑时约定的结构一致
const SLIDE_OUTLINE = {
  course: '冒烟测试课',
  units: [
    {
      id: 'SLIDE',
      title: '课件知识点',
      sections: [
        {
          id: 'SLD-01',
          title: '讲义.pdf',
          points: [
            {
              id: 'SLD-01-01',
              title: '神经元',
              definition: '课件第 1 页给的定义',
              keywords: ['神经元'],
              level: '基础',
              sources: ['课件 00_source/week-01/讲义.pdf 第 1 页'],
              hasSupplement: false,
            },
          ],
        },
      ],
    },
  ],
}
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
      if (prompt.includes('整理课件知识点集锦')) {
        let message
        if (!toolTexts.length) {
          message = call('list_files', { path: '00_source' })
        } else if (toolTexts.some((text) => text.includes('已写入 06_outline/课件知识点集锦.md'))) {
          message = { role: 'assistant', content: '整理完 1 个课件、1 个知识点。' }
        } else if (lastTool.includes('week-')) {
          // 抽页 + 入库 + 人读集锦，三份一起写
          const write = (id, path, content) => ({
            id,
            type: 'function',
            function: { name: 'write_file', arguments: JSON.stringify({ path, content }) },
          })
          message = {
            role: 'assistant',
            content: null,
            tool_calls: [
              write('call-digest-pages', '02_slides/讲义-pages.md', '# 讲义\n\n第 1 页：神经元是基本单位。\n'),
              write(
                'call-digest-note',
                '06_outline/课件知识点集锦.md',
                '# 课件知识点集锦\n\n## 讲义.pdf\n- SLD-01-01 神经元（第 1 页）\n',
              ),
              write('call-digest-outline', '06_outline/outline.json', JSON.stringify(SLIDE_OUTLINE, null, 2)),
            ],
          }
        } else {
          message = { role: 'assistant', content: '00_source/ 里没有课件。' }
        }
        return reply(200, {
          id: 'smoke-digest',
          object: 'chat.completion',
          model: payload.model,
          choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
        })
      }
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

// ---- 假的 Moodle：cookie 登录 + 课程页 + 一层跳转的 resource 下载 ----
// SSO 是独立域名，登录那一趟要跨站，所以也单开一个服务
const SSO_PORT = Number(process.env.SMOKE_SSO_PORT || PORT + 3)
const SSO_BASE = `http://127.0.0.1:${SSO_PORT}`
const SSO_FORM = (action, message = '') =>
  [
    '<!DOCTYPE html><html><head><title>Sign In</title></head><body>',
    message ? `<span id="errorText">${message}</span>` : '',
    `<form method="post" id="loginForm" action="${action}">`,
    '<input id="userNameInput" name="UserName" type="email" value="">',
    '<input id="passwordInput" name="Password" type="password">',
    '<input type="checkbox" name="Kmsi" id="kmsiInput" value="true">',
    '<input id="optionForms" type="hidden" name="AuthMethod" value="FormsAuthentication">',
    '</form></body></html>',
  ].join('')
const SSO_MFA_FORM =
  '<!DOCTYPE html><html><body><form method="post" action="/adfs/ls/">' +
  '<input id="authMethodList" name="AuthMethod" type="hidden" value="PhoneAppOTP">' +
  '<input name="otc" type="text"></form></body></html>'
const SAML_POST = (acs) =>
  `<!DOCTYPE html><html><body><form method="post" action="${acs}">` +
  '<input type="hidden" name="SAMLResponse" value="assertion-ok">' +
  '<input type="hidden" name="RelayState" value="/my/">' +
  '</form></body></html>'

const MOODLE_FILES = new Map([
  ['809', '第1讲-绪论.pdf'],
  ['810', '讲义.pdf'],
  ['811', '第2周-课件.pptx'],
  ['812', '阅读材料.docx'],
])
const MOODLE_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')
let moodleDownloads = 0
const fakeMoodle = http.createServer((req, res) => {
  const url = new URL(req.url, MOODLE_BASE)
  const cookie = String(req.headers.cookie || '')
  const html = (status, body) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
    res.end(body)
  }
  const logged = /MoodleSession=(smoke-session|smoke-login)/.test(cookie)
  // 登录页：没登录就 303 去 SSO，顺手发一个匿名会话——真 Moodle 也是这么走的
  if (url.pathname === '/login/index.php') {
    if (logged) {
      res.writeHead(302, { location: `${MOODLE_BASE}/my/` })
      return res.end()
    }
    res.writeHead(303, {
      location: `${SSO_BASE}/adfs/ls/?SAMLRequest=smoke&RelayState=${encodeURIComponent(
        `${MOODLE_BASE}/login/index.php`,
      )}`,
      'set-cookie': ['MoodleSession=smoke-anon; path=/; HttpOnly'],
    })
    return res.end()
  }
  // SSO 把断言 POST 回来：真的 Moodle 在这里校验断言、把会话登成用户
  if (url.pathname.startsWith('/auth/saml2/sp/saml2-acs.php')) {
    res.writeHead(302, {
      location: `${MOODLE_BASE}/my/`,
      'set-cookie': ['MoodleSession=smoke-login; path=/; HttpOnly'],
    })
    return res.end()
  }
  // 别的页面没带会话一律跳 SSO，跟真的 UM Moodle 一样
  if (!logged) {
    res.writeHead(302, { location: `${SSO_BASE}/adfs/ls/?SAMLRequest=smoke` })
    return res.end()
  }
  if (url.pathname === '/my/') return html(200, '<title>我的主页</title><p>Dashboard</p>')
  if (url.pathname === '/course/view.php') {
    if (url.searchParams.get('id') !== '44187') return html(404, '<title>找不到课程</title>')
    return html(200, MOODLE_HTML)
  }
  if (url.pathname === '/mod/resource/view.php') {
    const name = MOODLE_FILES.get(url.searchParams.get('id') || '')
    if (!name) return html(404, '<title>没有这个活动</title>')
    // 真的 Moodle 点开 resource 会 303 到 pluginfile
    res.writeHead(303, {
      location: `${MOODLE_BASE}/pluginfile.php/1318/mod_resource/content/1/${encodeURIComponent(name)}`,
    })
    return res.end()
  }
  if (url.pathname.startsWith('/pluginfile.php/')) {
    moodleDownloads += 1
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    return res.end(MOODLE_PDF)
  }
  return html(404, '<title>没有这个页面</title>')
})
await new Promise((resolve) => fakeMoodle.listen(MOODLE_PORT, '127.0.0.1', resolve))

// ---- 假 SSO（ADFS）：一个表单页 + 断言回投，够验登录这条链 ----
const fakeSso = http.createServer(async (req, res) => {
  const url = new URL(req.url, SSO_BASE)
  const html = (status, body) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
    res.end(body)
  }
  if (!url.pathname.startsWith('/adfs/ls')) return html(404, '<title>没有这个页面</title>')
  const action = `${SSO_BASE}/adfs/ls/?SAMLRequest=smoke`
  if (req.method !== 'POST') return html(200, SSO_FORM(action))
  let body = ''
  for await (const chunk of req) body += chunk
  const form = new URLSearchParams(body)
  const user = form.get('UserName') || ''
  if (user === 'mfa-user') return html(200, SSO_MFA_FORM)
  if (user !== 'student' || form.get('Password') !== 'good-pass') {
    return html(200, SSO_FORM(action, 'The user name or password is incorrect.'))
  }
  return html(200, SAML_POST(`${MOODLE_BASE}/auth/saml2/sp/saml2-acs.php/1`))
})
await new Promise((resolve) => fakeSso.listen(SSO_PORT, '127.0.0.1', resolve))

// ---- 课件抽文本：模型能读 PDF / PPTX 全靠这一步，不联网 ----
const TINY_PDF = (() => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length 74 >>\nstream\nBT /F1 24 Tf 72 700 Td (Neuron basics page one) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  return pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
})()

const docDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'course-workbench-docs-'))
await fsp.mkdir(path.join(docDir, 'week-01'), { recursive: true })
await fsp.writeFile(path.join(docDir, 'week-01/讲义.pdf'), TINY_PDF, 'latin1')
await fsp.writeFile(
  path.join(docDir, 'week-01/讲义.pptx'),
  zipSync({
    'ppt/slides/slide1.xml': strToU8('<p:sld><a:p><a:t>第一张 神经元</a:t></a:p><a:p><a:t>胶质细胞 &amp; 作用</a:t></a:p></p:sld>'),
    'ppt/slides/slide2.xml': strToU8('<p:sld><a:p><a:r><a:t>第二张：突触传递</a:t></a:r></a:p></p:sld>'),
    'ppt/slides/slide3.xml': strToU8('<p:sld><a:p><a:r><a:t>   </a:t></a:r></a:p></p:sld>'),
    '[Content_Types].xml': strToU8('<Types/>'),
  }),
)
const noTools = { vision: false, allowCommands: false }
// .ppt 老格式存成真文件，验的是扩展名这一关，不是「文件不存在」
await fsp.writeFile(path.join(docDir, 'week-01/老课件.ppt'), Buffer.from('not a real ppt'))
check('工具表里有 read_document', toolSpecs(noTools).some((tool) => tool.function.name === 'read_document'))
const pdfText = await runTool(docDir, 'read_document', { path: 'week-01/讲义.pdf' }, noTools)
check('read_document 抽得出 PDF 文字', pdfText.includes('Neuron basics page one'), pdfText.slice(0, 120))
const pptxText = await runTool(docDir, 'read_document', { path: 'week-01/讲义.pptx' }, noTools)
check(
  'read_document 按页抽 PPTX',
  pptxText.includes('第 1 张（slide1）') && pptxText.includes('突触传递'),
  pptxText.slice(0, 160),
)
check(
  'read_document 能只读某一页',
  (await runTool(docDir, 'read_document', { path: 'week-01/讲义.pptx', from: 2, to: 2 }, noTools)).includes('第 2-2 张'),
)
check('抽不到文字的页会说清是图片页', pptxText.includes('抽不到文字'), pptxText.slice(-140))
check(
  'read_document 只认 pdf / pptx',
  (await runTool(docDir, 'read_document', { path: 'week-01/老课件.ppt' }, noTools)).includes('只认 pdf / pptx'),
)
check(
  'read_document 找不到文件会说明白',
  (await runTool(docDir, 'read_document', { path: 'week-01/没有这个.pdf' }, noTools)).includes('找不到'),
)
await fsp.rm(docDir, { recursive: true, force: true })

// ---- 起服务 ----
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'course-workbench-smoke-'))
// 登录会把会话写回配置文件：测试用一份临时配置，别碰用户自己那份
const configDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'course-workbench-config-'))
const configPath = path.join(configDir, 'workbench.config.json')
await fsp.writeFile(
  configPath,
  JSON.stringify({ courseRoot: tmp, moodle: { baseUrl: MOODLE_BASE } }, null, 2) + '\n',
  'utf8',
)
const server = spawn(process.execPath, [path.join(appRoot, 'server/index.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    COURSE_ROOT: tmp,
    WORKBENCH_CONFIG: configPath,
    WORKBENCH_API_BASE_URL: `http://127.0.0.1:${API_PORT}/v1`,
    WORKBENCH_API_MODEL: 'smoke-model',
    WORKBENCH_API_KEY: 'smoke-key',
    WORKBENCH_MOODLE_BASE_URL: MOODLE_BASE,
    WORKBENCH_MOODLE_SESSION: 'smoke-session',
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

  // ---- Moodle 导入：从课程 id 到 00_source/week-NN/ 的整条路 ----
  const moodleStatus = await json('/api/moodle/status')
  check(
    'Moodle 状态报出 cookie 模式与站点',
    moodleStatus.body?.moodle?.configured === true &&
      moodleStatus.body?.moodle?.mode === 'cookie' &&
      moodleStatus.body?.moodle?.baseUrl === MOODLE_BASE,
    JSON.stringify(moodleStatus.body),
  )
  check(
    'Moodle 状态不回传凭据',
    !JSON.stringify(moodleStatus.body).includes('smoke-session'),
    JSON.stringify(moodleStatus.body),
  )

  const moodlePing = await json('/api/moodle/check', { method: 'POST' })
  check(
    'Moodle 连接自检通过',
    moodlePing.body?.result?.ok === true && moodlePing.body?.result?.site === '我的主页',
    JSON.stringify(moodlePing.body),
  )

  const badId = await json('/api/moodle/course?courseId=abc')
  check('课程 id 不是数字时报 400', badId.status === 400, String(badId.status))

  const noCourse = await json('/api/moodle/course?courseId=99999')
  check(
    '读不到课程页时报 400 并说清原因',
    noCourse.status === 400 && /小节|课程 id/.test(String(noCourse.body?.error)),
    String(noCourse.body?.error),
  )

  const preview = await json('/api/moodle/course?courseId=44187')
  check(
    '预览读到课程名',
    preview.body?.course?.fullname === '医学神经科学',
    JSON.stringify(preview.body?.course?.fullname),
  )
  check('预览读到 3 个小节', preview.body?.course?.sections?.length === 3, JSON.stringify(preview.body?.course?.sections?.length))
  check('预览里带每节课的日期时间', preview.body?.course?.sections?.[1]?.time === '14:00')
  check(
    '预览里列得出要拉的文件名',
    preview.body?.course?.sections?.[1]?.modules?.[0]?.files?.[0]?.name === '第1讲-绪论.pdf',
    JSON.stringify(preview.body?.course?.sections?.[1]?.modules),
  )
  check('预览不把下载地址带出来', !JSON.stringify(preview.body).includes('pluginfile'))

  const imported = await json('/api/moodle/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, courseId: '44187', sections: [1, 2], schedule: true }),
  })
  check('Moodle 导入返回 200', imported.status === 200, JSON.stringify(imported.body))
  check('拉了 3 个课件（docx 不要）', imported.body?.files?.length === 3, JSON.stringify(imported.body?.files))
  check(
    '文件按周次归档',
    (imported.body?.files || []).every((file) => /^week-0[12]\//.test(file.path)),
    JSON.stringify((imported.body?.files || []).map((file) => file.path)),
  )
  check(
    'PPT 也拉下来了',
    (imported.body?.files || []).some((file) => file.path.endsWith('.pptx') && file.size > 0),
    JSON.stringify(imported.body?.files),
  )
  check(
    '第 1 周的 PDF 落盘',
    !!(await fsp.stat(path.join(dir, '00_source/week-01/第1讲-绪论.pdf')).catch(() => null)),
  )
  check(
    '第 2 周的 PPT 落盘',
    !!(await fsp.stat(path.join(dir, '00_source/week-02/第2周-课件.pptx')).catch(() => null)),
  )
  const manifest = await fsp.readFile(path.join(dir, '00_source/moodle-import.md'), 'utf8')
  check('导入清单写出来了', manifest.includes('Moodle 课件导入') && manifest.includes('第1讲-绪论.pdf'))
  check('清单里留了「录音自己传」的话', manifest.includes('录音还是要自己传'))
  check('清单里点名还缺录音的周', manifest.includes('week-01') && manifest.includes('week-02'), manifest)
  check('导入报告补了 1 个上课节点', imported.body?.milestones?.length === 1, JSON.stringify(imported.body?.milestones))
  check(
    '导入报告哪些周还缺录音',
    JSON.stringify(imported.body?.missingRecordings) === '[1,2]',
    JSON.stringify(imported.body?.missingRecordings),
  )
  check(
    '导入后按周各排一轮整理',
    (imported.body?.digests || []).length === 2,
    JSON.stringify(imported.body?.digests),
  )
  const afterImport = await json(`/api/courses/${id}`)
  check(
    '读到的日期写进时间轴',
    (afterImport.body?.course?.schedule || []).some(
      (node) => node.date.endsWith('-09-01') && node.kind === 'lecture',
    ),
    JSON.stringify((afterImport.body?.course?.schedule || []).map((node) => node.date)),
  )

  const reimport = await json('/api/moodle/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, courseId: '44187', sections: [1, 2], digest: false }),
  })
  check(
    '重跑不覆盖同名文件',
    reimport.body?.files?.length === 0 && reimport.body?.skipped?.length === 3,
    JSON.stringify(reimport.body),
  )
  check('重跑不重复加时间轴节点', reimport.body?.milestones?.length === 0, JSON.stringify(reimport.body?.milestones))

  const partial = await json('/api/moodle/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'nope', courseId: '44187' }),
  })
  check('课程 id 不对时报 400', partial.status === 400, String(partial.status))

  // ---- 上传课件就自动整理知识点：不用等录音 ----
  const slide = await request(
    `/api/courses/${id}/upload?stage=00_source&rel=week-01&name=${encodeURIComponent('第1讲.pdf')}`,
    { method: 'POST', body: MOODLE_PDF },
  )
  const slideBody = await slide.json().catch(() => null)
  check('课件上传成功', slide.status === 201, String(slide.status))
  check('课件上传后自动排上整理任务', !!slideBody?.digest?.id, JSON.stringify(slideBody))
  check(
    '自动排的是「整理课件知识点集锦」',
    String(slideBody?.digest?.title || '').includes('课件知识点集锦'),
    String(slideBody?.digest?.title),
  )
  const digestJob = await waitForJob(slideBody?.digest?.id)
  check('自动整理跑完', digestJob?.job?.status === 'done', String(digestJob?.job?.error))
  check(
    '任务只说了这一周',
    String(digestJob?.job?.instruction || '').includes('00_source/week-01/'),
    String(digestJob?.job?.instruction),
  )
  const digestNote = await fsp
    .readFile(path.join(dir, '06_outline/课件知识点集锦.md'), 'utf8')
    .catch(() => '')
  check('课件知识点集锦落盘', digestNote.includes('SLD-01-01'), digestNote.slice(0, 80))
  check('逐页文本也留下了', !!(await fsp.stat(path.join(dir, '02_slides/讲义-pages.md')).catch(() => null)))
  const outlineAfterDigest = await readOutline()
  check(
    '知识点进了 outline.json 的 SLIDE 单元',
    allPoints(outlineAfterDigest).some((point) => point.id === 'SLD-01-01'),
    JSON.stringify(allPoints(outlineAfterDigest).map((point) => point.id)),
  )

  const audio = await request(
    `/api/courses/${id}/upload?stage=00_source&rel=week-01&name=lecture-01.m4a`,
    { method: 'POST', body: Buffer.from('fake audio') },
  )
  const audioBody = await audio.json().catch(() => null)
  check('录音上传成功', audio.status === 201, String(audio.status))
  check('录音不自动排任务（完整分析要人手点）', !audioBody?.digest, JSON.stringify(audioBody?.digest))

  const manual = await json(`/api/courses/${id}/digest-slides`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ week: 'week-01' }),
  })
  check('手动排整理返回 201', manual.status === 201, String(manual.status))
  const manualDone = await waitForJob(manual.body?.job?.id)
  check('手动整理也能跑完', manualDone?.job?.status === 'done', String(manualDone?.job?.error))

  const unknown = await json(`/api/courses/${id}/digest-slides`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ week: '' }),
  })
  check('不指定周次就整理全部', unknown.status === 201, String(unknown.status))
  await waitForJob(unknown.body?.job?.id)

  // ---- 内嵌登录：填账号密码，工作台自己把 SSO 那一趟走完 ----
  const login = (username, password) =>
    json('/api/moodle/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })

  const badLogin = await login('student', 'wrong-pass')
  check('密码不对时报 400', badLogin.status === 400, String(badLogin.status))
  check(
    '密码不对时说清是账号密码问题',
    String(badLogin.body?.error || '').includes('账号或密码'),
    String(badLogin.body?.error),
  )
  check(
    '失败时回传走过的跳转，好查卡在哪',
    Array.isArray(badLogin.body?.steps) && badLogin.body.steps.length >= 3,
    JSON.stringify(badLogin.body?.steps),
  )

  const mfaLogin = await login('mfa-user', 'good-pass')
  check(
    '要二次验证时说清这条路走不通',
    String(mfaLogin.body?.error || '').includes('第二道验证'),
    String(mfaLogin.body?.error),
  )

  const okLogin = await login('student', 'good-pass')
  check('登录成功返回 200', okLogin.status === 200, JSON.stringify(okLogin.body))
  check('登录拿到 cookie 会话', okLogin.body?.result?.mode === 'cookie', JSON.stringify(okLogin.body?.result))
  check('登录回报账号', okLogin.body?.result?.user === 'student', String(okLogin.body?.result?.user))
  check(
    '登录把 SSO 与断言那几跳都走了',
    (okLogin.body?.result?.steps || []).length >= 4,
    JSON.stringify(okLogin.body?.result?.steps) + ' :: ' + serverLog,
  )
  check('环境变量在场时给提醒', String(okLogin.body?.note || '').includes('环境变量'), String(okLogin.body?.note))

  const saved = JSON.parse(await fsp.readFile(configPath, 'utf8'))
  check(
    '会话写进配置文件',
    String(saved.moodle?.session || '').includes('MoodleSession=smoke-login'),
    JSON.stringify(saved.moodle),
  )
  check(
    '账号记下来、密码不落盘',
    saved.moodle?.username === 'student' && !saved.moodle?.password,
    JSON.stringify(saved.moodle),
  )

  const afterLogin = await json('/api/moodle/status')
  check('状态里带上账号', afterLogin.body?.moodle?.username === 'student', JSON.stringify(afterLogin.body?.moodle))
  const recheck = await json('/api/moodle/check', { method: 'POST' })
  check('新会话能用', recheck.body?.result?.ok === true, JSON.stringify(recheck.body))

  const out = await json('/api/moodle/logout', { method: 'POST' })
  const cleared = JSON.parse(await fsp.readFile(configPath, 'utf8'))
  check(
    '清凭据把会话从配置文件里删掉',
    out.status === 200 && !cleared.moodle?.session,
    JSON.stringify(cleared.moodle),
  )
} finally {
  server.kill()
  fakeApi.close()
  fakeMoodle.close()
  fakeSso.close()
  await fsp.rm(tmp, { recursive: true, force: true })
  await fsp.rm(configDir, { recursive: true, force: true })
}

console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
process.exit(failures ? 1 : 0)
