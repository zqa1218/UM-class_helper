import { createReadStream, createWriteStream } from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  STAGES,
  applyExtracted,
  coursePaths,
  createCourse,
  deleteCourse,
  ensureMaterialStandard,
  getCourse,
  isStage,
  listCourses,
  listFiles,
  normalizeOverrides,
  normalizeSlot,
  pathExists,
  readJson,
  resolveInCourse,
  updateCourse,
} from './courses.mjs'
import { listCalendars, refreshCalendar } from './calendar.mjs'
import { buildTextbookScaffold, listTextbooks } from './textbooks.mjs'
import {
  FULL_PIPELINE,
  cancelJob,
  createJob,
  getJob,
  getJobLog,
  listJobs,
  recoverJobs,
  stageCatalog,
} from './pipeline.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(here, '..')

const config = (await readJson(path.join(appRoot, 'workbench.config.json'))) || {}
const PORT = Number(process.env.PORT || config.port || 8787)
const COURSE_ROOT = path.resolve(appRoot, config.courseRoot || './courses')
const CALENDAR_ROOT = path.resolve(appRoot, config.calendarRoot || './calendars')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message })
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 4 * 1024 * 1024) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

async function handleApi(req, res, url) {
  const segments = url.pathname.split('/').filter(Boolean)
  const method = req.method || 'GET'

  if (segments[1] === 'health') {
    return sendJson(res, 200, {
      ok: true,
      courseRoot: COURSE_ROOT,
      stages: STAGES.length,
      jobs: stageCatalog().length,
      codexSandbox: config.codexSandbox || 'workspace-write',
      codexCommand: config.codexCommand || 'codex',
    })
  }

  if (segments[1] === 'stages') {
    return sendJson(res, 200, { stages: STAGES, tasks: stageCatalog() })
  }

  if (segments[1] === 'calendars') {
    if (segments.length === 2 && method === 'GET') {
      const calendars = (await listCalendars(CALENDAR_ROOT)).map((calendar) => ({
        id: calendar.id,
        university: calendar.university,
        academicYear: calendar.academicYear,
        source: calendar.source,
        ics: calendar.ics,
        fetchedAt: calendar.fetchedAt,
        terms: calendar.terms,
      }))
      return sendJson(res, 200, { calendars })
    }
    if (segments.length === 3 && segments[2] === 'refresh' && method === 'POST') {
      const entries =
        (await readJson(path.join(appRoot, 'calendars.json'))) || []
      const results = []
      for (const entry of entries) {
        try {
          const calendar = await refreshCalendar(CALENDAR_ROOT, entry)
          results.push({ id: calendar.id, ok: true, terms: calendar.terms.length })
        } catch (error) {
          results.push({
            id: entry.id,
            ok: false,
            error: String(error && error.message ? error.message : error),
          })
        }
      }
      return sendJson(res, 200, { results })
    }
    return sendError(res, 404, '未知接口')
  }

  if (segments[1] === 'courses' && segments.length === 2) {
    if (method === 'GET') {
      return sendJson(res, 200, { courses: await listCourses(COURSE_ROOT) })
    }
    if (method === 'POST') {
      const body = await readJsonBody(req)
      const course = await createCourse(COURSE_ROOT, body)
      return sendJson(res, 201, { course })
    }
    return sendError(res, 405, '不支持的请求方法')
  }

  if (segments[1] === 'courses' && segments.length >= 3) {
    const id = decodeURIComponent(segments[2])
    const rest = segments.slice(3)

    if (rest.length === 0) {
      if (method === 'GET') {
        const course = await getCourse(COURSE_ROOT, id)
        if (!course) return sendError(res, 404, '课程不存在')
        return sendJson(res, 200, { course })
      }
      if (method === 'PATCH') {
        const body = await readJsonBody(req)
        const course = await updateCourse(COURSE_ROOT, id, body)
        if (!course) return sendError(res, 404, '课程不存在')
        return sendJson(res, 200, { course })
      }
      if (method === 'DELETE') {
        const ok = await deleteCourse(COURSE_ROOT, id)
        return ok ? sendJson(res, 200, { ok: true }) : sendError(res, 404, '课程不存在')
      }
      return sendError(res, 405, '不支持的请求方法')
    }

    if (rest[0] === 'files' && method === 'GET') {
      const stage = url.searchParams.get('stage') || ''
      if (stage && !isStage(stage)) return sendError(res, 400, '未知目录')
      const files = await listFiles(COURSE_ROOT, id, stage)
      return sendJson(res, 200, {
        files: files.map((file) => ({ ...file, sizeLabel: formatBytes(file.size) })),
      })
    }

    if (rest[0] === 'text' && method === 'GET') {
      const rel = url.searchParams.get('path') || ''
      try {
        const target = resolveInCourse(COURSE_ROOT, id, rel)
        const raw = await fsp.readFile(target, 'utf8')
        return sendJson(res, 200, { path: rel, text: raw })
      } catch (error) {
        return sendError(res, 404, '读不到这个文件：' + error.message)
      }
    }

    if (rest[0] === 'raw' && method === 'GET') {
      const rel = url.searchParams.get('path') || ''
      try {
        const target = resolveInCourse(COURSE_ROOT, id, rel)
        const stat = await fsp.stat(target)
        if (!stat.isFile()) return sendError(res, 404, '不是文件')
        res.writeHead(200, {
          'content-type': mimeFor(target),
          'content-length': stat.size,
          'cache-control': 'no-store',
        })
        createReadStream(target).pipe(res)
        return undefined
      } catch {
        return sendError(res, 404, '读不到这个文件')
      }
    }

    if (rest[0] === 'upload' && method === 'POST') {
      const stage = url.searchParams.get('stage') || '00_source'
      const rel = url.searchParams.get('rel') || ''
      if (!isStage(stage)) return sendError(res, 400, '未知目录')
      const name = path.basename(url.searchParams.get('name') || 'upload.bin')
      let target
      try {
        target = resolveInCourse(COURSE_ROOT, id, path.join(stage, rel, name))
      } catch {
        return sendError(res, 400, '非法路径')
      }
      await fsp.mkdir(path.dirname(target), { recursive: true })
      const out = createWriteStream(target)
      await new Promise((resolve, reject) => {
        req.pipe(out)
        req.on('error', reject)
        out.on('error', reject)
        out.on('close', resolve)
      })
      const stat = await fsp.stat(target)
      await touchCourse(COURSE_ROOT, id)
      return sendJson(res, 201, {
        file: {
          path: [stage, rel, name].filter(Boolean).join('/'),
          name,
          size: stat.size,
          sizeLabel: formatBytes(stat.size),
        },
      })
    }

    if (rest[0] === 'quiz' && rest[1] === 'record' && method === 'POST') {
      const body = await readJsonBody(req)
      let bankPath
      try {
        bankPath = resolveInCourse(COURSE_ROOT, id, '09_quiz/bank.json')
      } catch {
        return sendError(res, 400, '非法路径')
      }
      const bank = (await readJson(bankPath)) || { items: [] }
      const items = Array.isArray(bank.items) ? bank.items : []
      const target = items.find((item) => String(item.id) === String(body.id))
      if (!target) return sendError(res, 404, '题库里找不到这道题')
      target.attempts = Number(target.attempts || 0) + 1
      target.wrongCount = body.correct
        ? Math.max(0, Number(target.wrongCount || 0) - 1)
        : Number(target.wrongCount || 0) + 1
      bank.updated = new Date().toISOString().slice(0, 10)
      bank.items = items
      await fsp.writeFile(bankPath, JSON.stringify(bank, null, 2) + '\n', 'utf8')
      await touchCourse(COURSE_ROOT, id)
      return sendJson(res, 200, { item: target })
    }

    if (rest[0] === 'extracted') {
      if (rest.length === 1 && method === 'GET') {
        let file
        try {
          file = resolveInCourse(COURSE_ROOT, id, '10_kb/extracted.json')
        } catch {
          return sendError(res, 400, '非法路径')
        }
        const extracted = await readJson(file)
        return sendJson(res, 200, { extracted })
      }
      if (rest.length === 2 && rest[1] === 'apply' && method === 'POST') {
        const body = await readJsonBody(req)
        const course = await applyExtracted(COURSE_ROOT, id, body)
        if (!course) return sendError(res, 404, '课程不存在')
        return sendJson(res, 200, { course })
      }
      return sendError(res, 405, '不支持的请求方法')
    }

    if (rest[0] === 'textbooks') {
      if (rest.length === 1 && method === 'GET') {
        return sendJson(res, 200, { books: await listTextbooks(COURSE_ROOT, id) })
      }
      if (rest.length === 2 && rest[1] === 'scaffold' && method === 'POST') {
        const result = await buildTextbookScaffold(COURSE_ROOT, id)
        if (!result) return sendError(res, 404, '课程不存在')
        await touchCourse(COURSE_ROOT, id)
        return sendJson(res, 200, result)
      }
      return sendError(res, 405, '不支持的请求方法')
    }

    if (rest[0] === 'jobs') {
      if (rest.length === 1 && method === 'GET') {
        return sendJson(res, 200, { jobs: await listJobs(COURSE_ROOT, id) })
      }
      if (rest.length === 1 && method === 'POST') {
        const body = await readJsonBody(req)
        const job = await createJob(COURSE_ROOT, id, body)
        return sendJson(res, 201, { job })
      }
      if (rest.length === 2 && method === 'GET') {
        const job = await getJob(COURSE_ROOT, id, rest[1])
        if (!job) return sendError(res, 404, '任务不存在')
        const tail = Number(url.searchParams.get('tail') || 200)
        const log = await getJobLog(COURSE_ROOT, id, rest[1], tail)
        return sendJson(res, 200, { job, log })
      }
      if (rest.length === 3 && rest[2] === 'cancel' && method === 'POST') {
        const ok = cancelJob(rest[1])
        return sendJson(res, 200, { ok })
      }
      return sendError(res, 405, '不支持的请求方法')
    }

    return sendError(res, 404, '未知接口')
  }

  return sendError(res, 404, '未知接口')
}

async function touchCourse(root, id) {
  const metaPath = coursePaths(root, id).meta
  const meta = await readJson(metaPath)
  if (!meta) return
  meta.updatedAt = new Date().toISOString()
  await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8')
}

async function serveStatic(res, pathname) {
  const dist = path.join(appRoot, 'dist')
  if (!(await pathExists(dist))) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(
      '前端还没构建。\n开发模式：npm run dev 然后打开 http://localhost:5173\n生产模式：npm run build 后重启本服务。\n',
    )
    return
  }
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  let target = path.join(dist, rel)
  if (!target.startsWith(dist + path.sep) && target !== path.join(dist, 'index.html')) {
    target = path.join(dist, 'index.html')
  }
  if (!(await pathExists(target))) {
    target = path.join(dist, 'index.html')
  }
  try {
    const stat = await fsp.stat(target)
    res.writeHead(200, {
      'content-type': mimeFor(target),
      'content-length': stat.size,
      'cache-control': 'no-store',
    })
    createReadStream(target).pipe(res)
  } catch {
    sendError(res, 404, '找不到页面')
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url)
      return
    }
    await serveStatic(res, url.pathname)
  } catch (error) {
    if (!res.headersSent) {
      sendError(res, 500, String(error && error.message ? error.message : error))
    } else {
      res.end()
    }
  }
})

await fsp.mkdir(COURSE_ROOT, { recursive: true })
const standardsWritten = await ensureMaterialStandard(COURSE_ROOT)
if (standardsWritten) {
  console.log(`已为 ${standardsWritten} 门课程补上课程资料标准`)
}
await recoverJobs(COURSE_ROOT)

server.listen(PORT, '127.0.0.1', () => {
  console.log(`课程工作台服务已启动：http://127.0.0.1:${PORT}`)
  console.log(`课程目录：${COURSE_ROOT}`)
})
