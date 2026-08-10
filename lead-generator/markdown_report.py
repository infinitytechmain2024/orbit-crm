"""Markdown report generator for lead generation results."""

import os
from datetime import datetime
from pathlib import Path

from models import Lead, SearchCriteria, ReportSummary


def generate_lead_section(lead: Lead, index: int) -> str:
    """Generate Markdown section for a single lead."""
    score_bar = "█" * lead.icp_score + "░" * (10 - lead.icp_score)
    status_emoji = {
        "new": "🆕",
        "contacted": "📞",
        "qualified": "✅",
        "converted": "🎯",
        "rejected": "❌",
    }.get(lead.status.value, "❓")

    contacts = []
    if lead.email:
        contacts.append(f"📧 [{lead.email}](mailto:{lead.email})")
    if lead.phone:
        contacts.append(f"📱 {lead.phone}")
    if lead.website:
        contacts.append(f"🌐 [{lead.website}]({lead.website})")
    if lead.linkedin:
        contacts.append(f"💼 [LinkedIn]({lead.linkedin})")

    contacts_str = " | ".join(contacts) if contacts else "_Контакты не найдены_"

    return f"""### {index}. {lead.name} {f'— {lead.company}' if lead.company else ''}

| Метрика | Значение |
|---------|----------|
| ICP Score | `{lead.icp_score}/10` {score_bar} |
| Статус | {status_emoji} {lead.status.value} |
| Отрасль | {lead.industry or '_не указана_'} |
| Локация | {lead.location or '_не указана_'} |

**Контакты:** {contacts_str}

**Описание:**
{lead.description or '_отсутствует_'}

**Анализ соответствия ICP:**
{lead.analysis or '_анализ не проведён_'}

**Рекомендуемый подход к первому контакту:**
{lead.outreach_approach or '_рекомендации не сформированы_'}

{"---" if lead.source_url else ""}
{"🔗 Источник: " + lead.source_url if lead.source_url else ""}

"""


def generate_report(
    criteria: SearchCriteria,
    leads: list[Lead],
    output_dir: str = "./reports",
) -> tuple[str, ReportSummary]:
    """Generate a full Markdown report and save to file.

    Returns:
        Tuple of (file_path, summary)
    """
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    filename = f"leads_report_{timestamp}.md"
    filepath = os.path.join(output_dir, filename)

    os.makedirs(output_dir, exist_ok=True)

    # Calculate summary stats
    total = len(leads)
    avg_score = sum(l.icp_score for l in leads) / total if total > 0 else 0
    industries = list(set(l.industry for l in leads if l.industry))

    # Build Markdown
    lines = [
        "# 📊 Lead Generation Report",
        "",
        f"**Дата:** {datetime.now().strftime('%d.%m.%Y %H:%M')}",
        f"**Найдено лидов:** {total}",
        f"**Средний ICP Score:** {avg_score:.1f}/10",
        "",
        "---",
        "",
        "## 🎯 Критерии поиска (ICP)",
        "",
        f"| Параметр | Значение |",
        f"|----------|----------|",
        f"| Отрасль | {criteria.industry} |",
        f"| Локация | {criteria.location} |",
        f"| Размер компании | {criteria.company_size} |",
        f"| Ключевые слова | {', '.join(criteria.keywords) if criteria.keywords else 'не указаны'} |",
        f"| Макс. результатов | {criteria.max_results} |",
        "",
        "---",
        "",
        "## 📈 Executive Summary",
        "",
        f"В ходе поиска было проанализировано множество источников в отрасли **{criteria.industry}** ",
        f"в регионе **{criteria.location}**. Из найденных кандидатов отобраны **{total}** лидов, ",
        f"наиболее соответствующих Ideal Customer Profile.",
        "",
        f"- 🟢 Высокий ICP Score (8-10): **{len([l for l in leads if l.icp_score >= 8])}** лидов",
        f"- 🟡 Средний ICP Score (5-7): **{len([l for l in leads if 5 <= l.icp_score < 8])}** лидов",
        f"- 🔴 Низкий ICP Score (1-4): **{len([l for l in leads if l.icp_score < 5])}** лидов",
        "",
        "---",
        "",
        "## 🔍 Детальный анализ лидов",
        "",
    ]

    # Sort leads by ICP score (best first)
    sorted_leads = sorted(leads, key=lambda x: x.icp_score, reverse=True)

    for i, lead in enumerate(sorted_leads, 1):
        lines.append(generate_lead_section(lead, i))

    # Market insights section
    lines.extend([
        "---",
        "",
        "## 🌍 Анализ рынка",
        "",
        f"Целевая отрасль: **{criteria.industry}**",
        f"Географический фокус: **{criteria.location}**",
        "",
        "### Найденные отрасли среди лидов",
        "",
    ])

    industry_counts = {}
    for lead in leads:
        if lead.industry:
            industry_counts[lead.industry] = industry_counts.get(lead.industry, 0) + 1

    for ind, count in sorted(industry_counts.items(), key=lambda x: x[1], reverse=True):
        lines.append(f"- **{ind}**: {count} лид(ов)")

    # Recommendations
    high_score_leads = [l for l in leads if l.icp_score >= 7]
    lines.extend([
        "",
        "---",
        "",
        "## 💡 Рекомендации",
        "",
        f"1. **Приоритетные контакты:** {len(high_score_leads)} лидов с ICP Score ≥ 7",
        "2. **Рекомендуемый порядок действий:**",
        "   - Начать с лидов с highest ICP Score",
        "   - Персонализировать первое сообщение на основе анализа",
        "   - Использовать рекомендуемый канал связи из секции outreach_approach",
        "3. **Следующие шаги:**",
        "   - Экспорт данных в Notion для управления воронкой",
        "   - Планирование outreach-кампании",
        f"   - Мониторинг ответов и корректировка стратегии",
        "",
        "---",
        "",
        f"_Отчёт сгенерирован автоматически системой Orbit Lead Generator_",
        f"_Время генерации: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}_",
    ])

    content = "\n".join(lines)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)

    summary = ReportSummary(
        total_leads=total,
        avg_icp_score=round(avg_score, 1),
        top_industries=industries[:5],
        report_path=filepath,
        generated_at=datetime.now(),
    )

    return filepath, summary


def read_report(filepath: str) -> str:
    """Read and return Markdown report content."""
    with open(filepath, "r", encoding="utf-8") as f:
        return f.read()


def list_reports(output_dir: str = "./reports") -> list[dict]:
    """List all generated reports with metadata."""
    reports_dir = Path(output_dir)
    if not reports_dir.exists():
        return []

    reports = []
    for f in sorted(reports_dir.glob("leads_report_*.md"), reverse=True):
        stat = f.stat()
        reports.append({
            "filename": f.name,
            "path": str(f),
            "size_bytes": stat.st_size,
            "created_at": datetime.fromtimestamp(stat.st_ctime).isoformat(),
        })

    return reports
