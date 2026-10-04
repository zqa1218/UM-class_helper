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
  bytes: number
  status: string
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
