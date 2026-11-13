"""Minimal, dependency-free .xlsx reader/writer (stdlib only).

The plugin must run on the tool's own virtualenv which has no openpyxl /
xlsxwriter, so batch mode reads and writes spreadsheets with zipfile +
xml.etree instead.  Only what the batch workflow needs is supported:

* read: first worksheet, shared strings, inline strings, numbers, booleans.
* write: one or more sheets, inline strings, numbers, bold header row,
  frozen header, column widths and an auto-filter.
"""

from __future__ import annotations

import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL_DOC = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_REL_PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types"

_REL_FOR = NS_REL_DOC
_COL_RE = re.compile(r"^([A-Z]+)(\d+)$")


def _tag(name: str) -> str:
    return "{%s}%s" % (NS_MAIN, name)


def _text_of(node) -> str:
    if node is None:
        return ""
    parts = []
    for child in node.iter():
        if child.tag == _tag("t"):
            parts.append(child.text or "")
    return "".join(parts)


def _column_index(reference: str) -> int:
    match = _COL_RE.match(reference or "")
    if not match:
        return 0
    letters = match.group(1)
    index = 0
    for char in letters:
        index = index * 26 + (ord(char) - 64)
    return index - 1


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        raw = archive.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ElementTree.fromstring(raw)
    values = []
    for node in root.findall(_tag("si")):
        values.append(_text_of(node))
    return values


def _sheet_path(archive: zipfile.ZipFile) -> str:
    """Resolve the first worksheet's part name (fallback to sheet1.xml)."""
    try:
        workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    except KeyError:
        return "xl/worksheets/sheet1.xml"
    sheets = workbook.find(_tag("sheets"))
    target_id = None
    if sheets is not None:
        for sheet in sheets.findall(_tag("sheet")):
            target_id = sheet.get("{%s}id" % NS_REL_DOC)
            break
    if target_id:
        try:
            rels = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            for rel in rels.findall("{%s}Relationship" % NS_REL_PKG):
                if rel.get("Id") == target_id:
                    target = rel.get("Target") or ""
                    if target.startswith("/"):
                        return target.lstrip("/")
                    return "xl/" + target.lstrip("./")
        except KeyError:
            pass
    return "xl/worksheets/sheet1.xml"


def read_rows(path: str | Path) -> list[list]:
    """Return the first worksheet as a list of rows (ragged rows are padded)."""
    rows: list[list] = []
    with zipfile.ZipFile(str(path)) as archive:
        shared = _shared_strings(archive)
        sheet = ElementTree.fromstring(archive.read(_sheet_path(archive)))
        data = sheet.find(_tag("sheetData"))
        if data is None:
            return rows
        for row_node in data.findall(_tag("row")):
            cells: dict[int, object] = {}
            for cell in row_node.findall(_tag("c")):
                index = _column_index(cell.get("r") or "")
                kind = cell.get("t")
                if kind == "inlineStr":
                    value = _text_of(cell.find(_tag("is")))
                elif kind == "s":
                    raw = cell.find(_tag("v"))
                    try:
                        value = shared[int((raw.text or "0").strip())]
                    except (AttributeError, ValueError, IndexError):
                        value = ""
                elif kind == "b":
                    raw = cell.find(_tag("v"))
                    value = (raw is not None and (raw.text or "").strip() == "1")
                elif kind == "str":
                    value = _text_of(cell.find(_tag("v")))
                else:
                    raw = cell.find(_tag("v"))
                    text = (raw.text or "").strip() if raw is not None else ""
                    if text == "":
                        value = None
                    else:
                        try:
                            number = float(text)
                            value = int(number) if number.is_integer() and abs(number) < 1e15 else number
                        except ValueError:
                            value = text
                cells[index] = value
            width = (max(cells) + 1) if cells else 0
            rows.append([cells.get(position) for position in range(width)])
    return rows


def _escape(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _column_name(index: int) -> str:
    name = ""
    position = index + 1
    while position > 0:
        position, remainder = divmod(position - 1, 26)
        name = chr(65 + remainder) + name
    return name


def _cell_xml(row_index: int, column_index: int, value, style: int) -> str:
    reference = "%s%d" % (_column_name(column_index), row_index + 1)
    if value is None or value == "":
        return ""
    if isinstance(value, bool):
        return '<c r="%s" s="%d" t="b"><v>%d</v></c>' % (reference, style, 1 if value else 0)
    if isinstance(value, (int, float)):
        if value != value or value in (float("inf"), float("-inf")):
            return ""
        text = repr(float(value))
        if text.endswith(".0"):
            text = text[:-2]
        return '<c r="%s" s="%d"><v>%s</v></c>' % (reference, style, text)
    text = _escape(str(value))[:32000]
    return '<c r="%s" s="%d" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (
        reference,
        style,
        text,
    )


def _display_width(value) -> int:
    if value is None:
        return 0
    width = 0
    for char in str(value):
        width += 2 if ord(char) > 0x2E80 else 1
    return width


def _style_part() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="%s">'
        '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0000"/></numFmts>'
        '<fonts count="2">'
        '<font><sz val="11"/><color rgb="FF222222"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><color rgb="FF111111"/><name val="Calibri"/></font>'
        "</fonts>"
        '<fills count="3">'
        '<fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F4F7"/><bgColor indexed="64"/></patternFill></fill>'
        "</fills>"
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="2">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
        "</cellXfs>"
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        "</styleSheet>"
    ) % NS_MAIN


def _sheet_xml(headers, rows, widths) -> str:
    columns = max(len(headers), *(len(row) for row in rows)) if rows else len(headers)
    grid: list[str] = []
    header_cells = "".join(
        _cell_xml(0, index, headers[index] if index < len(headers) else None, 1)
        for index in range(columns)
    )
    grid.append('<row r="1" ht="20" customHeight="1">%s</row>' % header_cells)
    for offset, row in enumerate(rows):
        cells = "".join(
            _cell_xml(offset + 1, index, row[index] if index < len(row) else None, 0)
            for index in range(columns)
        )
        if cells:
            grid.append('<row r="%d">%s</row>' % (offset + 2, cells))
    cols = "".join(
        '<col min="%d" max="%d" width="%d" customWidth="1"/>' % (index + 1, index + 1, max(9, min(48, width)))
        for index, width in enumerate(widths)
    )
    last_column = _column_name(max(0, columns - 1))
    last_row = len(rows) + 1
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="%s" xmlns:r="%s">'
        '<sheetViews><sheetView workbookViewId="0">'
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
        "</sheetView></sheetViews>"
        "<cols>%s</cols>"
        "<sheetData>%s</sheetData>"
        '<autoFilter ref="A1:%s%d"/>'
        "</worksheet>"
    ) % (NS_MAIN, NS_REL_DOC, cols, "".join(grid), last_column, last_row)


def write_sheet(
    path: str | Path,
    headers: list,
    rows: list[list],
    *,
    sheet_name: str = "结果",
    widths: list[int] | None = None,
) -> str:
    """Write a single-sheet workbook; returns the absolute path."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    if widths is None:
        widths = []
        for index, header in enumerate(headers):
            widest = _display_width(header)
            for row in rows:
                if index < len(row):
                    widest = max(widest, _display_width(row[index]))
            widths.append(widest + 2)
    sheet = _sheet_xml(headers, rows, widths)
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="%s">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        "</Types>"
    ) % NS_CT
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="%s">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    ) % NS_REL_PKG
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="%s" xmlns:r="%s">'
        '<sheets><sheet name="%s" sheetId="1" r:id="rId1"/></sheets>'
        "</workbook>"
    ) % (NS_MAIN, NS_REL_DOC, _escape(sheet_name[:31] or "结果"))
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="%s">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        "</Relationships>"
    ) % NS_REL_PKG
    with zipfile.ZipFile(str(target), "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/styles.xml", _style_part())
        archive.writestr("xl/worksheets/sheet1.xml", sheet)
    return str(target)
