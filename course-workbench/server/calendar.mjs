import fsp from 'node:fs/promises'
import path from 'node:path'

/** 把 .ics 的日期（YYYYMMDD）转成 YYYY-MM-DD */
function iso(value) {
  if (!value || value.length < 8) return ''
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

export function parseIcs(text) {
  const events = []
  const blocks = text.split('BEGIN:VEVENT').slice(1)
  for (const block of blocks) {
    const body = block.split('END:VEVENT')[0]
    const start = /DTSTART[^:]*:(\d{8})/.exec(body)
    if (!start) continue
    const end = /DTEND[^:]*:(\d{8})/.exec(body)
    const summary = /SUMMARY:(.*)/.exec(body)
    events.push({
      date: iso(start[1]),
      endDate: end ? iso(end[1]) : '',
      name: summary ? summary[1].trim() : '',
    })
  }
  events.sort((a, b) => a.date.localeCompare(b.date))
  return events
}

function pick(events, keyword) {
  const hit = events.find((event) => event.name.toLowerCase().includes(keyword.toLowerCase()))
  return hit ? hit.date : ''
}

/**
 * 从事件列表里归纳出学期结构。校历只写「第 1/2 学期」，
 * 这里按事件名里的 1st / 2nd 区分，不依赖硬编码日期。
 */
function buildTerm(events, ordinal, label) {
  const teachingStart = pick(events, `First day of ${ordinal} semester's classes`)
  const teachingEnd = pick(events, `Last day of ${ordinal} semester's classes`)
  const examEvent = events.find((event) =>
    event.name.toLowerCase().includes(`${ordinal} semester's final examinations`),
  )
  const studyEvent = events.find(
    (event) =>
      event.name.toLowerCase().includes('examination study period') &&
      (!teachingEnd || event.date >= teachingEnd),
  )
  if (!teachingStart) return null

  const holidays = events
    .filter((event) => {
      if (event.date < teachingStart) return false
      if (teachingEnd && event.date > teachingEnd) return false
      const name = event.name.toLowerCase()
      if (name.includes("classes") || name.includes('contingency')) return false
      if (name.includes('examination study period')) return false
      return true
    })
    .map((event) => ({ date: event.date, name: event.name }))

  return {
    id: ordinal === '1st' ? 'term-1' : 'term-2',
    name: label,
    teachingStart,
    teachingEnd,
    studyPeriodStart: studyEvent ? studyEvent.date : '',
    examStart: examEvent ? examEvent.date : '',
    examEnd: examEvent ? examEvent.endDate : '',
    holidays,
  }
}

export function buildCalendar(events, meta) {
  const terms = [
    buildTerm(events, '1st', '第一学期'),
    buildTerm(events, '2nd', '第二学期'),
  ].filter(Boolean)
  return { ...meta, terms, events }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  })
  if (!response.ok) throw new Error(`校历下载失败：HTTP ${response.status}`)
  return response.text()
}

/** 拉取校历并写入 calendars/<id>.json，返回结构化结果。 */
export async function refreshCalendar(calendarDir, entry) {
  const text = await fetchText(entry.ics)
  const events = parseIcs(text)
  if (!events.length) throw new Error('校历里没有解析到任何日程')
  const calendar = buildCalendar(events, {
    id: entry.id,
    university: entry.university,
    academicYear: entry.academicYear,
    source: entry.source,
    ics: entry.ics,
    fetchedAt: new Date().toISOString(),
  })
  await fsp.mkdir(calendarDir, { recursive: true })
  await fsp.writeFile(
    path.join(calendarDir, `${entry.id}.json`),
    `${JSON.stringify(calendar, null, 2)}\n`,
    'utf8',
  )
  return calendar
}

export async function listCalendars(calendarDir) {
  let entries = []
  try {
    entries = await fsp.readdir(calendarDir)
  } catch {
    return []
  }
  const calendars = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    try {
      const raw = await fsp.readFile(path.join(calendarDir, name), 'utf8')
      calendars.push(JSON.parse(raw))
    } catch {
      /* 跳过损坏文件 */
    }
  }
  return calendars
}
