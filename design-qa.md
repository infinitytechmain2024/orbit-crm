# Design QA — Граф знаний (финальная проверка на реальной базе)

- Визуальный источник: `/var/folders/lr/vmcchsrn0239jvl0djtc29980000gn/T/codex-clipboard-d082bb0c-e9d5-4069-87b3-329c98fe22bb.png`
- Размер источника и viewport: 1664 × 942 px
- Финальный экран: `/Users/dmytrolishchyna/Desktop/ORBIT CRM/design-qa-graph-final.png`
- Сравнение в одном изображении: `/Users/dmytrolishchyna/Desktop/ORBIT CRM/design-qa-graph-comparison.png`
- Состояние: реальная организация, выбран AYBOLIT, глубина 1, правая панель открыта

## Визуальное сравнение

Финальный экран сохраняет композицию референса: существующий Orbit shell, navy-полотно, круглые цветные узлы без карточек, тонкие направленные дуги, приглушение несвязанных проектов, minimap слева снизу, легенду, поиск/фильтры/глубину сверху и отдельную правую панель. Цвета AYBOLIT, BERRDO и OSNOVA соответствуют заданной cyan / pink-violet / emerald системе. На реальных данных карта закономерно разреженнее иллюстративного референса; вымышленные материалы для заполнения кластеров не добавлялись.

В viewport 1664 × 942 нет обрезанных панелей, наложений основных контролов или скрытых действий. Типографика, радиусы, границы и плотность управляющих элементов используют существующую систему Orbit CRM.

## Проверенные сценарии

- Первый экран содержит все 14 реальных проектов и не загружает дочерние сущности до выбора.
- Выбор AYBOLIT лениво раскрыл связанную задачу и сотрудника; отображаются 3 дуги, включая две разнесённые встречные дуги двусторонней связи.
- Глубина 2 раскрыла межпроектные цепочки через общего сотрудника без перегрузки уровня 1.
- Серверный поиск нашёл BERRDO и открыл его панель.
- Фильтры содержат группы типов и все реальные проекты организации.
- Через UI создана двусторонняя ручная связь BERRDO → AYBOLIT, затем изменена на `used_in` / одностороннюю и удалена; тестовая запись не оставлена в базе.
- Автоматическая связь помечена `авто` и не имеет действия удаления.
- Правая панель показывает прогресс, прямые типы, обмен связями, управление связями и переход к исходному объекту.
- В консоли браузера ошибок нет. Production build проходит.
- В Supabase подтверждены 25 узлов (14 проектов, 10 задач, 1 человек), 34 автоматические связи и 0 тестовых ручных связей после очистки.
- Транзакционными SQL-проверками подтверждены триггеры проекта/задачи, RLS, CRUD ручной связи и запрет удаления автоматической связи.

## Итерации

### Итерация 1 — исправлено

- [P1] Общий сотрудник визуально соединял выбранный проект со всеми остальными уже на глубине 1.
- [P2] Длинная двухколоночная раскладка 14 проектов уменьшала масштаб до нечитаемого состояния.
- [P2] Производная и сохранённая двусторонняя связь считались одновременно.
- [P2] Недоступный локально необязательный AI Workflow показывал навязчивое уведомление поверх легенды.

Исправления: связи ограничены активной глубиной, проекты размещены в компактной четырёхколоночной карте, сохранённая relation имеет приоритет над производной, а необязательное обогащение AI Workflow деградирует без блокирующего уведомления.

### Итерация 2 — passed

Повторное same-viewport сравнение не выявило оставшихся P0/P1/P2 дефектов. Единственное различие с референсом — меньшая насыщенность кластеров, обусловленная фактическим количеством материалов в текущей базе и требованием не использовать моки.

final result: passed

---

# Design QA — Граф знаний

- Source visual truth: `/Users/dmytrolishchyna/Desktop/graph.png`
- Source dimensions: 1672 × 941 px; normalized comparison copy: `design-qa-reference-1280.png`, 1280 × 720 px
- Implementation screenshot: `/Users/dmytrolishchyna/Desktop/ORBIT CRM/design-qa-implementation.png`
- Side-by-side comparison: `/Users/dmytrolishchyna/Desktop/ORBIT CRM/design-qa-comparison.png`
- Browser/CSS viewport: 1280 × 720 CSS px (Codex in-app browser)
- Implementation pixels: 1280 × 720 px
- Browser device scale factor: 2; the browser screenshot API returned a CSS-pixel-normalized 1280 × 720 image
- Density normalization: the 1672 × 941 source was proportionally downsampled to 1280 × 720; both compared artifacts therefore have identical pixel dimensions and aspect ratio
- State: dark theme, project selected, first-level real relations expanded, details panel open

## Full-view comparison evidence

The implementation preserves the reference composition: the existing Orbit navigation and header, a large dark constellation canvas, point-based nodes connected by fine curved lines, a persistent right-side details rail, a minimap at bottom-left, a compact legend, and fit/zoom controls at bottom-right. The teal active state, dimmed unrelated state, dotted reuse/secondary relations, border density, radii, and restrained typography all match the reference design language.

The graph topology intentionally follows accessible CRM data instead of recreating the reference's illustrative categories. Tasks, people, files, comments, checklist items, finances, leads, and project reuse therefore produce different branch labels while retaining the same visual hierarchy.

## Focused-region comparison evidence

No separate crop was required: the native 1280 × 720 implementation capture keeps the toolbar, node labels, minimap, zoom controls, and full right rail readable. The right rail was additionally verified through the browser DOM in project and task states, including progress, direct-type counts, reuse, recent materials, dependencies, and the inline relation composer.

## Required fidelity surfaces

- Fonts and typography: Uses Orbit's existing Montserrat/Open Sans stack, weight hierarchy, compact panel labels, and small graph annotations. Selected and direct node labels remain high-contrast; secondary labels appear only when zoom or selection makes them useful.
- Spacing and layout rhythm: Canvas, rail, minimap, legend, and controls remain in stable regions. The current Orbit shell is wider than the shell pictured in the normalized reference, an intentional constraint because the task requires preserving existing CRM navigation rather than redesigning it.
- Colors and tokens: Dark blue-black surfaces, turquoise active links, blue people, green tasks, violet materials, and amber generated/financial material map to the reference palette and existing Orbit tokens.
- Image quality and assets: The target contains no raster content assets beyond the existing Orbit brand mark. The implementation reuses the existing brand asset and the project's established icon library; no placeholder imagery or custom SVG illustration substitutes were introduced.
- Copy and content: Static Russian copy matches the requested workflow. Entity names, counts, progress, materials, and relations are computed from real CRM data in production; the screenshot uses a development-only preview snapshot kept outside production data loading.
- Responsiveness and accessibility: At the captured desktop breakpoint, controls remain reachable, the details rail scrolls independently, buttons have accessible names, form fields have visible labels/placeholders, and filtering/searching do not remove the selected context unexpectedly.

## Interaction and runtime verification

- Search found a task by title and selecting the result moved the details rail to that entity.
- Depth 3 exposed its image, document, assignee, and downstream project context.
- The Materials filter removed and restored document/image nodes.
- The relation composer opened inline, exposed all required relation types, found a second entity, and enabled creation after target selection.
- Node dragging changed the persisted graph position in the active session.
- Zoom-in changed the XYFlow viewport scale; fit-to-screen and minimap controls were present.
- Fresh-load browser console errors checked: none.
- Production build passed.
- Focused ESLint run passed with no errors; one pre-existing Fast Refresh warning remains in `crm-store.tsx`.

## Comparison history

### Iteration 1 — blocked

- [P1] The initial canvas remained full-width under the details rail, hiding a project and compressing relationships behind the panel.
- [P2] Direct task and person labels overlapped because all children shared a single narrow row.
- [P2] Reverse `related_to` rows were counted as separate project relations.
- [P2] The graph-only screen inherited the assistant bubble, which overlapped the primary relation action.
- [P2] Recent materials were absent for selected projects because only direct one-hop material nodes were considered.

Fixes made: reserved an actual rail-width canvas track, added automatic fit after lazy expansion, changed the task layout to a multi-row constellation, widened people spacing, deduplicated symmetric project relations, hid the assistant only on `/graph`, and sourced project materials from the visible multi-hop neighborhood.

### Iteration 2 — passed

Post-fix evidence is the current `design-qa-implementation.png` and `design-qa-comparison.png`. All projects fit inside the active canvas, labels no longer collide at the intended desktop state, project counts are correct, panel actions remain unobstructed, and recent material rows are present. No actionable P0/P1/P2 difference remains.

## Follow-up polish

- [P3] At smaller desktop widths, the existing 256 px Orbit sidebar and 338 px graph rail leave less canvas than the proportionally scaled reference. The graph remains usable through fit, zoom, pan, collapse, and rail close controls; changing the global shell was intentionally out of scope.
- [P3] Real project data may produce less visually balanced clusters than the curated reference. Saved manual positions and lazy expansion provide the intended correction path without inventing production records.

final result: passed

# Design QA — AI Workflow

- Source visual truth: `/Users/dmytrolishchyna/Desktop/ORBIT CRM/design-qa-ai-workflow-reference.png`
- Source dimensions: 1672 × 941 px
- Desktop implementation: `/Users/dmytrolishchyna/Desktop/ORBIT CRM/design-qa-ai-workflow-desktop.png`
- Mobile implementation: `/Users/dmytrolishchyna/Desktop/ORBIT CRM/design-qa-ai-workflow-mobile.png`
- Combined comparison: `/Users/dmytrolishchyna/Desktop/ORBIT CRM/design-qa-ai-workflow-comparison.png`
- Browser/CSS viewport: 1672 × 941 desktop and 390 × 844 mobile
- Density normalization: the reference and desktop implementation were captured at identical pixel dimensions and assembled vertically in one comparison artifact.
- State: dark theme, all projects, one pending CEO approval, active department work, populated timeline/artifacts/summary.

## Full-view and focused evidence

The implementation preserves the reference hierarchy and density: existing Orbit sidebar, compact header controls, a centered CEO approval card, three independent glowing connector branches, Developer/Marketer/HR department cards, a working task queue below, and a sticky three-block right rail. The palette, fine borders, restrained glass, turquoise glow, tiny operational labels, and dark navy depth align with the supplied target without copying its sample data.

The desktop comparison keeps the task queue visible in the first viewport and the right rail unobstructed. A focused mobile capture confirms that controls wrap in a usable order, the sidebar becomes an overlay, CEO actions remain reachable, and department/agent content reflows without horizontal overflow.

## Interaction and runtime verification

- Created a task through the modal, verified the project payload and immediate optimistic insertion.
- Verified capability routing independently for Frontend and SEO and verified the local preview assigns an interface task to Frontend.
- Changed a queued task to in-progress without reload.
- Approved the pending CEO request and verified the task moved to done while the approval card advanced/closed.
- Opened an agent profile with queue/in-progress/done counts, model, event history, artifacts, and manual assignment.
- Selected a department and verified the table reduced to that department's tasks.
- Opened the voice dialog without granting microphone access and verified the manual-task fallback.
- Opened the mobile overlay navigation and confirmed AI Workflow remains immediately after Projects.
- Browser console errors/warnings: none after the verified fresh load.

## Comparison history

### Iteration 1 — actionable

- [P2] The initial agent cards made the Marketer department too tall, pushing the working task table below the reference's first viewport.
- [P2] A global list reset removed timeline padding, allowing status dots to overlap the first letter of agent names.
- [P2] The assistant bubble overlapped the lower right summary card.
- [P2] The Realtime label consumed vertical space above the team map and appeared unfinished in preview mode.

Fixes made: compacted agent cards while retaining status, task count, and current work; restored timeline padding; disabled the unrelated assistant only on AI Workflow; moved Realtime state to the right rail; shortened the CEO card and connector track; and tightened department layout.

### Iteration 2 — passed

The final same-size comparison shows matching visual hierarchy, density, palette, and operational emphasis. The desktop task table now enters the initial viewport, mobile controls remain usable, and no actionable P0/P1/P2 difference remains.

## Follow-up polish

- [P3] The existing Orbit shell includes the Graph destination and account controls absent from the older visual reference. They are intentionally preserved so the new route does not regress current CRM navigation.
- [P3] Production row counts and card heights will vary with live tasks; the compact card treatment and scrollable task/right-rail regions keep the layout stable.

final result: passed
