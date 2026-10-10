# 课表 ZIP 导入设计

## 目标

MemoFlow 从用户选择的课表 ZIP 中导入课程安排。ZIP 包含一个或多个 iCalendar (`.ics`) 文件，每个文件代表一门按周重复的课程。Blackboard 入口继续只负责导入作业、项目、考试和作业描述，并改名为“从 Blackboard 导入作业”。

## 用户流程

1. 用户进入左侧“周课表”。
2. 点击“导入课表 ZIP”，选择本地 `.zip` 文件。
3. 应用在本地解压 ZIP，读取其中所有 `.ics`/`.ICS` 文件。
4. 解析完成后显示预览：课程数量、课程代码、星期、时间、地点和解析失败文件数量。
5. 用户确认后写入本地周课表；再次导入同一 ZIP 通过 UID 去重并更新变更。
6. 取消、空 ZIP、无 ICS 或坏文件只在导入窗口显示明确错误，不影响已有数据。

## 数据与范围

- `SUMMARY` 提供课程名称和代码；必要时从标题提取代码。
- `DTSTART`/`DTEND` 提供首次上课日期和时间。
- `RRULE:FREQ=WEEKLY;COUNT=n;BYDAY=XX` 提供星期和学期重复范围。
- `LOCATION` 提供教室。
- `UID` 是稳定去重键。
- 课程表导入只写入 `courseSchedules`，不创建备忘录或提醒。
- 课程记录保留 `startDate`、`endDate` 和 `recurrenceRule`，周视图只显示当前重复范围内的课程。
- ZIP 文件不会上传，也不会保存原始内容。

## 架构

- 新增 `src/lib/import/schedule-zip.ts`，使用 `fflate` 解压并调用现有 `parseIcalFeed` 的课程解析逻辑，输出课程候选和文件级错误。
- 新增独立的 `CourseScheduleImportDialog.svelte`，负责文件选择、读取状态、预览和确认。
- `WeeklySchedule.svelte` 增加导入入口并按课程有效日期过滤。
- `repository.importCourseSchedules` 负责通用课程导入；保留旧 `importBlackboardSchedules` 兼容已有调用。
- `App.svelte` 接收课程导入结果并刷新快照；Blackboard 导入窗口文案改为“从 Blackboard 导入作业”。

## 错误处理

- 选择非 ZIP 文件：提示只能选择 `.zip`。
- ZIP 无法解压：提示文件损坏或格式不支持。
- ZIP 没有 ICS：提示未找到课程文件。
- 单个 ICS 解析失败：列出文件名并继续显示其他有效课程。
- 所有 ICS 均失败：禁止确认导入。

## 验收标准

- 给定 `Class_Schedule_Data_226010343_2610.zip`，预览显示 6 节课程：周一至周五，其中 CIE6007 在周二和周四各一节。
- 课程代码、时间、地点和每周重复范围与 ICS 内容一致。
- 同一 ZIP 重复导入不产生重复记录。
- ZIP 中混入坏 ICS 时，有效课程仍可确认导入，并显示失败文件。
- 课程不会被错误创建为提醒或 Blackboard 作业。
- Blackboard 入口显示“从 Blackboard 导入作业”。
