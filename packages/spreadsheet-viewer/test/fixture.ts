import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

export async function generatedWorkbookFixture(): Promise<ArrayBuffer> {
  const writer = new ZipWriter(
    new BlobWriter("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  );
  const add = async (name: string, value: string) => await writer.add(name, new TextReader(value));
  await add(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  );
  await add(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  await add(
    "xl/workbook.xml",
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  await add(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  await add(
    "xl/worksheets/sheet1.xml",
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B3"/><sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultColWidth="8.43" defaultRowHeight="15"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Revenue</t></is></c><c r="B1" t="inlineStr"><is><t>Amount</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Tickets</t></is></c><c r="B2"><v>1200</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Fees</t></is></c><c r="B3"><f>B2*0.1</f><v>120</v></c></row></sheetData></worksheet>',
  );
  // These deliberately malformed preserved parts prove that non-grid objects cannot crash opening.
  await add("xl/charts/chart1.xml", "<chart><malformed-but-preserved/></chart>");
  await add("xl/drawings/drawing1.xml", "<drawing><anchor without='coordinates'/></drawing>");
  const blob = await writer.close();
  return await blob.arrayBuffer();
}
