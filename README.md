# UM class helper · 课程工作台

帮助澳大学生准备考试和复习。

把课堂录音和课件，整理成能长期复用的课程知识资产。

每门课是一个独立项目：导入学校发的课程大纲，排好课表，之后每次课把录音和课件丢进来，
工作台调用 Codex 按固定流水线加工，产出知识点大纲、图文笔记、知识图谱和可反复训练的题库。

为澳门大学的课程环境做的：校历直接读学校发布的 `.ics`，周次按学期起始日推算，
课件与录音按周归档。

## 它做什么

一条流水线，从原始材料到可复习的成果：

```
录音 ──转写──┐
             ├── 对齐 ── 纠错 ── 学科补充 ── 知识点大纲 ──┬── 图文笔记
课件 ──解析──┘                                          ├── 知识图谱
                                                        ├── 讲课流程
                                                        └── 题库（选择题为主）
```

几条贯穿始终的原则：

- **不静默改写**。转写稿里有疑问的地方只做标注和纠错建议，低置信项标「待老师确认」。
- **一切可溯源**。每个知识点有稳定编号和来源（PPT 页码或录音时间戳），每条补充内容带出处。
- **题目与解析默认分离**。先给题、后给答案，方便反复训练。
- **不重复出题**。出题前查题库，同一知识点再出题必须换角度。
- **课程信息从文件来**。不手填，从学校大纲里提取，用户确认后才写入。

## 功能

| 模块 | 说明 |
|---|---|
| 课程档案 | 按固定七部分收集：课程信息、授课信息、学习目标、考核方式、课程内容、周次安排、教材与参考书 |
| 排课 | 读学校校历（`.ics`），按「第 1 教学周周一 +（周次−1）×7 +（上课日−1）」算每节课日期，假期冲突标出来让你决定取消或延期 |
| 材料 | 按周次归档，先选是哪一周的课再放录音和课件 |
| 校对 | 转写误识别、数字单位、口误矛盾、课件与讲述冲突，逐条给依据与置信度 |
| 大纲 | 三级知识点结构，稳定编号，作为出题的依据 |
| 笔记 | 图文笔记、讲课流程、一页总结 |
| 图谱 | Mermaid 知识图谱，节点按知识点编号组织 |
| 题库 | 练习模式，作答结果回写题库，支持错题重练与覆盖度统计 |
| 教材知识库 | 一本教材一个目录，登记书目与获取途径，放入合法副本后切章建索引 |
| 任务 | 每个整理环节一个任务，调起一次 Codex 会话，日志实时显示 |

## 快速开始

需要 Node.js 18 以上，以及已安装并登录的 [Codex CLI](https://github.com/openai/codex)。

```bash
cd course-workbench
npm install
npm run build
npm start
```

打开 http://127.0.0.1:8787

开发模式（前端热更新）：

```bash
npm run dev     # 打开 http://localhost:5173
```

改完代码想确认没跑偏，跑一次冒烟测试（临时目录起真服务，建课、上传、越界拦截走一遍）：

```bash
npm run smoke
```

### 装上流水线技能

工作台只负责界面和归档，真正的整理逻辑在一个 Codex 技能里。把仓库里的技能装到
Codex 的技能目录：

```bash
cp -r course-workbench/skills/lecture-knowledge-pipeline ~/.codex/skills/
```

Windows：

```powershell
Copy-Item -Recurse course-workbench\skills\lecture-knowledge-pipeline "$env:USERPROFILE\.codex\skills\"
```

装好后，工作台里的任务才能调起它。技能本身也带了说明文档，可以直接在 Codex 里用
`$lecture-knowledge-pipeline` 手动跑。

### 配套技能（可选）

流水线里的转写、教材查证两环依赖别的技能，按需装：

```bash
npx skills add openai/skills@transcribe -g -y            # 录音转文字，含说话人分离
npx skills add k-dense-ai/scientific-agent-skills@paper-lookup -g -y   # 查开放获取全文
```

不装也能跑，只是「转写录音」和「教材索引」两步会缺工具，届时可以自己转好稿再放进来。

### 配置

复制一份配置模板再改：

```bash
cd course-workbench
cp workbench.config.example.json workbench.config.json
```

| 字段 | 说明 |
|---|---|
| `courseRoot` | 课程数据存放位置，默认 `./courses` |
| `calendarRoot` | 校历数据存放位置，默认 `./calendars` |
| `port` | 服务端口，默认 8787 |
| `codexCommand` | 调用的 Codex 命令 |
| `codexSandbox` | 任务运行时的沙箱模式 |
| `codexExtraArgs` | 追加给 `codex exec` 的参数 |

不建这个文件也能跑，用的是上面的默认值。

## 目录结构

```
course-workbench/
  server/            本地服务：课程、任务、校历、教材
  src/               前端
  scripts/           冒烟测试与校历刷新脚本
  skills/            配套的 Codex 技能
  calendars.json     校历订阅地址
  calendars/         拉取到的校历数据
  courses/           课程数据（不进仓库）
```

CI 在 `.github/workflows/ci.yml`：`npm ci` → `npm run build` → `npm run smoke`。

每门课的目录：

```
courses/<课程名>/
  course.json        课程信息与时间轴
  COURSE.md          进度台账
  10_kb/             课程大纲、教材、知识库
  00_source/         录音与课件，按 week-01、week-02 归档
  01_transcript/     转写稿
  02_slides/         逐页文本与关键页图
  03_align/          页与讲述的对齐
  04_corrections/    纠错清单
  05_supplements/    学科补充
  06_outline/        知识点大纲
  07_notes/          笔记、讲课流程、总结
  08_graph/          知识图谱
  09_quiz/           题库
  _jobs/             任务日志
```

## 校历

澳门大学的校历有 `.ics` 订阅，机器可读，比解析网页稳定：

```bash
cd course-workbench
npm run calendar
```

地址配在 `calendars.json`，换学年改这里。其他学校如果也提供 `.ics`，
加一条即可。

## 一些说明

**关于沙箱。** 默认 `workspace-write`。若本机的 Codex 沙箱助手报
`helper_sandbox_lock_failed`，说明 `~/.codex/.sandbox-bin` 的权限有问题，
需要管理员权限重置属主，或把 `codexSandbox` 改成 `danger-full-access`
（此时任务里的 Codex 可以读写本机任意文件，自行判断）。

**关于教材。** 工作台不下载教材，也不接盗版来源。它只做结构化：登记书目、
记录合法获取途径、把你有权使用的副本切章建索引。详情见
`10_kb/textbooks/README.md`。

**关于课程数据。** `courses/` 已在 `.gitignore` 里。录音、课件、学校文件、
个人笔记都不会进仓库，请自行备份。

## 许可

[MIT](LICENSE)。
