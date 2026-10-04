import { useState } from 'react'

import type { Course } from '../types'

interface Props {
  course: Course
}

export default function CourseProfile({ course }: Props) {
  const [openWeek, setOpenWeek] = useState<number | null>(null)

  const hasAny =
    course.code ||
    course.instructors?.length ||
    course.cilos?.length ||
    course.assessment?.length ||
    course.weekly?.length ||
    course.textbooks?.length ||
    course.references?.length

  if (!hasAny) {
    return (
      <section>
        <h2 className="section-title">课程档案</h2>
        <p className="section-hint">
          按课程资料标准收集的七部分内容会显示在这里：课程信息、授课信息、学习成果、考核方式、
          课程内容、周次安排、教材与参考书。
        </p>
        <div className="empty">
          还没有结构化档案。把课程大纲传进「材料」的课程知识库，再跑一次提取。
        </div>
      </section>
    )
  }

  return (
    <section>
      <h2 className="section-title">课程档案</h2>
      <p className="section-hint">
        按课程资料标准收集，字段固定，方便不同课程之间对比和统一复习。
      </p>

      <div className="profile-grid">
        <div>
          <div className="spine__label" style={{ color: 'var(--ink-500)' }}>
            1 课程信息
          </div>
          <dl className="profile-list">
            <dt>课程代码</dt>
            <dd>{course.code || '—'}</dd>
            <dt>课程名称</dt>
            <dd>
              {course.titleEn || '—'}
              {course.titleZh ? ` / ${course.titleZh}` : ''}
            </dd>
            <dt>开课单位</dt>
            <dd>{course.institution || '—'}</dd>
            <dt>先修要求</dt>
            <dd>{course.prerequisites || '无'}</dd>
            <dt>学期</dt>
            <dd>
              {course.term || '—'}
              {course.startDate ? `　${course.startDate} → ${course.endDate || '—'}` : ''}
            </dd>
          </dl>
          {course.description && <p className="profile-note">{course.description}</p>}
          {course.almanacUrl && (
            <p className="mono">
              校历：
              <a href={course.almanacUrl} target="_blank" rel="noreferrer">
                {course.almanacUrl}
              </a>
            </p>
          )}
        </div>

        <div>
          <div className="spine__label" style={{ color: 'var(--ink-500)' }}>
            2 授课信息
          </div>
          {(course.instructors || []).length === 0 ? (
            <p className="muted">—</p>
          ) : (
            <ul className="profile-plain">
              {course.instructors.map((person, index) => (
                <li key={index}>
                  <strong>{person.name || '未署名'}</strong>
                  <span className="mono">
                    {person.officeHours ? `　答疑 ${person.officeHours}` : ''}
                    {person.office ? `　办公室 ${person.office}` : ''}
                  </span>
                  <div className="mono">
                    {person.email || ''}
                    {person.phone ? `　${person.phone}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="spine__label" style={{ color: 'var(--ink-500)' }}>
            3 预期学习成果 CILO
          </div>
          {(course.cilos || []).length === 0 ? (
            <p className="muted">—</p>
          ) : (
            <ul className="profile-plain">
              {course.cilos.map((item, index) => (
                <li key={index}>
                  <span className="mono">{item.id || `CILO-${index + 1}`}</span>　{item.text}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="spine__label" style={{ color: 'var(--ink-500)' }}>
            4 考核方式
          </div>
          {(course.assessment || []).length === 0 ? (
            <p className="muted">—</p>
          ) : (
            <ul className="profile-plain">
              {course.assessment.map((item, index) => (
                <li key={index}>
                  <span>{item.name}</span>
                  <span className="mono" style={{ marginLeft: 8 }}>
                    {item.weight}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <div className="spine__label" style={{ color: 'var(--ink-500)' }}>
          6 周次安排（{(course.weekly || []).length} 周）
        </div>
        {(course.weekly || []).length === 0 ? (
          <p className="muted">—</p>
        ) : (
          <ul className="profile-plain profile-weekly">
            {course.weekly.map((item, index) => {
              const week = item.week ?? index + 1
              const open = openWeek === week
              return (
                <li key={week}>
                  <button
                    type="button"
                    className="week-toggle"
                    aria-expanded={open}
                    onClick={() => setOpenWeek(open ? null : week)}
                  >
                    <span className="mono">第 {week} 周</span>
                    <span>{item.topic}</span>
                    <span className="mono">{item.instructor || ''}</span>
                  </button>
                  {open && (item.subtopics || []).length > 0 && (
                    <ul className="week-sub">
                      {item.subtopics?.map((sub, subIndex) => (
                        <li key={subIndex}>{sub}</li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="profile-grid" style={{ marginTop: 22 }}>
        <div>
          <div className="spine__label" style={{ color: 'var(--ink-500)' }}>
            7 教材
          </div>
          {(course.textbooks || []).length === 0 ? (
            <p className="muted">—</p>
          ) : (
            <ul className="profile-plain">
              {course.textbooks.map((item, index) => (
                <li key={index}>{item.citation}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="spine__label" style={{ color: 'var(--ink-500)' }}>
            7 参考书
          </div>
          {(course.references || []).length === 0 ? (
            <p className="muted">—</p>
          ) : (
            <ul className="profile-plain">
              {course.references.map((item, index) => (
                <li key={index}>{item.citation}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
