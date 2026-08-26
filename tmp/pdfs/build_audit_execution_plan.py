import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

SOURCE = Path("/Users/dmytrolishchyna/Desktop/AUDIT_EXECUTION_PLAN.md")
OUTPUT = Path("output/pdf/orbit-crm-openclaw-execution-plan.pdf")

pdfmetrics.registerFont(TTFont("Arial", "/System/Library/Fonts/Supplemental/Arial.ttf"))
pdfmetrics.registerFont(TTFont("Arial-Bold", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"))

NAVY = colors.HexColor("#12213A")
BLUE = colors.HexColor("#246BCE")
RED = colors.HexColor("#B42318")
PALE = colors.HexColor("#F2F6FA")
GRID = colors.HexColor("#D7E0EA")
TEXT = colors.HexColor("#263445")
MUTED = colors.HexColor("#64748B")
GREEN = colors.HexColor("#16794A")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="TitleRu", fontName="Arial-Bold", fontSize=23, leading=28, textColor=NAVY, spaceAfter=10))
styles.add(ParagraphStyle(name="H1Ru", fontName="Arial-Bold", fontSize=15.5, leading=19, textColor=NAVY, spaceBefore=10, spaceAfter=7, keepWithNext=True))
styles.add(ParagraphStyle(name="H2Ru", fontName="Arial-Bold", fontSize=12, leading=15, textColor=BLUE, spaceBefore=8, spaceAfter=5, keepWithNext=True))
styles.add(ParagraphStyle(name="H3Ru", fontName="Arial-Bold", fontSize=10.5, leading=13.5, textColor=NAVY, spaceBefore=7, spaceAfter=4, keepWithNext=True))
styles.add(ParagraphStyle(name="BodyRu", fontName="Arial", fontSize=8.9, leading=12.3, textColor=TEXT, spaceAfter=4))
styles.add(ParagraphStyle(name="SmallRu", fontName="Arial", fontSize=7.0, leading=8.8, textColor=TEXT))
styles.add(ParagraphStyle(name="TableHeadRu", fontName="Arial-Bold", fontSize=7.0, leading=8.8, textColor=colors.white))
styles.add(ParagraphStyle(name="QuoteRu", fontName="Arial", fontSize=8.7, leading=12.5, textColor=NAVY, backColor=PALE, borderColor=BLUE, borderWidth=1, borderPadding=7, leftIndent=6, rightIndent=6, spaceBefore=13, spaceAfter=7))
styles.add(ParagraphStyle(name="CodeRu", fontName="Arial", fontSize=7.2, leading=9.5, textColor=NAVY, backColor=PALE, borderPadding=7, spaceBefore=3, spaceAfter=7))


def inline(text: str) -> str:
    text = html.escape(text.strip())
    text = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    return text


def para(text: str, style="BodyRu"):
    return Paragraph(inline(text), styles[style])


def md_table(rows):
    headers = rows[0]
    body = rows[2:]
    cols = len(headers)
    total = 167 * mm
    if cols == 2:
        widths = [45 * mm, 122 * mm]
    elif cols == 3:
        widths = [22 * mm, 55 * mm, 90 * mm]
    elif cols == 4:
        widths = [37 * mm, 20 * mm, 55 * mm, 55 * mm]
    elif cols == 5:
        widths = [10 * mm, 33 * mm, 34 * mm, 19 * mm, 71 * mm]
    else:
        widths = [total / cols] * cols
    data = [[Paragraph(inline(cell), styles["TableHeadRu"]) for cell in headers]]
    for row in body:
        padded = row + [""] * (cols - len(row))
        data.append([Paragraph(inline(cell), styles["SmallRu"]) for cell in padded[:cols]])
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.35, GRID),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


class PlanDoc(BaseDocTemplate):
    def __init__(self, filename):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=14 * mm,
            rightMargin=14 * mm,
            topMargin=18 * mm,
            bottomMargin=21 * mm,
            title="Orbit CRM + OpenClaw - рабочий план устранения замечаний аудита",
            author="Codex",
        )
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="main")
        self.addPageTemplates(PageTemplate(id="plan", frames=frame, onPageEnd=self.header_footer))

    def header_footer(self, canvas: Canvas, doc):
        canvas.saveState()
        width, height = A4
        canvas.setStrokeColor(GRID)
        canvas.setLineWidth(0.5)
        canvas.line(14 * mm, height - 11 * mm, width - 14 * mm, height - 11 * mm)
        canvas.setFont("Arial", 7.4)
        canvas.setFillColor(MUTED)
        canvas.drawString(14 * mm, height - 8.5 * mm, "ORBIT CRM / OPENCLAW - ПЛАН ВЫПОЛНЕНИЯ")
        canvas.drawString(14 * mm, 8.5 * mm, f"Страница {doc.page}")
        canvas.restoreState()


def parse_markdown(text: str):
    lines = text.splitlines()
    story = []
    i = 0
    first_title = True
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith("```"):
            code = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            story.append(Paragraph("<br/>".join(html.escape(x) or " " for x in code), styles["CodeRu"]))
            i += 1
            continue
        if stripped.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            if len(rows) >= 2:
                story.append(md_table(rows))
                story.append(Spacer(1, 4 * mm))
            continue
        if stripped.startswith("> "):
            story.append(Paragraph(inline(stripped[2:]), styles["QuoteRu"]))
            i += 1
            continue
        if stripped.startswith("# "):
            if first_title:
                story.extend([Spacer(1, 10 * mm), para(stripped[2:], "TitleRu")])
                first_title = False
            else:
                story.append(para(stripped[2:], "H1Ru"))
            i += 1
            continue
        if stripped.startswith("## "):
            story.append(para(stripped[3:], "H1Ru"))
            i += 1
            continue
        if stripped.startswith("### "):
            story.append(para(stripped[4:], "H2Ru"))
            i += 1
            continue
        if stripped.startswith("#### "):
            story.append(para(stripped[5:], "H3Ru"))
            i += 1
            continue
        if re.match(r"^- \[[ xX]\] ", stripped) or stripped.startswith("- "):
            items = []
            while i < len(lines):
                item = lines[i].strip()
                if not (re.match(r"^- \[[ xX]\] ", item) or item.startswith("- ")):
                    break
                if re.match(r"^- \[[ xX]\] ", item):
                    item = "[ ] " + re.sub(r"^- \[[ xX]\] ", "", item)
                else:
                    item = item[2:]
                items.append(ListItem(para(item), leftIndent=12))
                i += 1
            story.append(ListFlowable(items, bulletType="bullet", leftIndent=16, bulletFontName="Arial", bulletColor=BLUE, bulletFontSize=6, spaceAfter=5))
            continue
        if re.match(r"^\d+\. ", stripped):
            items = []
            while i < len(lines) and re.match(r"^\d+\. ", lines[i].strip()):
                item = re.sub(r"^\d+\. ", "", lines[i].strip())
                items.append(ListItem(para(item), leftIndent=14))
                i += 1
            story.append(ListFlowable(items, bulletType="1", leftIndent=20, bulletFontName="Arial-Bold", bulletFontSize=7.5, spaceAfter=6))
            continue
        if stripped == "---":
            story.append(Spacer(1, 2 * mm))
            i += 1
            continue
        paragraphs = [stripped]
        i += 1
        while i < len(lines):
            nxt = lines[i].strip()
            if not nxt or nxt.startswith(("#", "|", ">", "```", "- ")) or re.match(r"^\d+\. ", nxt):
                break
            paragraphs.append(nxt)
            i += 1
        story.append(para(" ".join(paragraphs)))
    return story


OUTPUT.parent.mkdir(parents=True, exist_ok=True)
document = PlanDoc(str(OUTPUT))
document.build(parse_markdown(SOURCE.read_text(encoding="utf-8")))
print(OUTPUT)
