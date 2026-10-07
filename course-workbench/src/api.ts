import type {
  CalendarInfo,
  Course,
  ExtractedCourse,
  FileEntry,
  Job,
  MoodleCourse,
  MoodleImportResult,
  MoodleStatus,
  Outline,
  QuizItem,
  StageState,
  StageTask,
  TextbookEntry,
} from './types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `请求失败（${response.status}）`
    throw new Error(message)
  }
  return data as T
}

export const api = {
  health: () =>
    request<{
      ok: boolean
      courseRoot: string
      runner: 'api' | 'codex'
      model: string
      baseUrl: string
      hasApiKey: boolean
      allowCommands: boolean
      codexSandbox: string
      codexCommand: string
    }>('/api/health'),

  stages: () => request<{ stages: StageState[]; tasks: StageTask[] }>('/api/stages'),

  listCourses: () => request<{ courses: Course[] }>('/api/courses'),

  getCourse: (id: string) => request<{ course: Course }>(`/api/courses/${encodeURIComponent(id)}`),

  createCourse: (payload: Partial<Course>) =>
    request<{ course: Course }>('/api/courses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  updateCourse: (id: string, payload: Partial<Course>) =>
    request<{ course: Course }>(`/api/courses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  deleteCourse: (id: string) =>
    request<{ ok: boolean }>(`/api/courses/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listFiles: (id: string, stage: string) =>
    request<{ files: FileEntry[] }>(
      `/api/courses/${encodeURIComponent(id)}/files?stage=${encodeURIComponent(stage)}`,
    ),

  readText: (id: string, relPath: string) =>
    request<{ path: string; text: string }>(
      `/api/courses/${encodeURIComponent(id)}/text?path=${encodeURIComponent(relPath)}`,
    ),

  rawUrl: (id: string, relPath: string) =>
    `/api/courses/${encodeURIComponent(id)}/raw?path=${encodeURIComponent(relPath)}`,

  deleteFile: (id: string, relPath: string, questions: 'keep' | 'drop' = 'keep') =>
    request<{
      ok: boolean
      /** drop 时删掉/keep 时保留的题目数 */
      dropped: number
      kept: number
      pointsRemoved: number
      pointsUntagged: number
      notesRemoved: number
    }>(
      `/api/courses/${encodeURIComponent(id)}/file?path=${encodeURIComponent(relPath)}&questions=${questions}`,
      { method: 'DELETE' },
    ),

  upload: async (id: string, stage: string, file: File, rel = '') => {
    const query = new URLSearchParams({ stage, name: file.name, rel })
    const response = await fetch(
      `/api/courses/${encodeURIComponent(id)}/upload?${query.toString()}`,
      { method: 'POST', body: file },
    )
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(data?.error ? String(data.error) : `上传失败（${response.status}）`)
    }
    return data as { file: FileEntry }
  },

  listJobs: (id: string) =>
    request<{ jobs: Job[] }>(`/api/courses/${encodeURIComponent(id)}/jobs`),

  getJob: (id: string, jobId: string) =>
    request<{ job: Job; log: string }>(
      `/api/courses/${encodeURIComponent(id)}/jobs/${encodeURIComponent(jobId)}?tail=400`,
    ),

  createJob: (id: string, payload: { stage: string; instruction?: string; title?: string }) =>
    request<{ job: Job }>(`/api/courses/${encodeURIComponent(id)}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  cancelJob: (id: string, jobId: string) =>
    request<{ ok: boolean }>(
      `/api/courses/${encodeURIComponent(id)}/jobs/${encodeURIComponent(jobId)}/cancel`,
      { method: 'POST' },
    ),

  loadOutline: async (id: string): Promise<Outline> => {
    const { text } = await api.readText(id, '06_outline/outline.json')
    return JSON.parse(text) as Outline
  },

  loadBank: async (id: string): Promise<QuizItem[]> => {
    const { text } = await api.readText(id, '09_quiz/bank.json')
    const parsed = JSON.parse(text) as { items?: QuizItem[] } | QuizItem[]
    return Array.isArray(parsed) ? parsed : parsed.items || []
  },

  recordAnswer: (id: string, quizId: string, correct: boolean) =>
    request<{ item: QuizItem }>(`/api/courses/${encodeURIComponent(id)}/quiz/record`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: quizId, correct }),
    }),

  loadExtracted: (id: string) =>
    request<{ extracted: ExtractedCourse | null }>(
      `/api/courses/${encodeURIComponent(id)}/extracted`,
    ),

  applyExtracted: (
    id: string,
    payload: {
      fields?: Record<string, unknown>
      mode?: 'merge' | 'replace'
      overwrite?: boolean
      dismiss?: boolean
    },
  ) =>
    request<{ course: Course }>(`/api/courses/${encodeURIComponent(id)}/extracted/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  listCalendars: () => request<{ calendars: CalendarInfo[] }>('/api/calendars'),

  refreshCalendars: () =>
    request<{ results: { id: string; ok: boolean; error?: string }[] }>(
      '/api/calendars/refresh',
      { method: 'POST' },
    ),

  listTextbooks: (id: string) =>
    request<{ books: TextbookEntry[] }>(`/api/courses/${encodeURIComponent(id)}/textbooks`),

  scaffoldTextbooks: (id: string) =>
    request<{ total: number; created: string[]; entries: TextbookEntry[] }>(
      `/api/courses/${encodeURIComponent(id)}/textbooks/scaffold`,
      { method: 'POST' },
    ),

  moodleStatus: () => request<{ moodle: MoodleStatus }>('/api/moodle/status'),

  moodleCheck: () =>
    request<{ result: { ok: boolean; mode: string; site: string; user: string } }>(
      '/api/moodle/check',
      { method: 'POST' },
    ),

  /** 读一门 Moodle 课的目录，用来预览小节和课件，还不下载。 */
  moodleCourse: (courseId: string) =>
    request<{ course: MoodleCourse }>(
      `/api/moodle/course?courseId=${encodeURIComponent(courseId)}`,
    ),

  moodleImport: (payload: {
    id: string
    courseId: string
    /** 只导这几节；不传就导全部 */
    sections?: number[]
    /** 是否把读到的日期写进时间轴，默认写 */
    schedule?: boolean
  }) =>
    request<MoodleImportResult>('/api/moodle/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
}
