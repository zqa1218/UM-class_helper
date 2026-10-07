import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * 不借助外部 codex 的跑法：直接调 OpenAI 兼容的 /chat/completions，
 * 工具循环（列目录 / 读文件 / 写文件 / 跑命令）自己实现。
 * 所有文件操作都限制在课程目录内 —— 这里的模型没有别的通道。
 */

const MAX_READ = 200 * 1024
const MAX_OUTPUT = 20 * 1024
const MAX_IMAGE = 8 * 1024 * 1024
const DEFAULT_MAX_ROUNDS = 40
const DEFAULT_COMMAND_MS = 5 * 60 * 1000

const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

/** 让识图模型只做抄写，不替我解读——答案要靠课程材料或题目本身。 */
const OCR_PROMPT = [
  '把这张图里能看到的内容按版面原样抄成纯文本，不要翻译、不要改写、不要补全、不要作答。',
  '题号、题干、选项、括号里的作答痕迹、答案标记、页眉页脚、手写批注都要抄。',
  '公式用普通文本表示；看不清的字写 [看不清]，不要猜。',
].join('\n')

const SYSTEM = [
  '你在一个课程工作目录里干活，目录按阶段分好了：10_kb/、00_source/、01_transcript/ …… 09_quiz/。',
  '文件工具只认这个目录，路径越界会被拒绝；run_command 也在课程目录里起。',
  '遇到图片（题目截图、板书照片、课件截图）先用 read_image 认字，不要凭常识猜图里的内容。',
  '干活方式：先 list_files / read_file 看清楚有什么，再 write_file / run_command 动手。',
  '不要凭课程名或常识编造内容：读不出来的字段留空，拿不准的地方在产物里写明「待老师确认」。',
  '产物写进对应编号目录，不要另建目录树。',
  '做完用一段话说明：写了哪些文件、哪些地方需要人核实。',
].join('\n')

/** 从 workbench.config.json 的 api 段取配置；环境变量优先，方便临时切换和冒烟测试。 */
export function apiConfig(config = {}) {
  const api = { ...(config.api || {}) }
  const keyEnv = String(api.apiKeyEnv || 'WORKBENCH_API_KEY')
  const visionKeyEnv = String(api.visionApiKeyEnv || '')
  const number = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback)
  const baseUrl = process.env.WORKBENCH_API_BASE_URL || api.baseUrl || ''
  const apiKey = process.env.WORKBENCH_API_KEY || process.env[keyEnv] || api.apiKey || ''
  return {
    baseUrl,
    model: process.env.WORKBENCH_API_MODEL || api.model || '',
    apiKey,
    allowCommands: api.allowCommands !== false,
    maxRounds: number(api.maxRounds, DEFAULT_MAX_ROUNDS),
    maxCommandMs: number(api.maxCommandMs, DEFAULT_COMMAND_MS),
    // 识图默认跟着主接口走：模型支持图片就直接用，不配单独的服务也能读图
    vision: api.vision !== false,
    visionBaseUrl: process.env.WORKBENCH_VISION_BASE_URL || api.visionBaseUrl || baseUrl,
    visionModel: process.env.WORKBENCH_VISION_MODEL || api.visionModel || api.model || '',
    visionApiKey:
      process.env.WORKBENCH_VISION_API_KEY ||
      (visionKeyEnv ? process.env[visionKeyEnv] : '') ||
      api.visionApiKey ||
      apiKey,
  }
}

function toolSpecs(api) {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: '列出课程目录下某个子目录里的文件和子目录（一层）。path 用相对路径，课程目录本身留空。',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: '例如 10_kb，或留空看根目录' } },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: '读一个文本文件的内容（txt / md / json / csv 等）。PDF、音频、图片要先解析成文本。',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: '相对课程目录的路径' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: '把内容写进文件（覆盖同名文件），上级目录不存在会自动建。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '相对课程目录的路径' },
            content: { type: 'string', description: '文件的完整内容' },
          },
          required: ['path', 'content'],
        },
      },
    },
  ]
  if (api.vision) {
    tools.push({
      type: 'function',
      function: {
        name: 'read_image',
        description:
          '用识图模型把一张图片（题目截图、板书照片、课件截图）里的文字原样抄出来，返回的是抄写结果，不是答案。图片要先放进课程目录。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '相对课程目录的图片路径，例如 09_quiz/images/q1.png' },
            question: {
              type: 'string',
              description: '可选：还想让识图模型顺带回答的一句话，例如「这一页有几道题」',
            },
          },
          required: ['path'],
        },
      },
    })
  }
  if (api.allowCommands) {
    tools.push({
      type: 'function',
      function: {
        name: 'run_command',
        description:
          '在课程目录里执行一条命令（Windows 上走 PowerShell），用来解析课件、转写音频、调用本地工具。返回退出码与输出。',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: '要执行的命令' } },
          required: ['command'],
        },
      },
    })
  }
  return tools
}

/** 相对路径解析到课程目录内；越界一律拒绝。 */
function safePath(courseDir, rel) {
  const base = path.resolve(courseDir)
  const target = path.resolve(base, String(rel || ''))
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('路径超出课程目录：' + rel)
  }
  return target
}

function relative(courseDir, target) {
  return path.relative(path.resolve(courseDir), target).split(path.sep).join('/')
}

async function doListFiles(courseDir, args) {
  const dir = safePath(courseDir, args.path || '')
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  const visible = entries.filter((entry) => !entry.name.startsWith('.'))
  if (!visible.length) return '(空目录)'
  const rows = []
  for (const entry of visible) {
    if (entry.isDirectory()) rows.push('d  ' + entry.name + '/')
    else {
      const stat = await fsp.stat(path.join(dir, entry.name))
      rows.push('f  ' + entry.name + '  ' + stat.size + 'B')
    }
  }
  return rows.sort().join('\n')
}

async function doReadFile(courseDir, args) {
  const target = safePath(courseDir, args.path)
  const stat = await fsp.stat(target)
  if (!stat.isFile()) throw new Error('不是文件：' + args.path)
  if (stat.size <= MAX_READ) return await fsp.readFile(target, 'utf8')
  const handle = await fsp.open(target, 'r')
  try {
    const buffer = Buffer.alloc(MAX_READ)
    const { bytesRead } = await handle.read(buffer, 0, MAX_READ, 0)
    return buffer.subarray(0, bytesRead).toString('utf8') + `\n\n（文件 ${stat.size} 字节，只读了开头 ${MAX_READ} 字节）`
  } finally {
    await handle.close()
  }
}

async function doWriteFile(courseDir, args) {
  const target = safePath(courseDir, args.path)
  await fsp.mkdir(path.dirname(target), { recursive: true })
  const content = String(args.content ?? '')
  await fsp.writeFile(target, content, 'utf8')
  return `已写入 ${relative(courseDir, target)}（${content.length} 字符）`
}

async function doReadImage(courseDir, args, api, signal) {
  if (!api.vision) return '失败：这台工作台关掉了 read_image'
  const target = safePath(courseDir, args.path)
  const ext = path.extname(target).toLowerCase()
  const mime = IMAGE_MIME[ext]
  if (!mime) {
    return `失败：read_image 只认图片（${Object.keys(IMAGE_MIME).join(' ')}），这个是 ${ext || '没有扩展名'}`
  }
  const stat = await fsp.stat(target)
  if (!stat.isFile()) return '失败：不是文件'
  if (stat.size > MAX_IMAGE) {
    const mb = (size) => (size / 1024 / 1024).toFixed(1) + 'MB'
    return `失败：图片有 ${mb(stat.size)}，超过 ${mb(MAX_IMAGE)} 上限，裁小一点或压一下再试`
  }
  const buffer = await fsp.readFile(target)
  const dataUrl = 'data:' + mime + ';base64,' + buffer.toString('base64')
  const text = await callVision(api, dataUrl, String(args.question || '').trim(), signal)
  return `【${relative(courseDir, target)}｜识图 ${api.visionModel}】\n${text}`
}

function doRunCommand(courseDir, args, maxCommandMs, signal) {
  return new Promise((resolve) => {
    const command = String(args.command || '')
    if (!command.trim()) return resolve('失败：命令为空')
    const win = process.platform === 'win32'
    const file = win ? process.env.ComSpec || 'cmd.exe' : '/bin/sh'
    const argv = win ? ['/d', '/s', '/c', command] : ['-c', command]
    const child = spawn(file, argv, { cwd: courseDir, windowsHide: true })
    let output = ''
    const collect = (chunk) => {
      if (output.length < MAX_OUTPUT) output += chunk.toString('utf8')
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => {
      child.kill()
      collect(Buffer.from(`\n[超时 ${Math.round(maxCommandMs / 1000)} 秒，已终止]`))
    }, maxCommandMs)
    const onAbort = () => child.kill()
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (error) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve('命令起不来：' + error.message)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      const text = output.trim()
      const clipped = text.length >= MAX_OUTPUT ? text.slice(0, MAX_OUTPUT) + '\n…（输出被截断）' : text
      resolve(`exit=${code === null ? -1 : code}\n${clipped || '(没有输出)'}`)
    })
  })
}

async function runTool(courseDir, name, args, api, signal) {
  if (name === 'list_files') return await doListFiles(courseDir, args)
  if (name === 'read_file') return await doReadFile(courseDir, args)
  if (name === 'write_file') return await doWriteFile(courseDir, args)
  if (name === 'read_image') return await doReadImage(courseDir, args, api, signal)
  if (name === 'run_command') {
    if (!api.allowCommands) return '失败：这台工作台关掉了 run_command'
    return await doRunCommand(courseDir, args, api.maxCommandMs, signal)
  }
  return '失败：没有这个工具 ' + name
}

/** 主接口和识图接口共用这一段：发请求、检查返回体。 */
async function postChat({ baseUrl, model, apiKey, messages, tools, signal }) {
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions'
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: 'Bearer ' + apiKey } : {}),
    },
    body: JSON.stringify(
      tools ? { model, messages, tools, tool_choice: 'auto' } : { model, messages },
    ),
    signal,
  })
  const text = await response.text()
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403 ? '（apiKey 不对或没配）' : ''
    throw new Error(`接口返回 ${response.status}${hint}：${text.slice(0, 400)}`)
  }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('接口返回的不是 JSON：' + text.slice(0, 300))
  }
  const message = data?.choices?.[0]?.message
  if (!message) throw new Error('接口没有返回 choices[0].message：' + text.slice(0, 300))
  return { message, raw: data }
}

async function callModel(api, messages, tools, signal) {
  return await postChat({
    baseUrl: api.baseUrl,
    model: api.model,
    apiKey: api.apiKey,
    messages,
    tools,
    signal,
  })
}

/** 识图：一张图一次请求，回来的只是抄写结果，判断留给主模型。 */
async function callVision(api, dataUrl, question, signal) {
  if (!api.visionModel) throw new Error('没有配识图模型（api.visionModel）')
  const prompt = question ? OCR_PROMPT + '\n\n另外回答这一句：' + question : OCR_PROMPT
  const { message } = await postChat({
    baseUrl: api.visionBaseUrl,
    model: api.visionModel,
    apiKey: api.visionApiKey,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    signal,
  })
  const content = typeof message.content === 'string' ? message.content.trim() : ''
  if (!content) throw new Error('识图接口没返回文字，模型可能不支持图片输入')
  return content
}

/**
 * 跑到模型不再调工具为止。产物由工具写进课程目录，返回值只用来当任务小结。
 */
export async function runAgent({ courseDir, prompt, api, signal, onEvent = () => {}, onRaw = () => {} }) {
  if (!api.baseUrl) throw new Error('没有配 api.baseUrl')
  if (!api.model) throw new Error('没有配 api.model')
  const tools = toolSpecs(api)
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: prompt },
  ]
  let summary = ''
  let round = 0
  for (round = 1; round <= api.maxRounds; round += 1) {
    onEvent(`# 第 ${round} 轮 · ${api.model}`)
    const { message, raw } = await callModel(api, messages, tools, signal)
    onRaw({ round, messages: messages.length, response: raw })
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    const text = typeof message.content === 'string' ? message.content.trim() : ''
    messages.push(calls.length ? { role: 'assistant', content: text, tool_calls: calls } : { role: 'assistant', content: text })
    if (text) {
      summary = text
      onEvent(text)
    }
    if (!calls.length) return { summary, rounds: round }
    for (const call of calls) {
      const name = String(call.function?.name || '')
      let args = {}
      let result
      try {
        args = call.function?.arguments ? JSON.parse(call.function.arguments) : {}
        onEvent('$ ' + name + ' ' + JSON.stringify(args).slice(0, 240))
        result = await runTool(courseDir, name, args, api, signal)
      } catch (error) {
        result = '失败：' + String(error && error.message ? error.message : error)
      }
      onEvent(result.length > 3000 ? result.slice(0, 3000) + ' …' : result)
      messages.push({ role: 'tool', tool_call_id: call.id, name, content: result })
    }
  }
  return { summary, rounds: round - 1, exhausted: true }
}
