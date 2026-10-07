export type MilestoneKind = 'lecture' | 'deadline' | 'exam' | 'reading' | 'other'

export interface Milestone {
  id: string
  date: string
  title: string
  kind: MilestoneKind
  note: string
  done: boolean
}

export interface StageState {
  key: string
  label: string
  hint: string
  files: number
  status: string
}

/** /api/stages 返回的整理任务；key 是阶段目录名，或 full。 */
export interface StageTask {
  key: string
  title: string
}

export interface Course {
  id: string
  name: string
  term: string
  teacher: string
  institution: string
  description: string
  keywords: string[]
  startDate: string
  endDate: string
  code: string
  titleEn: string
  titleZh: string
  prerequisites: string
  calendarId: string
  termId: string
  meetingSlot: MeetingSlot | null
  weekOverrides: WeekOverride[]
  instructors: Instructor[]
  cilos: Cilo[]
  assessment: AssessmentItem[]
  weekly: WeeklyItem[]
  textbooks: Citation[]
  references: Citation[]
  almanacUrl: string
  createdAt: string
  updatedAt: string
  schedule: Milestone[]
  directory: string
  stages: StageState[]
  nextMilestone: Milestone | null
  milestoneCount: number
  doneMilestones: number
  pointCount: number
  quizCount: number
  materialCount: number
}

export interface FileEntry {
  path: string
  name: string
  size: number
  sizeLabel: string
  modified: string
  ext: string
}

export interface Job {
  id: string
  courseId: string
  stage: string
  title: string
  instruction: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'interrupted' | 'canceled'
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  exitCode: number | null
  summary: string
  error: string
  /** 跑完了但结果可疑时的提示（例如题库条数没涨），不影响 done/failed。 */
  warning?: string
}

export interface QuizItem {
  id: string
  type: string
  stem: string
  options?: Record<string, string>
  answer: string[]
  explanation?: string
  pointIds?: string[]
  difficulty?: string
  sources?: string[]
  /** 题目来自截图时，原图在课程目录里的相对路径，练习页会把它显示出来 */
  images?: string[]
  isExtension?: boolean
  attempts?: number
  wrongCount?: number
}

export interface OutlinePoint {
  id: string
  title: string
  definition?: string
  keywords?: string[]
  level?: string
  sources?: string[]
  /** 知识点是从笔记照片里整理的时，原图在课程目录里的相对路径 */
  images?: string[]
  hasSupplement?: boolean
}

export interface OutlineSection {
  id: string
  title: string
  points?: OutlinePoint[]
}

export interface OutlineUnit {
  id: string
  title: string
  sections?: OutlineSection[]
}

export interface Outline {
  course?: string
  units?: OutlineUnit[]
}

export interface ExtractedScheduleItem {
  date: string
  title: string
  kind: MilestoneKind
  note?: string
}

export interface ExtractedCourse {
  name?: string
  code?: string
  titleEn?: string
  titleZh?: string
  term?: string
  teacher?: string
  institution?: string
  startDate?: string
  endDate?: string
  description?: string
  prerequisites?: string
  almanacUrl?: string
  keywords?: string[]
  schedule?: ExtractedScheduleItem[]
  instructors?: Instructor[]
  cilos?: Cilo[]
  assessment?: AssessmentItem[]
  weekly?: WeeklyItem[]
  textbooks?: Citation[]
  references?: Citation[]
  fieldNotes?: Record<string, string>
  uncertain?: string[]
  appliedAt?: string
}

export interface Instructor {
  name?: string
  email?: string
  phone?: string
  office?: string
  officeHours?: string
}

export interface Cilo {
  id?: string
  text?: string
}

export interface AssessmentItem {
  name?: string
  weight?: string
}

export interface WeeklyItem {
  week?: number
  topic?: string
  instructor?: string
  subtopics?: string[]
}

export interface Citation {
  citation?: string
}

export interface MeetingSlot {
  weekday: number
  start: string
  end: string
  location: string
}

export type OverrideKind = 'cancelled' | 'moved' | 'online' | 'extra' | 'other'

export interface WeekOverride {
  week: number
  kind: OverrideKind
  date: string
  note: string
}

export interface TermHoliday {
  date: string
  name: string
}

export interface CalendarTerm {
  id: string
  name: string
  teachingStart: string
  teachingEnd: string
  studyPeriodStart: string
  examStart: string
  examEnd: string
  holidays: TermHoliday[]
}

export interface CalendarInfo {
  id: string
  university: string
  academicYear: string
  source: string
  ics: string
  fetchedAt: string
  terms: CalendarTerm[]
}

export interface TextbookEntry {
  slug: string
  role: 'textbook' | 'reference'
  citation: string
  year: string
  title: string
  publisher: string
  isbn: string
  access: string
  status: 'pending' | 'provided' | 'indexed'
  files: string[]
  chapters: { id?: string; title?: string; file?: string; pages?: string; weeks?: number[] }[]
}

/** /api/moodle/status 返回的连接状态；凭据本身不外传。 */
export interface MoodleStatus {
  baseUrl: string
  include: string[]
  /** 有 token 走接口，否则用登录后的 cookie；都没配就是空串。 */
  mode: '' | 'token' | 'cookie'
  configured: boolean
  /** 上次登录用的账号，只是拿来预填输入框；密码从来不存。 */
  username: string
}

export interface MoodleFile {
  name: string
  size: number
}

export interface MoodleModule {
  id: number
  name: string
  modname: string
  files: MoodleFile[]
}

/** Moodle 上的一个小节；date / time 是从小节名或摘要里读出来的上课时间。 */
export interface MoodleSection {
  index: number
  name: string
  text: string
  date: string
  time: string
  modules: MoodleModule[]
}

export interface MoodleEvent {
  name: string
  date: string
  time: string
}

export interface MoodleCourse {
  id: string
  fullname: string
  shortname: string
  startDate: string
  source: 'token' | 'cookie'
  sections: MoodleSection[]
  events: MoodleEvent[]
}

export interface MoodleImportFile {
  name: string
  /** 相对课程目录的路径，例如 00_source/week-03/lecture.pdf */
  path: string
  size: number
  week: number
  section: string
  module: string
  date: string
}

export interface MoodleImportResult {
  moodle: { id: string; fullname: string; source: string; sections: number }
  files: MoodleImportFile[]
  skipped: { name: string; reason: string }[]
  /** 顺手补进时间轴的上课节点（同日期同标题的不会重复加）。 */
  milestones: ExtractedScheduleItem[]
  /** 有课件但还没录音的周次，等着补录音做完整上课分析。 */
  missingRecordings: number[]
  /** 导入后按周自动排上的「整理课件知识点集锦」任务。 */
  digests: { week: number; id: string }[]
}
