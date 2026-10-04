import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { refreshCalendar } from '../server/calendar.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(here, '..')
const entries = JSON.parse(await fsp.readFile(path.join(appRoot, 'calendars.json'), 'utf8'))
const calendarDir = path.join(appRoot, 'calendars')

for (const entry of entries) {
  const calendar = await refreshCalendar(calendarDir, entry)
  console.log(`${calendar.id} · ${calendar.academicYear} · ${calendar.events.length} 个日程`)
  for (const term of calendar.terms) {
    console.log(
      `  ${term.name}：上课 ${term.teachingStart} → ${term.teachingEnd}，` +
        `复习 ${term.studyPeriodStart || '—'}，考试 ${term.examStart} → ${term.examEnd}，` +
        `假期 ${term.holidays.length} 天`,
    )
  }
}
