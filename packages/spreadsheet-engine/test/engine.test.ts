import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import {
  OoxmlArchive,
  SpreadsheetEngine,
  SpreadsheetReadSession,
  cellKey,
  verifySpreadsheetBytes,
} from "../src/index.ts";

const OPAQUE = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);

function prefixSpreadsheetElements(xml: string): string {
  return xml
    .replace(/<(\/?)(?![?!])((?![\w.-]+:)[A-Za-z_][\w.-]*)/gu, "<$1x:$2")
    .replace(
      'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
      'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
    );
}

async function fixture(
  options: { chartXml?: string; prefixedSpreadsheetElements?: boolean } = {},
): Promise<Uint8Array> {
  const writer = new ZipWriter(
    new BlobWriter("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  );
  const addText = (name: string, value: string) =>
    writer.add(
      name,
      new TextReader(
        options.prefixedSpreadsheetElements &&
          (name === "xl/workbook.xml" ||
            name === "xl/sharedStrings.xml" ||
            name === "xl/styles.xml" ||
            name.startsWith("xl/worksheets/")) &&
          !name.endsWith(".rels")
          ? prefixSpreadsheetElements(value)
          : value,
      ),
    );
  await addText(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
  );
  await addText(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  await addText(
    "xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><definedNames><definedName name="Total">Summary!$B$2</definedName></definedNames><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="1"/></workbook>',
  );
  await addText(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
  );
  await addText(
    "xl/sharedStrings.xml",
    '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t>Revenue</t></si></sst>',
  );
  await addText(
    "xl/styles.xml",
    '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>',
  );
  await addText(
    "xl/worksheets/sheet1.xml",
    '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:B3"/><sheetViews><sheetView workbookViewId="0" showGridLines="1"><pane xSplit="1" ySplit="1" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultColWidth="8.43" defaultRowHeight="15"/><cols><col min="1" max="1" width="14" customWidth="1"/><col min="3" max="100" width="11" customWidth="1"/></cols><sheetData><row r="1" ht="20" customHeight="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Amount</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Tickets</t></is></c><c r="B2"><v>1200</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Fees</t></is></c><c r="B3"><f>B2*0.1</f><v>120</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells><hyperlinks><hyperlink ref="A2" location="Summary!B2"/><hyperlink ref="B2" r:id="rIdHyper" tooltip="Open report"/></hyperlinks><drawing r:id="rIdDrawing"/><drawing r:id="rIdMalformedDrawing"/><extLst><ext uri="anydoc-test"><opaque value="preserve-me"/></ext></extLst></worksheet>',
  );
  await addText(
    "xl/worksheets/_rels/sheet1.xml.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdHyper" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/report" TargetMode="External"/><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="rIdMalformedDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing2.xml"/></Relationships>',
  );
  await writer.add("xl/custom/opaque.bin", new Uint8ArrayReader(OPAQUE));
  await addText("xl/charts/chart1.xml", options.chartXml ?? "<chartSpace/>");
  await addText("xl/charts/chartStyle1.xml", "<chartStyle/>");
  await addText("xl/charts/_rels/chart1.xml.rels", "<Relationships/>");
  await addText(
    "xl/drawings/drawing1.xml",
    '<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:twoCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:colOff>100</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>200</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>300</xdr:colOff><xdr:row>18</xdr:row><xdr:rowOff>400</xdr:rowOff></xdr:to><xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Revenue Chart"/></xdr:nvGraphicFramePr><a:graphic><a:graphicData><c:chart r:id="rIdChart"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="914400" cy="457200"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="3" name="Logo"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdImage"/></xdr:blipFill></xdr:pic><xdr:clientData/></xdr:oneCellAnchor><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>20</xdr:row></xdr:from><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="4" name="Malformed Shape"/></xdr:nvSpPr></xdr:sp><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>',
  );
  await addText(
    "xl/drawings/_rels/drawing1.xml.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>',
  );
  await addText("xl/drawings/drawing2.xml", "<xdr:wsDr><broken></xdr:wsDr>");
  await writer.add("xl/media/image1.png", new Uint8ArrayReader(new Uint8Array([137, 80, 78, 71])));
  const blob = await writer.close();
  return new Uint8Array(await blob.arrayBuffer());
}

describe("SpreadsheetEngine", () => {
  it("opens charts whose category formula is an ordered union of worksheet areas", async () => {
    const session = await SpreadsheetReadSession.open(
      await fixture({
        chartXml:
          '<?xml version="1.0" encoding="UTF-8"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Amount</c:v></c:tx><c:cat><c:strRef><c:f>(\'Summary\'!$A$2:$A$2,\'Summary\'!$A$3:$A$3)</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>stale-a</c:v></c:pt><c:pt idx="1"><c:v>stale-b</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>\'Summary\'!$B$2:$B$3</c:f><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart></c:plotArea></c:chart></c:chartSpace>',
      }),
    );

    expect(session.readCharts("1")).toEqual([
      expect.objectContaining({
        categories: ["Tickets", "Fees"],
        series: [expect.objectContaining({ name: "Amount", values: [1200, 120] })],
      }),
    ]);
  });

  it("preserves each chart group and series type in a combination chart", async () => {
    const session = await SpreadsheetReadSession.open(
      await fixture({
        chartXml:
          '<?xml version="1.0" encoding="UTF-8"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Columns</c:v></c:tx><c:cat><c:strRef><c:f>Summary!$A$2:$A$3</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>Summary!$B$2:$B$3</c:f></c:numRef></c:val></c:ser></c:barChart><c:lineChart><c:ser><c:idx val="1"/><c:order val="1"/><c:tx><c:v>Line</c:v></c:tx><c:cat><c:strRef><c:f>Summary!$A$2:$A$3</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>Summary!$B$2:$B$3</c:f></c:numRef></c:val></c:ser></c:lineChart></c:plotArea></c:chart></c:chartSpace>',
      }),
    );

    expect(session.readCharts("1")[0]?.series).toEqual([
      expect.objectContaining({
        name: "Columns",
        type: "column",
        values: [1200, 120],
      }),
      expect.objectContaining({
        name: "Line",
        type: "line",
        values: [1200, 120],
      }),
    ]);
  });

  it("uses authored chart caches and reports unsupported reference expressions", async () => {
    const session = await SpreadsheetReadSession.open(
      await fixture({
        chartXml:
          '<?xml version="1.0" encoding="UTF-8"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:lineChart><c:ser><c:idx val="0"/><c:order val="0"/><c:cat><c:strRef><c:f>NamedCategories</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Cached A</c:v></c:pt><c:pt idx="1"><c:v>Cached B</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>NamedValues</c:f><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:lineChart></c:plotArea></c:chart></c:chartSpace>',
      }),
    );

    expect(session.readCharts("1")[0]).toMatchObject({
      categories: ["Cached A", "Cached B"],
      series: [{ values: [10, 20] }],
    });
    expect(session.metadata.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "xlsx.chart.reference.unsupported",
        part: "xl/charts/chart1.xml",
        severity: "warning",
      }),
    );
  });

  it("keeps the worksheet readable when one chart cannot be projected", async () => {
    const session = await SpreadsheetReadSession.open(
      await fixture({
        chartXml: '<c:chartSpace xmlns:c="chart"><c:broken></c:chartSpace>',
      }),
    );

    expect(session.readRange("1", { bottom: 3, left: 1, right: 2, top: 1 }).cells).toHaveLength(6);
    expect(session.readCharts("1")).toEqual([]);
    expect(session.metadata.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "xlsx.chart.unavailable",
        part: "xl/charts/chart1.xml",
        severity: "warning",
      }),
    );
  });

  it("rejects a workbook before projecting more than the configured cell budget", async () => {
    await expect(SpreadsheetEngine.open(await fixture(), { maxCells: 3 })).rejects.toThrow(
      /cell limit/iu,
    );
  });

  it("opens and mutates namespace-prefixed spreadsheet parts", async () => {
    const workbook = await SpreadsheetEngine.open(
      await fixture({ prefixedSpreadsheetElements: true }),
    );
    expect(workbook.model.sheets[0]?.name).toBe("Summary");
    workbook.apply({
      cells: [["Updated"]],
      column: 1,
      kind: "write-range",
      row: 2,
      sheetId: "1",
    });
    const reopened = await SpreadsheetEngine.open(await workbook.export());
    expect(reopened.model.sheets[0]?.cells.get("2:1")?.value).toBe("Updated");
  });

  it("opens a bounded workbook into a shared sparse model", async () => {
    const workbook = await SpreadsheetEngine.open(await fixture());
    const sheet = workbook.model.sheets[0];
    expect(sheet.name).toBe("Summary");
    expect(sheet.frozenColumns).toBe(1);
    expect(sheet.frozenRows).toBe(1);
    expect(sheet.columns.sizes.get(1)).toBe(14);
    expect(sheet.rows.sizes.get(1)).toBe(20);
    expect(sheet.merges).toEqual([{ bottom: 1, left: 1, right: 2, top: 1 }]);
    expect(sheet.cells.get(cellKey(1, 1))?.value).toBe("Revenue");
    expect(sheet.cells.get(cellKey(3, 2))).toMatchObject({
      formula: "B2*0.1",
      formulaResult: 120,
    });
    expect(workbook.model.features).toContainEqual({
      count: 1,
      editableCount: 0,
      id: "defined-names",
      renderableCount: 0,
      roundTripPreserved: true,
    });
    expect(workbook.model.features).toContainEqual({
      count: 1,
      editableCount: 0,
      id: "charts",
      renderableCount: 0,
      roundTripPreserved: true,
    });
    expect(workbook.model.features).toContainEqual({
      count: 2,
      editableCount: 0,
      id: "drawings",
      renderableCount: 0,
      roundTripPreserved: true,
    });
    expect(workbook.model.features).toContainEqual({
      count: 1,
      editableCount: 0,
      id: "images",
      renderableCount: 0,
      roundTripPreserved: true,
    });
    expect(workbook.model.features).toContainEqual({
      count: 2,
      editableCount: 0,
      id: "hyperlinks",
      renderableCount: 2,
      roundTripPreserved: true,
    });
    expect(sheet.cells.get(cellKey(2, 1))?.hyperlink).toEqual({
      kind: "internal",
      target: "Summary!B2",
    });
    expect(sheet.cells.get(cellKey(2, 2))?.hyperlink).toEqual({
      kind: "external",
      target: "https://example.com/report",
      tooltip: "Open report",
    });
    expect(workbook.model.objects.find((object) => object.kind === "chart")).toMatchObject({
      anchor: {
        from: { column: 3, columnOffsetEmu: 100, row: 5, rowOffsetEmu: 200 },
        kind: "two-cell",
        to: { column: 9, columnOffsetEmu: 300, row: 19, rowOffsetEmu: 400 },
      },
      id: "1:xl/drawings/drawing1.xml:2",
      kind: "chart",
      name: "Revenue Chart",
      relationshipTarget: "xl/charts/chart1.xml",
      sheetId: "1",
    });
    expect(workbook.model.objects.find((object) => object.kind === "image")).toMatchObject({
      anchor: {
        from: { column: 1, columnOffsetEmu: 0, row: 6, rowOffsetEmu: 0 },
        kind: "one-cell",
        size: { heightEmu: 457200, widthEmu: 914400 },
      },
      relationshipTarget: "xl/media/image1.png",
    });
    expect(
      workbook.model.diagnostics.some((diagnostic) => diagnostic.code === "xlsx.drawing.anchor"),
    ).toBe(true);
    expect(
      workbook.model.diagnostics.some((diagnostic) => diagnostic.code === "xlsx.drawing.malformed"),
    ).toBe(true);
  });

  it("applies typed edits, preserves opaque parts, exports, and reopens", async () => {
    const workbook = await SpreadsheetEngine.open(await fixture());
    workbook.applyAll([
      {
        cells: [["Profit", { formula: "=B2-B3", formulaResult: 1080 }]],
        column: 1,
        kind: "write-range",
        row: 4,
        sheetId: "1",
      },
      {
        kind: "format-range",
        range: { bottom: 4, left: 1, right: 2, top: 4 },
        sheetId: "1",
        style: { background: "#DCE6F1", bold: true, borderBottom: "#1F4E78" },
      },
      {
        axis: "columns",
        end: 2,
        kind: "resize",
        sheetId: "1",
        size: 18,
        start: 2,
      },
      {
        kind: "merge",
        range: { bottom: 5, left: 1, right: 2, top: 5 },
        sheetId: "1",
      },
    ]);
    const bytes = await workbook.export();
    const archive = await OoxmlArchive.open(bytes);
    expect(archive.part("xl/custom/opaque.bin")).toEqual(OPAQUE);
    expect(archive.text("xl/worksheets/sheet1.xml")).toContain("preserve-me");
    expect(archive.text("xl/worksheets/sheet1.xml")).toContain(
      '<col min="3" max="100" width="11" customWidth="1"/>',
    );
    expect(archive.text("xl/workbook.xml")).toContain('fullCalcOnLoad="1"');
    const reopened = await SpreadsheetEngine.open(bytes);
    expect(reopened.model.sheets[0].cells.get(cellKey(4, 2))).toMatchObject({
      formula: "B2-B3",
      formulaResult: 1080,
    });
    expect(reopened.model.sheets[0].cells.get(cellKey(4, 1))?.style).toMatchObject({
      background: "#DCE6F1",
      bold: true,
      borderBottom: "#1F4E78",
    });
    expect(reopened.model.sheets[0].columns.sizes.get(2)).toBe(18);
    expect(reopened.model.sheets[0].merges).toContainEqual({
      bottom: 5,
      left: 1,
      right: 2,
      top: 5,
    });
    expect(await workbook.verify()).toMatchObject({
      byteSize: bytes.byteLength,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      sheetCount: 1,
      valid: true,
    });
  });

  it("round-trips worksheet lifecycle and native workbook features", async () => {
    const workbook = await SpreadsheetEngine.open(await fixture());
    workbook.applyAll([
      { kind: "create-sheet", name: "Dashboard", position: 0 },
      { kind: "rename-sheet", name: "Source Data", sheetId: "1" },
      { hidden: true, kind: "set-sheet-visibility", sheetId: "1" },
      { kind: "move-sheet", position: 1, sheetId: "1" },
      {
        cells: [["Status"], ["Open"], ["Open"]],
        column: 3,
        kind: "write-range",
        row: 1,
        sheetId: "1",
      },
      {
        anchor: {
          from: { column: 4, columnOffsetEmu: 0, row: 2, rowOffsetEmu: 0 },
          kind: "two-cell",
          to: { column: 10, columnOffsetEmu: 0, row: 18, rowOffsetEmu: 0 },
        },
        chart: {
          legend: "bottom",
          series: [
            {
              categories: {
                range: { bottom: 3, left: 1, right: 1, top: 2 },
                sheetId: "1",
              },
              name: "Amount",
              values: {
                range: { bottom: 3, left: 2, right: 2, top: 2 },
                sheetId: "1",
              },
            },
          ],
          title: "Executive summary",
          type: "column",
        },
        kind: "create-chart",
        sheetId: "Dashboard",
      },
      {
        kind: "add-conditional-format",
        rule: {
          kind: "duplicate-values",
          range: { bottom: 3, left: 3, right: 3, top: 2 },
          style: { background: "#FFC7CE", color: "#9C0006" },
        },
        sheetId: "1",
      },
      {
        kind: "add-data-validation",
        rule: {
          allowBlank: true,
          range: { bottom: 20, left: 3, right: 3, top: 2 },
          source: { kind: "values", values: ["Open", "Closed"] },
        },
        sheetId: "1",
      },
      {
        kind: "create-table",
        name: "RevenueTable",
        range: { bottom: 3, left: 1, right: 2, top: 1 },
        sheetId: "1",
      },
      {
        kind: "create-pivot-table",
        name: "RevenuePivot",
        rowFields: ["Revenue"],
        sourceRange: { bottom: 3, left: 1, right: 2, top: 1 },
        sourceSheetId: "1",
        targetRange: { bottom: 1, left: 1, right: 1, top: 1 },
        targetSheetId: "Dashboard",
        values: [{ field: "Amount", summarizeBy: "sum" }],
      },
    ]);

    const bytes = await workbook.export();
    const archive = await OoxmlArchive.open(bytes);
    expect(archive.names()).toEqual(
      expect.arrayContaining([
        "xl/charts/chart2.xml",
        "xl/pivotCache/pivotCacheDefinition1.xml",
        "xl/pivotCache/pivotCacheRecords1.xml",
        "xl/pivotTables/pivotTable1.xml",
        "xl/tables/table1.xml",
        "xl/worksheets/sheet2.xml",
      ]),
    );
    expect(archive.text("xl/worksheets/sheet1.xml")).toContain("conditionalFormatting");
    expect(archive.text("xl/worksheets/sheet1.xml")).toContain("dataValidations");
    expect(archive.text("xl/worksheets/sheet1.xml")).toContain("tableParts");
    expect(archive.text("xl/worksheets/sheet2.xml")).toContain("pivotTableParts");
    expect(archive.text("xl/workbook.xml")).toContain("pivotCaches");
    expect(archive.text("xl/charts/chart2.xml")).toContain("Executive summary");
    expect(workbook.renderCharts("Dashboard")).toEqual([
      expect.objectContaining({
        categories: ["Tickets", "Fees"],
        series: [expect.objectContaining({ values: [1200, 120] })],
        type: "column",
      }),
    ]);
    expect(workbook.model.features).toEqual(
      expect.arrayContaining([
        {
          count: 2,
          editableCount: 1,
          id: "charts",
          renderableCount: 1,
          roundTripPreserved: true,
        },
        {
          count: 1,
          editableCount: 1,
          id: "conditional-formatting",
          renderableCount: 1,
          roundTripPreserved: true,
        },
        {
          count: 1,
          editableCount: 1,
          id: "data-validation",
          renderableCount: 1,
          roundTripPreserved: true,
        },
        {
          count: 1,
          editableCount: 1,
          id: "pivot-tables",
          renderableCount: 1,
          roundTripPreserved: true,
        },
        {
          count: 1,
          editableCount: 1,
          id: "tables",
          renderableCount: 1,
          roundTripPreserved: true,
        },
      ]),
    );

    const reopened = await SpreadsheetEngine.open(bytes);
    expect(reopened.model.sheets.map(({ name }) => name)).toEqual(["Dashboard", "Source Data"]);
    expect(reopened.model.sheets[1].hidden).toBe(true);
    expect(reopened.model.sheets[1].conditionalFormats).toHaveLength(1);
    expect(reopened.model.sheets[1].dataValidations).toHaveLength(1);
    expect(reopened.model.sheets[1].tables).toEqual([
      expect.objectContaining({ name: "RevenueTable" }),
    ]);
    expect(reopened.model.sheets[0].pivotTables).toEqual([
      expect.objectContaining({ name: "RevenuePivot", rowFields: ["Revenue"] }),
    ]);
    expect(reopened.renderCharts("Dashboard")[0]).toMatchObject({
      title: "Executive summary",
    });
    const session = await SpreadsheetReadSession.open(bytes);
    expect(
      session.readRange("1", { bottom: 3, left: 3, right: 3, top: 2 }).cells[0]?.style,
    ).toMatchObject({ background: "#FFC7CE", color: "#9C0006" });
    expect(session.metadata.sheets[1].dataValidations).toHaveLength(1);
    expect(await workbook.verify()).toMatchObject({
      sheetCount: 2,
      valid: true,
    });
  });

  it("deletes worksheet package parts instead of leaving orphaned ZIP entries", async () => {
    const workbook = await SpreadsheetEngine.open(await fixture());
    workbook.apply({ kind: "create-sheet", name: "Temporary" });
    const temporaryPart = workbook.model.sheets.find(({ name }) => name === "Temporary")!;
    workbook.applyAll([
      {
        cells: [
          ["Label", "Value"],
          ["A", 1],
        ],
        column: 1,
        kind: "write-range",
        row: 1,
        sheetId: temporaryPart.id,
      },
      {
        anchor: {
          from: { column: 4, columnOffsetEmu: 0, row: 2, rowOffsetEmu: 0 },
          kind: "two-cell",
          to: { column: 8, columnOffsetEmu: 0, row: 12, rowOffsetEmu: 0 },
        },
        chart: {
          legend: "none",
          series: [
            {
              categories: { range: { bottom: 2, left: 1, right: 1, top: 2 } },
              values: { range: { bottom: 2, left: 2, right: 2, top: 2 } },
            },
          ],
          type: "column",
        },
        kind: "create-chart",
        sheetId: temporaryPart.id,
      },
      {
        kind: "create-table",
        name: "TemporaryTable",
        range: { bottom: 2, left: 1, right: 2, top: 1 },
        sheetId: temporaryPart.id,
      },
    ]);
    workbook.apply({ kind: "delete-sheet", sheetId: temporaryPart.id });
    const archive = await OoxmlArchive.open(await workbook.export());
    expect(archive.has("xl/worksheets/sheet2.xml")).toBe(false);
    expect(archive.has("xl/charts/chart2.xml")).toBe(false);
    expect(archive.has("xl/drawings/drawing3.xml")).toBe(false);
    expect(archive.has("xl/tables/table1.xml")).toBe(false);
    expect(archive.text("xl/workbook.xml")).not.toContain("Temporary");
  });

  it("renders deterministic SVG from the same model used for export", async () => {
    const workbook = await SpreadsheetEngine.open(await fixture());
    const svg = workbook.renderRange("Summary", {
      bottom: 3,
      left: 1,
      right: 2,
      top: 1,
    });
    expect(svg).toMatch(/^<svg /u);
    expect(svg).toContain("Revenue");
    expect(svg).toContain("120");
    expect(svg).toContain('aria-label="Summary"');
    expect(workbook.renderRange("Summary", { bottom: 3, left: 1, right: 2, top: 1 })).toBe(svg);
  });

  it("rejects newly populated cells hidden beneath an existing two-cell object anchor", async () => {
    const workbook = await SpreadsheetEngine.open(await fixture());
    workbook.apply({
      cells: [["Hidden summary"]],
      column: 3,
      kind: "write-range",
      row: 5,
      sheetId: "1",
    });

    const verification = await workbook.verify();
    expect(verification.valid).toBe(false);
    expect(verification.diagnostics).toContainEqual(
      expect.objectContaining({
        address: "C5",
        code: "xlsx.layout.new_content_under_object",
        severity: "error",
      }),
    );
  });

  it("recalculates formula dependencies and writes cached results", async () => {
    const workbook = await SpreadsheetEngine.open(await fixture());
    workbook.applyAll([
      { cells: [[2000]], column: 2, kind: "write-range", row: 2, sheetId: "1" },
      {
        cells: [[{ formula: "SUM(B2:B3)" }]],
        column: 2,
        kind: "write-range",
        row: 4,
        sheetId: "1",
      },
    ]);
    const recalculation = await workbook.recalculate();
    expect(recalculation).toMatchObject({
      diagnostics: [],
      engineId: "anydoc-basic-v1",
      evaluatedCells: 2,
    });
    expect(workbook.model.sheets[0].cells.get(cellKey(3, 2))?.formulaResult).toBe(200);
    expect(workbook.model.sheets[0].cells.get(cellKey(4, 2))?.formulaResult).toBe(2200);
    const reopened = await SpreadsheetEngine.open(await workbook.export());
    expect(reopened.model.sheets[0].cells.get(cellKey(4, 2))?.formulaResult).toBe(2200);
  });

  it("rejects unsafe or invalid packages with stable verification diagnostics", async () => {
    const verification = await verifySpreadsheetBytes(new Uint8Array([1, 2, 3]));
    expect(verification.valid).toBe(false);
    expect(verification.diagnostics[0].code).toBe("xlsx.open");
    await expect(SpreadsheetEngine.open(await fixture(), { maxEntries: 2 })).rejects.toThrow(
      "too many ZIP entries",
    );
  });

  it("inspects bounded ranges without materializing empty cells", async () => {
    const workbook = await SpreadsheetEngine.open(await fixture());
    const inspection = workbook.inspect("1", {
      bottom: 3,
      left: 2,
      right: 2,
      top: 2,
    });
    expect(inspection.cells.map((cell) => cell.address)).toEqual(["B2", "B3"]);
    expect(() => workbook.inspect("1", { bottom: 1000, left: 1, right: 1000, top: 1 })).toThrow(
      "too large",
    );
  });

  it("exposes bounded, read-only viewer projections", async () => {
    const session = await SpreadsheetReadSession.open(await fixture());
    expect(session.metadata.sheets[0]).not.toHaveProperty("cells");
    expect(session.readRange("1", { bottom: 3, left: 2, right: 2, top: 2 }).cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: "B2", value: 1200 }),
        expect.objectContaining({ address: "B3", formulaResult: 120 }),
      ]),
    );
    expect(session.search("fees")).toMatchObject({
      matches: [expect.objectContaining({ address: "A3", sheetId: "1" })],
      total: 1,
    });
    expect(
      session.selectionStatistics("1", [{ bottom: 3, left: 2, right: 2, top: 2 }]),
    ).toMatchObject({ average: 660, count: 2, numericCount: 2, sum: 1320 });
    expect(session.copy("1", [{ bottom: 3, left: 1, right: 2, top: 2 }])).toMatchObject({
      cellCount: 4,
      text: "Tickets\t1200\nFees\t120",
      truncated: false,
    });
    expect(session.suggestAxisSize("1", "column", 1)).toBeGreaterThan(40);
    expect(() => session.readRange("1", { bottom: 1000, left: 1, right: 1000, top: 1 })).toThrow(
      "limited",
    );
  });

  it("preserves but does not surface unsafe external hyperlinks", async () => {
    const archive = await OoxmlArchive.open(await fixture());
    const sheetXml = archive
      .text("xl/worksheets/sheet1.xml")
      .replace("</hyperlinks>", '<hyperlink ref="A3" r:id="rIdUnsafe"/></hyperlinks>');
    const relationshipsXml = archive
      .text("xl/worksheets/_rels/sheet1.xml.rels")
      .replace(
        "</Relationships>",
        '<Relationship Id="rIdUnsafe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="file:///private/data" TargetMode="External"/></Relationships>',
      );
    const bytes = await archive.export(
      new Map([
        ["xl/worksheets/sheet1.xml", new TextEncoder().encode(sheetXml)],
        ["xl/worksheets/_rels/sheet1.xml.rels", new TextEncoder().encode(relationshipsXml)],
      ]),
    );
    const workbook = await SpreadsheetEngine.open(bytes);
    expect(workbook.model.sheets[0].cells.get(cellKey(3, 1))?.hyperlink).toBeUndefined();
    expect(workbook.model.features).toContainEqual({
      count: 3,
      editableCount: 0,
      id: "hyperlinks",
      renderableCount: 2,
      roundTripPreserved: true,
    });
    expect(
      workbook.model.diagnostics.some((diagnostic) => diagnostic.code === "xlsx.hyperlink.unsafe"),
    ).toBe(true);
  });
});
