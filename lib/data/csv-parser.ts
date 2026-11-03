import Papa from "papaparse"
import type { UploadIssue } from "@/types"

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
  /** non-fatal parse warnings */
  warnings: string[]
}

export class CsvParseError extends Error {
  code: string
  fatalError: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.fatalError = message
    this.name = "CsvParseError"
  }
}

/**
 * Parses CSV text with PapaParse (no dynamic typing — the profiler and DuckDB
 * infer types independently). Throws CsvParseError for structurally broken
 * files so the UI can surface a precise message.
 */
export function parseCsvText(text: string): ParsedCsv {
  const parsed = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: "greedy",
    delimiter: "", // auto-detect (, ; \t |)
  })

  let rawRows = (parsed.data as string[][]) ?? []

  const everyCellEmpty =
    rawRows.length > 0 && rawRows.every((r) => r.every((c) => c === ""))

  const fatal = (parsed.errors ?? []).filter((e) => e.type === "Delimiter" || e.type === "Quotes")
  if (fatal.length > 0 && !everyCellEmpty && rawRows.length > 0) {
    const first = fatal[0]
    throw new CsvParseError(
      first.type === "Quotes" ? "malformed_quotes" : "malformed_delimiter",
      `The file is syntactically malformed CSV (row ${first.row !== undefined ? first.row + 1 : "?"}: ${first.message}). Fix the formatting and re-upload.`
    )
  }

  if (rawRows.length === 0 || everyCellEmpty) {
    throw new CsvParseError("empty", "The file contains no data rows (every cell is empty).")
  }

  // Header detection: a header row rarely contains a plain number in every col
  const firstRow = rawRows[0]
  const headerish =
    firstRow.some((c) => /[A-Za-z]/.test(c)) && !firstRow.every((c) => /^-?[\d.,e]+%?$/.test(c.trim()))

  let headers: string[]
  let rows: string[][]
  let generatedColumnNames = rawRows.length > 0 && !headerish

  if (headerish) {
    headers = firstRow.map((h, i) => (h === "" ? `column_${i + 1}` : h))
    rows = rawRows.slice(1)
    if (rows.length === 0) {
      throw new CsvParseError(
        "header_only",
        "The file only contains a header row — there is no data to analyze."
      )
    }
  } else {
    headers = firstRow.map((_, i) => `column_${i + 1}`)
    rows = rawRows
    generatedColumnNames = true
  }

  // Zap rows that are completely empty and trim every cell
  rows = rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""))

  const width = headers.length
  const ragged = rows.filter((r) => r.length !== width).length
  const warnings: string[] = []
  const warningsOut = warnings
  if (ragged > 0) {
    warningsOut.push(
      `${ragged} row${ragged > 1 ? "s" : ""} had a different number of columns than the header and were padded or truncated.`
    )
    rows = rows.map((r) => {
      if (r.length === width) return r
      const copy = r.slice(0, width)
      while (copy.length < width) copy.push("")
      return copy
    })
  }

  if (rows.length === 0) {
    throw new CsvParseError("empty", "The file contains no usable data rows after cleaning.")
  }

  return { headers, rows, warnings: warningsOut }
}

export async function parseCsvFile(file: File): Promise<ParsedCsv> {
  const text = await file.text()
  if (text.charCodeAt(0) === 0xef && text.charCodeAt(1) === 0xbb) {
    // strip BOM
    return parseCsvText(text.slice(1))
  }
  return parseCsvText(text)
}
