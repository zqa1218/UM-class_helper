import { execFileSync, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { coursePaths, pathExists, readJson, writeJson } from './courses.mjs'
import { apiConfig, runAgent } from './agent.mjs'

const SKILL = '$lecture-knowledge-pipeline'

const SHARED_RULES = [
  '按下面的铁律执行：不静默改写转写稿；低置信项标「待老师确认」；',
  '每个知识点给稳定 ID 与来源（PPT 页码 / 录音时间戳）；',
  '补充内容必须带出处并与课堂原话分开；',
  '产物写进对应编号目录，不要另建目录树；',
  '10_kb/课程资料标准.md 是工作台的字段说明模板，不是课程材料，不能当依据，里面的示例值不要照抄。',
].join('')

const STAGE_TASKS = {
  extract_course: {
    title: '从文件提取课程信息',
    expects: ['10_kb/extracted.json'],
    body: [
      '读取 10_kb/ 里的学校通知、课程大纲、课程介绍等文件，按 10_kb/课程资料标准.md 的结构把课程信息抽出来。',
      '- 只写一个文件：10_kb/extracted.json。不要改动 course.json，也不要改动或移动原文件。',
      '- 读不出来的字段留空字符串，不要猜、不要编。',
      '- 每个有值的字段都要在 fieldNotes 里写依据（文件名 + 页码或段落）。',
      '- 拿不准的、或者需要用户核实的，写进 uncertain。',
      '',
      'extracted.json 结构（对应课程资料标准的第 1 到第 7 部分）：',
      '{',
      '  "name": "用于界面显示的课程名，优先用中文名",',
      '  "code": "课程代码，如 CCBS7001",',
      '  "titleEn": "英文课程名",',
      '  "titleZh": "中文课程名",',
      '  "term": "学期，例如 2026 秋",',
      '  "institution": "开课单位或院系",',
      '  "teacher": "授课教师姓名，多位用、连接",',
      '  "description": "课程简介，原样保留，不要改写",',
      '  "prerequisites": "先修要求，没有就留空",',
      '  "startDate": "学期第一天，YYYY-MM-DD，读不出留空",',
      '  "endDate": "学期最后一天，YYYY-MM-DD，读不出留空",',
      '  "almanacUrl": "校历链接，课程文件里写明了才填，否则留空",',
      '  "keywords": ["关键词"],',
      '  "instructors": [',
      '    {"name": "姓名", "email": "邮箱", "phone": "电话", "office": "办公室", "officeHours": "答疑时间"}',
      '  ],',
      '  "cilos": [{"id": "CILO-1", "text": "预期学习成果"}],',
      '  "assessment": [{"name": "期末考试", "weight": "50%"}],',
      '  "weekly": [',
      '    {"week": 1, "topic": "主题", "instructor": "授课教师", "subtopics": ["子主题"]}',
      '  ],',
      '  "textbooks": [{"citation": "完整引用"}],',
      '  "references": [{"citation": "完整引用"}],',
      '  "schedule": [',
      '    {"date": "YYYY-MM-DD", "title": "节点标题", "kind": "lecture", "note": "备注"}',
      '  ],',
      '  "fieldNotes": {"name": "依据：通知.pdf 第 1 页"},',
      '  "uncertain": ["需要用户核实的地方"]',
      '}',
      '',
      '- schedule 的 kind 只能取 lecture、deadline、exam、reading、other。',
      '- 只把文件里写明日期的节点放进 schedule；只写周次的留空，由工作台按周次推算。',
      '- 考核项目（期中测验、汇报、交作业、期末考试）即使是某一周的内容，也要单独成一条 schedule 节点。',
      '- instructors 里每位教师一条；cilos 有几条记几条；assessment 的权重合计应为 100%。',
      '- weekly 按周次顺序完整列出，不要合并周次，不要漏掉没有主题的周。',
      '- 考勤规定、考试规则、学生事务服务这类全校通用条款不要写进任何字段，它们不是课程内容。',
    ].join('\n'),
  },
  '10_kb': {
    title: '整理课程知识库',
    expects: ['10_kb/syllabus.md'],
    body: [
      '读取 10_kb/ 里的课程介绍、教学大纲、教材与文献，抽出一份课程底色：',
      '- 写 10_kb/syllabus.md：课程定位、先修要求、每周主题安排、考核方式、教材与参考书。',
      '- 有明确时间节点（交作业、汇报、考试、阅读任务）时，整理成 10_kb/milestones.json，',
      '  字段为 date、title、kind（lecture/deadline/exam/reading/other）、note。',
      '- 不要改动 course.json，时间轴由工作台界面写入。',
    ].join('\n'),
  },
  textbooks: {
    title: '教材索引',
    expects: ['10_kb/textbooks/index.md'],
    body: [
      '给 10_kb/textbooks/ 下的教材建索引。一本书一个目录，里面有 book.json，可能有 book.pdf。',
      '- 先读 book.json，把 title、publisher、isbn、access 补全。补不出来的留空，不要编。',
      '  isbn 优先从 book.pdf 的版权页读取；没有副本时用 paper-lookup 或 literature-search 核书目，',
      '  核准了才写，核不到就留空并写进 uncertain。',
      '- 用 paper-lookup 的 Unpaywall 与 CORE 查每本书有没有合法的开放获取版本，',
      '  查到就把链接写进 book.json 的 access。**不要用盗版书库，查到盗版源一律忽略。**',
      '- 有 book.pdf 的：抽目录页，按章切到 chapters/，一章一个文件（ch-01.md 这样），',
      '  并在 book.json 的 chapters 里登记章节号、标题、对应文件、页码范围。',
      '- 把每章映射到课程周次：写进 book.json 的 chapters[].weeks，依据是章节标题与 weekly 主题的对应关系。',
      '  对不上就留空，不要硬套。',
      '- 最后写 10_kb/textbooks/index.md：每本书一段，列书目、索引状态、章节数与覆盖的周次，',
      '  并指出哪些周的教材支撑还是空的。',
      '- 没有副本的教材不要去找下载源，也不要凭记忆写章节内容；只在 index.md 里保留书目与获取途径。',
    ].join('\n'),
  },
  '00_source': {
    title: '盘点新导入的材料',
    expects: ['00_source/manifest.md'],
    body: [
      '扫描 00_source/ 里新加入的录音与课件，按周次建立清单：',
      '- 这门课按周次组织，材料也按周次归档。给每一周建一个目录：week-01、week-02……',
      '  把该周的录音和课件放进对应目录；文件名里已经带周次的直接归位。',
      '- 认不出周次的文件先放着，在 manifest 里单列一节「未归周」，不要猜。',
      '- 写 00_source/manifest.md：每周一段，标注周次、主题、录音文件与时长、课件件数与页数、',
      '  是否已转写、是否已解析。',
      '- 已有产物不要重做，只补缺的。',
    ].join('\n'),
  },
  '01_transcript': {
    title: '转写录音',
    expects: ['01_transcript/'],
    body: [
      '把 00_source/ 里还没有转写稿的音频转成文本：',
      '- 使用 transcribe 技能；需要区分老师和学生提问时启用说话人分离。',
      '- 保留 [mm:ss] 时间戳，时间戳是对齐和引用的基础。',
      '- 长音频分片处理，避免中途失败重跑全部。',
      '- 写进 01_transcript/，一个音频一个文件，不要覆盖已有转写稿。',
    ].join('\n'),
  },
  '02_slides': {
    title: '解析课件',
    expects: ['02_slides/slides.md'],
    body: [
      '把 00_source/ 里的课件解析到 02_slides/：',
      '- 逐页提文本，一页一个 page-NN.txt，并写合并稿 slides.md，页间用 <!-- page NN --> 分隔。',
      '- 关键页（公式、脑区示意图、流程图、表格、实验设计图）渲染成 page-NN.png。',
      '- 扫描件或图片型 PDF 走 OCR，不要凭图猜文字。',
      '- 已有的页不要重复生成。',
    ].join('\n'),
  },
  '03_align': {
    title: '对齐讲述与课件',
    expects: ['03_align/align.md'],
    body: [
      '把转写稿切到对应的课件页：',
      '- 有真实翻页时间点就直接用；没有就按证据推断（念标题、说「下一页」「这张图」、主题突变）。',
      '- 写 03_align/align.md，每页一段：页码与主题、时间区间、课件文本、讲述要点、置信度。',
      '- 对不上的片段放进 03_align/unmatched.md，不要硬塞进某一页。',
    ].join('\n'),
  },
  '04_corrections': {
    title: '校对与纠错',
    expects: ['04_corrections/corrections.md'],
    body: [
      '逐条列出转写稿里可疑的地方，写 04_corrections/corrections.md：',
      '- 分类：A 转写误识别、B 数字与单位、C 口误或前后矛盾、D 课件与讲述冲突。',
      '- 每条给五项：原文、位置（页码或时间戳）、疑似正确、依据、置信度。',
      '- 认知神经学的术语、脑区、ERP 成分、统计量是重灾区，按 cogneuro-errors 逐项核对。',
      '- 低置信一律标「待老师确认」，不替老师下结论，也不修改转写稿原文。',
    ].join('\n'),
  },
  '05_supplements': {
    title: '学科补充',
    expects: ['05_supplements/supplements.md'],
    body: [
      '补三类内容，写 05_supplements/supplements.md：',
      '- 课件一带而过但属于考纲范围的；',
      '- 录音里讲错或讲漏、不补会形成错误理解的；',
      '- 理解后续内容必需的前置概念。',
      '每条挂知识点 ID 和出处（书名+章节 / 作者+年份+期刊或 DOI / 权威数据库链接）。',
      '查证用浏览器，不要把模型记忆当出处。',
    ].join('\n'),
  },
  '06_outline': {
    title: '生成知识点大纲',
    expects: ['06_outline/outline.md', '06_outline/outline.json'],
    body: [
      '生成三级知识点结构：',
      '- 写 06_outline/outline.md 供人读，写 06_outline/outline.json 供出题使用。',
      '- ID 形如 CN03-02-01，稳定、不随重排变化。',
      '- 每个知识点记录：ID、名称、核心定义、关键词、掌握层级、来源、是否含补充。',
      '- 完成后停下等用户圈定出题范围，不要自动出题。',
    ].join('\n'),
  },
  '07_notes': {
    title: '写笔记、讲课流程与总结',
    expects: ['07_notes/notes.md', '07_notes/lecture-flow.md', '07_notes/summary.md'],
    body: [
      '产出三份人读的成果：',
      '- 07_notes/notes.md：图文并茂，关键图用相对路径内嵌（../02_slides/page-NN.png），每节挂知识点 ID。',
      '- 07_notes/lecture-flow.md：按时间还原老师怎么讲的，顺序、主题、转折、举例、思考题。',
      '- 07_notes/summary.md：一页速览。',
    ].join('\n'),
  },
  '08_graph': {
    title: '生成知识图谱',
    expects: ['08_graph/knowledge-map.md'],
    body: [
      '用 Mermaid 画知识图谱，写 08_graph/knowledge-map.md：',
      '- 节点用知识点 ID 与名称；边标明关系类型：包含、前置、对比、因果、并列。',
      '- 超过 25 个节点就按单元拆成多张图，不要把几十个节点塞进一张。',
    ].join('\n'),
  },
  '09_quiz': {
    title: '出题',
    expects: ['09_quiz/'],
    body: [
      '按用户给定的范围与数量出题：',
      '- 题型以选择题为主，每题带答案、解析、知识点 ID、来源。',
      '- 默认练习模式：题目写 09_quiz/quiz-<范围>-<日期>.md，答案解析另存 answers-<范围>-<日期>.md。',
      '- 出题前先读 09_quiz/bank.json 排除已出过的题；同一知识点再出题必须换考查角度。',
      '- 出完把新题追加进 bank.json。',
    ].join('\n'),
  },
  quiz_from_images: {
    title: '从图片整理题目集',
    expects: ['09_quiz/bank.json'],
    grows: { path: '09_quiz/bank.json', label: '题库条数', reason: '要么图片里没有新题，要么模型没入库' },
    body: [
      '把 09_quiz/images/ 里的题目图片整理成题库和人读的题目集。',
      '- 先 list_files 09_quiz/images/：一张图都没有就停下，一句话说明「没有图片」，不写任何文件。',
      '- 每张图用 read_image 认字。它返回的只是原样抄写，不是答案；字认不准的地方标「[看不清]」，不要补全。',
      '- 一题一条入库，字段就按下面这个结构写（bank.json 里 items 的写法）：',
      '  {',
      '    "id": "IMG-001",',
      '    "type": "single",            // single 单选 / multi 多选 / truefalse 判断 / short 简答',
      '    "stem": "题干原文",',
      '    "options": {"A": "选项原文", "B": "选项原文"},',
      '    "answer": ["A"],             // 多选给多个字母；判断题写 ["对"] 或 ["错"]',
      '    "explanation": "解析：为什么选它，其他选项错在哪",',
      '    "pointIds": ["CN03-02"],     // 到 06_outline/outline.json 里对，对不上留空数组',
      '    "difficulty": "基础",         // 基础 / 中等 / 提高',
      '    "sources": ["题目图片 q1.png 第 1 题"],',
      '    "images": ["09_quiz/images/q1.png"],',
      '    "isExtension": false',
      '  }',
      '- 图里已经给了答案的照抄进 answer，sources 里注明「图片已给答案」。',
      '- 图里没给答案的，先到 06_outline/、07_notes/、10_kb/ 里找依据再作答；',
      '  课程材料里找不到依据的，自己解完把 explanation 开头写成「待老师确认：」，别再猜第二个答案。',
      '- 题干和选项保持图片原文，不改写、不翻译、不合并；一张图里有几道题就出几条。',
      '- 先读 09_quiz/bank.json：题干相同或考同一处的题不要重复入库，已存在的题只补 answer、explanation、images。',
      '- id 用 IMG-001、IMG-002……按图片顺序排，避开已有 ID；判断题、简答题不要 options。',
      '- 图片文件本身不要改、不要移动、不要删。',
      '- 再写一份人读的 09_quiz/图片题目集.md：一题一块，写题号、题干、选项、答案、解析、出处图片文件名。',
      '- 收尾说明：整理了几题、几题答案是从图里读到的、几题是自己解的需要人工核。',
    ].join('\n'),
  },
  points_from_images: {
    title: '从图片整理知识点与笔记',
    expects: ['06_outline/图片知识点.md', '07_notes/图片笔记.md'],
    grows: { path: '06_outline/outline.json', label: '知识点条数', reason: '要么图片里没有新知识点，要么模型没入库' },
    body: [
      '把 06_outline/images/ 里的笔记照片（课堂笔记、板书、教材页、手写整理）整理成知识点和笔记。',
      '- 先 list_files 06_outline/images/，空了再 list_files 06_outline/ 看有没有散在根目录的图片；',
      '  一张图都没有就停下，一句话说明「没有图片」，不写任何文件。',
      '- 每张图用 read_image 认字。它返回的只是原样抄写，不是知识点；字认不准的地方标「[看不清]」，不要补全。',
      '- 只整理图里真实存在的内容：图里没有的定义、数据、结论一律不许补。你自己的解读要么不写，',
      '  要么写进 07_notes/图片笔记.md 并标注「我的理解」；拿不准的标「待老师确认」。',
      '- 知识点写进 06_outline/outline.json（没有这个文件就先建一个），结构：',
      '  {',
      '    "course": "课程名",',
      '    "units": [',
      '      {',
      '        "id": "IMG",',
      '        "title": "图片笔记整理",',
      '        "sections": [',
      '          {',
      '            "id": "IMG-01",',
      '            "title": "这张图的主题（用图里的标题，没有就用首句概括）",',
      '            "points": [',
      '              {',
      '                "id": "IMG-01-01",          // 稳定 ID，避开已有的 ID，重跑不许换号',
      '                "title": "知识点名称",',
      '                "definition": "图里对它的定义或说明，原话优先",',
      '                "keywords": ["关键词"],',
      '                "level": "基础",            // 基础 / 中等 / 提高',
      '                "sources": ["图片 06_outline/images/note1.png"],',
      '                "images": ["06_outline/images/note1.png"],',
      '                "hasSupplement": false',
      '              }',
      '            ]',
      '          }',
      '        ]',
      '      }',
      '    ]',
      '  }',
      '- 一张图一个 section，图里的每个知识点一条 point；每条都要带 images 和 sources（写清是哪张图）。',
      '- 先读已有的 06_outline/outline.json：同样的知识点只补 definition、keywords、images，不要重复成两条；',
      '  别的 unit（课程本身的大纲）不要动，只在 id 为 IMG 的 unit 里增删。',
      '- 再写两份人读的产物，两份都按图分节，小节标题就用图片文件名（例如「## note1.png」），方便删图时整段摘掉：',
      '  06_outline/图片知识点.md：一张图一块，写图片文件名、主题、知识点列表（带 ID）；',
      '  07_notes/图片笔记.md：一张图一块，按图里的小标题分段，把定义、例子、公式、易错点写成能直接读的笔记，并给每个知识点挂 ID。',
      '- 图片文件本身不要改、不要移动、不要删；不要动 09_quiz/。',
      '- 收尾说明：整理了几张图、几个知识点、哪些地方标了「[看不清]」或「待老师确认」。',
    ].join('\n'),
  },
}

const FULL_PIPELINE = 'full'

/**
 * 阶段的产物清单见 STAGE_TASKS[].expects，路径以 / 结尾表示「目录里至少有一个文件」。
 * 退出码是 0 但一个产物都没有，不是「没啥可做」，而是环境坏了（例如 Windows 沙箱
 * 在深层路径上 apply deny-read ACLs 失败）或模型压根没动手，得让它在界面上显形。
 */
async function dirHasFile(dir) {
  let entries = []
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.isFile()) return true
    if (entry.isDirectory() && (await dirHasFile(path.join(dir, entry.name)))) return true
  }
  return false
}

/** 返回该阶段缺的产物；空数组表示产物齐了。 */
export async function missingArtifacts(courseDir, stageKey) {
  const expects = STAGE_TASKS[stageKey]?.expects
  if (!expects) return []
  const missing = []
  for (const expect of expects) {
    const ok = expect.endsWith('/')
      ? await dirHasFile(path.resolve(courseDir, expect))
      : await pathExists(path.resolve(courseDir, expect))
    if (!ok) missing.push(expect)
  }
  return missing
}

/** bank.json 这类「应该越用越多」的产物，跑完数一下条数，没涨就提示一声。 */
async function countItems(file) {
  const data = await readJson(file)
  return countEntries(data)
}

/** 数一份产物里的条目：数组、{items:[]}、大纲的 units→sections→points 都认。 */
function countEntries(data) {
  if (Array.isArray(data)) return data.length
  if (Array.isArray(data?.items)) return data.items.length
  if (Array.isArray(data?.units)) {
    return data.units.reduce(
      (sum, unit) =>
        sum +
        (unit?.sections || []).reduce((count, section) => count + (section?.points || []).length, 0),
      0,
    )
  }
  return 0
}

/** 跑任务用哪条路：默认自己调 API，只有显式写 codex 才去外接 codex CLI。 */
function runnerOf(config) {
  return config.runner === 'codex' ? 'codex' : 'api'
}

const INTRO = {
  codex: '你在一个课程工作目录中工作。使用 ' + SKILL + ' 技能。',
  api: '你在一个课程工作目录中工作。动手前先读 10_kb/课程资料标准.md，按它的字段标准整理。',
}

function buildPrompt(course, stageKey, instruction, runner) {
  const task = STAGE_TASKS[stageKey]
  const term = course.term ? '（' + course.term + '）' : ''
  const lines = [
    INTRO[runner] || INTRO.api,
    '',
    '课程：' + course.name + term,
    '课程目录：当前目录',
    '课程介绍与知识库：10_kb/',
    '本次任务：' + (task ? task.title : '自定义任务'),
    '',
    task ? task.body : '按用户要求处理：' + (instruction || '整理这门课的新材料'),
  ]
  if (instruction) {
    lines.push('', '用户附加要求：', instruction)
  }
  lines.push('', SHARED_RULES)
  return lines.join('\n')
}

const queue = []
const children = new Map()
const aborts = new Map()
let running = false
let cachedConfig = null

/**
 * Windows 上 npm 全局命令是 .cmd，不能直接 spawn，也不能用 shell:true
 * （参数里的空格和中文会被拆开）。这里解析出真实可执行文件：
 * 有 .exe 就直接用，只有 .cmd 就走 cmd.exe 并自己控制引号。
 */
function resolveLauncher(command) {
  if (process.platform !== 'win32') return { file: command, prefix: [], viaShell: false }
  try {
    const output = execFileSync('where.exe', [command], { encoding: 'utf8' })
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const exe = lines.find((line) => line.toLowerCase().endsWith('.exe'))
    if (exe) return { file: exe, prefix: [], viaShell: false }
    const cmd = lines.find((line) => line.toLowerCase().endsWith('.cmd'))
    if (cmd) {
      return {
        file: process.env.ComSpec || 'cmd.exe',
        prefix: ['/d', '/s', '/c'],
        viaShell: true,
        target: cmd,
      }
    }
  } catch {
    /* 回退到直接 spawn */
  }
  return { file: command, prefix: [], viaShell: false }
}

function quoteArg(value) {
  return '"' + String(value).replace(/"/g, '\\"') + '"'
}

function newJobId() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return 'j-' + stamp + '-' + Math.random().toString(36).slice(2, 6)
}

function jobPaths(root, courseId, id) {
  const base = coursePaths(root, courseId).jobs
  return {
    meta: path.join(base, id + '.json'),
    log: path.join(base, id + '.log'),
    raw: path.join(base, id + '.jsonl'),
    last: path.join(base, id + '.last.md'),
  }
}

/** 配置文件固定在应用根目录，不跟着 courseRoot 走，否则两处会读到不同的文件。 */
const CONFIG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'workbench.config.json')

async function loadConfig() {
  if (cachedConfig) return cachedConfig
  cachedConfig = (await readJson(CONFIG_PATH)) || {}
  return cachedConfig
}

export async function listJobs(root, courseId) {
  const dir = coursePaths(root, courseId).jobs
  let entries = []
  try {
    entries = await fsp.readdir(dir)
  } catch {
    return []
  }
  const jobs = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const job = await readJson(path.join(dir, entry))
    if (job) jobs.push(job)
  }
  jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return jobs
}

export async function getJob(root, courseId, id) {
  return readJson(jobPaths(root, courseId, id).meta)
}

/**
 * 只读日志尾部：长任务的 jsonl 日志可能很大，整份读进内存没必要。
 * ponytail: 按行数估算读取窗口（每行约 200 字节，下限 128 KB），行特别长时可能少几行。
 */
async function readTail(file, tail) {
  let handle
  try {
    handle = await fsp.open(file, 'r')
    const { size } = await handle.stat()
    const window = Math.min(size, Math.max(128 * 1024, tail * 200))
    const buffer = Buffer.alloc(window)
    const { bytesRead } = await handle.read(buffer, 0, window, size - window)
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n')
    if (window < size) lines.shift() // 从中间截断的首行不完整
    return lines.slice(Math.max(0, lines.length - tail)).join('\n')
  } catch {
    return ''
  } finally {
    await handle?.close()
  }
}

export async function getJobLog(root, courseId, id, tail) {
  const file = jobPaths(root, courseId, id).log
  if (!tail) {
    try {
      return await fsp.readFile(file, 'utf8')
    } catch {
      return ''
    }
  }
  return readTail(file, Number(tail))
}

async function patchJob(root, courseId, id, patch) {
  const paths = jobPaths(root, courseId, id)
  const job = await readJson(paths.meta)
  if (!job) return null
  const next = { ...job, ...patch }
  await writeJson(paths.meta, next)
  return next
}

export async function createJob(root, courseId, input) {
  const course = await readJson(coursePaths(root, courseId).meta)
  if (!course) throw new Error('课程不存在')
  const config = await loadConfig()
  const runner = runnerOf(config)
  const stageKey = String(input.stage || '')
  if (stageKey !== FULL_PIPELINE && !STAGE_TASKS[stageKey]) {
    throw new Error('未知阶段：' + stageKey)
  }

  const id = newJobId()
  const instruction = String(input.instruction || '')
  const job = {
    id,
    courseId,
    stage: stageKey,
    runner,
    title: String(input.title || (STAGE_TASKS[stageKey] ? STAGE_TASKS[stageKey].title : '自定义任务')),
    instruction,
    status: 'queued',
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    summary: '',
    error: '',
    prompt: buildPrompt(course, stageKey, instruction, runner),
  }
  await writeJson(jobPaths(root, courseId, id).meta, job)
  queue.push({ root, courseId, id })
  void drain()
  return job
}

async function drain() {
  if (running) return
  const next = queue.shift()
  if (!next) return
  running = true
  try {
    await runJob(next.root, next.courseId, next.id)
  } catch (error) {
    await patchJob(next.root, next.courseId, next.id, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: String(error && error.message ? error.message : error),
    })
  } finally {
    running = false
    void drain()
  }
}

function describeEvent(event) {
  if (!event || typeof event !== 'object') return null
  const item = event.item
  if (item && typeof item === 'object') {
    if (item.type === 'agent_message' && item.text) return String(item.text)
    if (item.type === 'command_execution') {
      if (event.type === 'item.started' && item.command) return '$ ' + item.command
      if (item.aggregated_output) {
        const text = String(item.aggregated_output).trim()
        return text ? text.slice(0, 3000) : null
      }
    }
    if (item.type === 'file_change' && item.path) return '文件变更：' + item.path
  }
  if (event.type === 'error' && event.message) return '错误：' + event.message
  return null
}

/** 外接 codex CLI 的跑法。日志流由 runJob 建，这里只管把过程写进去。 */
async function runCodexJob({ config, job, dir, paths, writeLog, id }) {
  const args = [
    'exec',
    '-C',
    dir,
    '-s',
    config.codexSandbox || 'workspace-write',
    '--skip-git-repo-check',
    '--json',
    '-o',
    paths.last,
  ]
  if (Array.isArray(config.codexExtraArgs)) args.push(...config.codexExtraArgs)
  // 提示词走 stdin，避免长文本和特殊字符在命令行里被拆坏
  args.push('-')

  const launcher = resolveLauncher(config.codexCommand || 'codex')
  const child = launcher.viaShell
    ? spawn(
        launcher.file,
        [...launcher.prefix, [quoteArg(launcher.target), ...args.map(quoteArg)].join(' ')],
        {
          cwd: dir,
          shell: false,
          windowsHide: true,
          windowsVerbatimArguments: true,
        },
      )
    : spawn(launcher.file, args, { cwd: dir, shell: false, windowsHide: true })

  child.stdin.on('error', () => {
    /* 进程提前退出时忽略写入错误 */
  })
  child.stdin.end(job.prompt)
  children.set(id, child)

  const rawStream = createWriteStream(paths.raw, { flags: 'a' })

  let buffer = ''
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8')
    rawStream.write(text)
    buffer += text
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line) {
        try {
          const described = describeEvent(JSON.parse(line))
          if (described) writeLog(described)
        } catch {
          writeLog(line)
        }
      }
      index = buffer.indexOf('\n')
    }
  })
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim()
    if (text) writeLog('[stderr] ' + text)
  })

  const exitCode = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code === null ? -1 : code))
    child.on('error', (error) => {
      writeLog('[spawn error] ' + error.message)
      resolve(-1)
    })
  })

  rawStream.end()

  let summary = ''
  try {
    summary = (await fsp.readFile(paths.last, 'utf8')).trim()
  } catch {
    summary = ''
  }

  return { exitCode, summary }
}

/** 自己调 API 的跑法：模型通过工具读写课程目录，产物落盘后由 runJob 统一验收。 */
async function runApiJob({ config, job, dir, paths, writeLog, id }) {
  const api = apiConfig(config)
  const controller = new AbortController()
  aborts.set(id, controller)
  const rawStream = createWriteStream(paths.raw, { flags: 'a' })
  try {
    const result = await runAgent({
      courseDir: dir,
      prompt: job.prompt,
      api,
      signal: controller.signal,
      onEvent: writeLog,
      onRaw: (entry) => rawStream.write(JSON.stringify(entry) + '\n'),
    })
    if (result.exhausted) writeLog('到 ' + api.maxRounds + ' 轮还没停，先收工')
    await fsp.writeFile(paths.last, result.summary + '\n', 'utf8')
    return { exitCode: 0, summary: result.summary }
  } finally {
    rawStream.end()
    aborts.delete(id)
  }
}

async function runJob(root, courseId, id) {
  const config = await loadConfig()
  const paths = jobPaths(root, courseId, id)
  const job = await readJson(paths.meta)
  if (!job) return
  const dir = coursePaths(root, courseId).dir
  await patchJob(root, courseId, id, { status: 'running', startedAt: new Date().toISOString() })

  await fsp.mkdir(path.dirname(paths.log), { recursive: true })
  const logStream = createWriteStream(paths.log, { flags: 'a' })
  const writeLog = (text) => {
    if (text) logStream.write(text + '\n')
  }
  writeLog('# ' + job.title)
  writeLog('# 开始：' + new Date().toISOString())

  const runner = runnerOf(config)
  const context = { config, job, dir, paths, writeLog, id }
  const grow = STAGE_TASKS[job.stage]?.grows
  const growFile = grow ? path.resolve(dir, grow.path) : ''
  const before = growFile ? await countItems(growFile) : 0
  let exitCode = -1
  let summary = ''
  let failure = ''
  let missing = []
  let warning = ''
  try {
    const result = runner === 'codex' ? await runCodexJob(context) : await runApiJob(context)
    exitCode = result.exitCode
    summary = result.summary
    missing = exitCode === 0 ? await missingArtifacts(dir, job.stage) : []
    if (missing.length) writeLog('任务没有产出预期的产物：' + missing.join('、'))
    if (growFile && exitCode === 0 && !missing.length) {
      const after = await countItems(growFile)
      if (after <= before) {
        warning = `${grow.label}没有变化（还是 ${after} 条）：${grow.reason}，翻下面的日志确认`
        writeLog('[提示] ' + warning)
      }
    }
  } catch (error) {
    failure =
      error && error.name === 'AbortError'
        ? '任务被取消'
        : String(error && error.message ? error.message : error)
    writeLog('[失败] ' + failure)
  } finally {
    children.delete(id)
    logStream.end()
  }

  const error = failure
    ? failure
    : exitCode !== 0
      ? runner === 'codex'
        ? 'codex 退出码 ' + exitCode
        : '任务没跑完（退出码 ' + exitCode + '）'
      : missing.length
        ? '任务没有产出预期的产物（缺 ' + missing.join('、') + '），多半是环境问题，看下面的日志'
        : ''
  const canceled = failure === '任务被取消'

  await patchJob(root, courseId, id, {
    status: error ? (canceled ? 'canceled' : 'failed') : 'done',
    exitCode,
    finishedAt: new Date().toISOString(),
    summary: summary.slice(0, 6000),
    error,
    warning,
  })
}

export function cancelJob(id) {
  const controller = aborts.get(id)
  const child = children.get(id)
  if (!controller && !child) return false
  if (controller) {
    controller.abort()
    aborts.delete(id)
  }
  child?.kill()
  return true
}

/** 给 /api/health 用：现在走哪条路、用的哪个模型。key 不外传。 */
export async function runnerInfo() {
  const config = await loadConfig()
  const api = apiConfig(config)
  return {
    runner: runnerOf(config),
    model: api.model,
    baseUrl: api.baseUrl,
    hasApiKey: Boolean(api.apiKey),
    allowCommands: api.allowCommands,
    codexSandbox: config.codexSandbox || 'workspace-write',
    codexCommand: config.codexCommand || 'codex',
  }
}

export async function recoverJobs(root) {
  let entries = []
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    for (const job of await listJobs(root, entry.name)) {
      if (job.status === 'running' || job.status === 'queued') {
        await patchJob(root, entry.name, job.id, {
          status: 'interrupted',
          finishedAt: new Date().toISOString(),
          error: '工作台重启，任务已中断',
        })
      }
    }
  }
}

export function stageCatalog() {
  return Object.entries(STAGE_TASKS).map(([key, value]) => ({ key, title: value.title }))
}
