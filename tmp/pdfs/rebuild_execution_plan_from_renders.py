from pathlib import Path

from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen.canvas import Canvas

ROOT = Path("tmp/pdfs")
FIRST_SOURCE = ROOT / "execution-plan-corrected.jctXTz/page-1.png"
OTHER_SOURCE = ROOT / "execution-plan-final.sjwWnw"
CORRECTED_FIRST = ROOT / "execution-plan-first-page-spacing-fixed.png"
OUTPUT = Path("output/pdf/orbit-crm-openclaw-execution-plan.pdf")

# The quote border starts at y=319 in the 130 DPI render and touches the
# preceding source line. Shift the complete lower page section down by 14 px.
image = Image.open(FIRST_SOURCE).convert("RGB")
split_y = 319
offset_y = 14
fixed = Image.new("RGB", image.size, "white")
fixed.paste(image.crop((0, 0, image.width, split_y)), (0, 0))
fixed.paste(image.crop((0, split_y, image.width, image.height - offset_y)), (0, split_y + offset_y))
fixed.save(CORRECTED_FIRST, quality=95)

pages = [CORRECTED_FIRST] + [OTHER_SOURCE / f"page-{number}.png" for number in range(2, 8)]
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

canvas = Canvas(
    str(OUTPUT),
    pagesize=A4,
    pageCompression=1,
)
canvas.setTitle("Orbit CRM + OpenClaw - рабочий план устранения замечаний аудита")
canvas.setAuthor("Codex")
width, height = A4
for page in pages:
    canvas.drawImage(str(page), 0, 0, width=width, height=height, preserveAspectRatio=False, mask="auto")
    canvas.showPage()
canvas.save()
print(OUTPUT)
