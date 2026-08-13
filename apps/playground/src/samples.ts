import docxUrl from "./assets/samples/document.docx?url";
import pdfUrl from "./assets/samples/document.pdf?url";
import pptxUrl from "./assets/samples/presentation.pptx?url";
import xlsxUrl from "./assets/samples/workbook.xlsx?url";

export interface PlaygroundSample {
  readonly description: string;
  readonly format: string;
  readonly load: () => Promise<File>;
  readonly name: string;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

async function fixtureFile(name: string, format: string, url: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the ${name} sample.`);
  return new File([await response.blob()], name, { type: MIME_TYPES[format] });
}

function textFile(name: string, type: string, content: string): Promise<File> {
  return Promise.resolve(new File([content], name, { type }));
}

const SAMPLE_RTF = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Times New Roman;}}
\pard\sa200 AnyDoc reads the {\b formatting}, the {\i emphasis}, and the {\b\i structure} of a document, then writes the Markdown that says the same thing.\par
\pard\sa200 This paragraph came from a tiny RTF file assembled right on this page. Drop one of your own to see a real conversion.\par
}`;

const SAMPLE_CSV = `format,kind,capability
docx,WordprocessingML,parse + preview
pptx,PresentationML,parse + preview
xlsx,SpreadsheetML,parse + preview
rtf,Rich Text Format,parse
epub,EPUB 2 and 3,parse
pdf,via pdf-inspector,parse + preview
`;

export const playgroundSamples: readonly PlaygroundSample[] = [
  { description: "Word document with structured text", format: "docx", load: () => fixtureFile("document.docx", "docx", docxUrl), name: "DOCX" },
  { description: "Virtualized workbook preview", format: "xlsx", load: () => fixtureFile("workbook.xlsx", "xlsx", xlsxUrl), name: "XLSX" },
  { description: "Ten-slide deck with a scrollable thumbnail rail", format: "pptx", load: () => fixtureFile("presentation.pptx", "pptx", pptxUrl), name: "PPTX" },
  { description: "Selectable text and canvas pages", format: "pdf", load: () => fixtureFile("document.pdf", "pdf", pdfUrl), name: "PDF" },
  { description: "Parser and spreadsheet viewer", format: "csv", load: () => textFile("report.csv", "text/csv", SAMPLE_CSV), name: "CSV" },
  { description: "Semantic parsing without native preview", format: "rtf", load: () => textFile("notes.rtf", "application/rtf", SAMPLE_RTF), name: "RTF" },
];
