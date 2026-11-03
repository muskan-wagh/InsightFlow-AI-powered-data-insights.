// ── Read-only SQL validation ────────────────────────────────────────────────
// Generated SQL is executed locally by DuckDB-Wasm in the user's browser, so
// this guard is defense-in-depth — but it is applied BEFORE execution:
//   1. exactly one statement (no stacked statements)
//   2. must start with SELECT or WITH
//   3. forbidden keywords scanned with word boundaries, after stripping
//      string literals and comments (so status = 'DELETE' is not blocked)
//   4. FROM/JOIN table references validated against registered tables
//      (CTE aliases and subqueries are allowed)
//   5. normal SELECTs get wrapped with a LIMIT to cap result size
// Unknown tables that slip past the scan still fail safely: DuckDB throws,
// and the error is surfaced as a friendly message in the chat.

export interface SqlValidationResult {
  ok: boolean
  /** SQL that should be executed (wrapped with LIMIT when needed) */
  sql?: string
  error?: string
  tables?: string[]
  limited?: boolean
}

export const MAX_RESULT_ROWS = 500

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g
const LINE_COMMENT = /--[^\n]*/g
const STRING_LITERAL = /'(?:[^']|'')*'/g
const DOUBLE_QUOTED = /"(?:[^"]|"")*"/g

/** Removes comments + quoted literals so keyword scanning can't be spoofed. */
export function stripLiteralsAndComments(sql: string): string {
  return sql
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(STRING_LITERAL, " '$q' ")
    .replace(DOUBLE_QUOTED, ' "$q" ')
}

/**
 * Variant used for structural scanning (table refs / CTE aliases): removes
 * comments and single-quoted strings but PRESERVES double-quoted identifiers.
 */
export function stripForTableScan(sql: string): string {
  return sql.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, " ").replace(STRING_LITERAL, " '$q' ")
}

/** True when the SQL contains at most one top-level statement separator. */
function isSingleStatement(sql: string): boolean {
  const stripped = sql.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "")
  let inString = false
  let count = 0
  for (const ch of stripped) {
    if (ch === "'") inString = !inString
    else if (ch === ";" && !inString) {
      count++
      if (count > 1) return false
    }
  }
  return true
}

const FORBIDDEN_KEYWORDS = [
  "insert", "update", "delete", "drop", "alter", "create", "truncate", "replace", "merge",
  "copy", "attach", "detach", "call", "pragma", "set", "reset", "vacuum", "grant", "revoke",
  "checkpoint", "load", "install", "export", "begin", "commit", "rollback", "shutdown",
]

export function findForbiddenKeyword(sql: string): string | null {
  const plain = stripLiteralsAndComments(sql).toLowerCase()
  for (const kw of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${kw}\\b`).test(plain)) return kw
  }
  return null
}

/** Identifiers referenced after FROM / JOIN (bare names and quoted names). */
export function extractTableRefs(sql: string): string[] {
  const stripped = stripForTableScan(sql).replace(/\s+/g, " ")
  const refs: string[] = []
  const re = /\b(?:from|join)\s+(?![(),*])/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped))) {
    let i = m.index + m[0].length
    let name = ""
    if (stripped[i] === '"') {
      // quoted identifier with "" escaping
      const end = stripped.indexOf('"', i + 1)
      if (end !== -1) {
        name = stripped.slice(i + 1, end).replace(/""/g, '"')
        i = end + 1
      }
    } else {
      // bare identifier, allow db.schema.table dotted names
      const word = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?/.exec(stripped.slice(i))
      if (word) {
        name = word[0]
        i += word[0].length
      }
    }
    if (name) {
      // schema-qualified ("main.t") → validate the table part only
      const parts = name.toLowerCase().split(".")
      refs.push(parts[parts.length - 1])
    }
  }
  return refs
}

/** CTE alias names that may be used as table refs inside the query. */
export function extractCteAliases(sql: string): string[] {
  const stripped = stripForTableScan(sql).replace(/\s+/g, " ")
  const aliases: string[] = []
  // `WITH a AS (` — all occurrences (top or nested), plus `, b AS (` after CTE list
  const re = /(?:\bwith\s+|,\s*)([A-Za-z_][A-Za-z0-9_]*)\s+as\s*\(/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped))) {
    aliases.push(m[1].toLowerCase())
  }
  return aliases
}

function endsWithLiteralLimit(sql: string): boolean {
  const plain = stripLiteralsAndComments(sql)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/;+\s*$/, "")
  return /limit\s+("[^"]+"|[A-Za-z_][A-Za-z0-9_.]*|\d+)\s*(?:offset\s+\d+\s*)?$/i.test(plain)
}

/**
 * Validates a generated query against the set of registered table names.
 * Returns the executable SQL (with a result cap) or a human-readable error.
 */
export function validateSql(rawSql: string, registeredTables: string[]): SqlValidationResult {
  const input = rawSql.trim().replace(/`/g, '"').replace(/;+\s*$/, "")
  if (!input) return { ok: false, error: "The model returned an empty query." }

  if (!isSingleStatement(input + ";")) {
    return {
      ok: false,
      error: "Blocked: multiple SQL statements. Ask one question at a time — a single SELECT is allowed per query.",
    }
  }

  const plainHead = stripLiteralsAndComments(input).replace(/^\s+/, "")
  const headWord = (plainHead.split(/[\s(]/)[0] ?? "").toLowerCase()
  if (headWord !== "select" && headWord !== "with") {
    return {
      ok: false,
      error: `Blocked: only read-only SELECT queries are allowed (got "${headWord.toUpperCase()}").`,
    }
  }

  const forbidden = findForbiddenKeyword(input)
  if (forbidden) {
    return {
      ok: false,
      error: `Blocked: the query attempts a non-analytical operation (${forbidden.toUpperCase()}). InsightFlow only permits read-only SELECTs.`,
    }
  }

  const refs = extractTableRefs(input)
  const ctes = extractCteAliases(input)
  const allowed = new Set<string>([
    ...registeredTables.map((t) => t.toLowerCase()),
    ...ctes,
    "read_csv_auto",
    "information_schema",
    "duckdb_databases",
    "duckdb_tables",
    "duckdb_columns",
    "range",
    "generate_series",
  ])
  const unknown = [...new Set(refs.filter((r) => !allowed.has(r)))]
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Blocked: the query references table${unknown.length > 1 ? "s" : ""} that don't exist here: ${unknown.join(", ")}. Available tables: ${registeredTables.join(", ")}.`,
      tables: unknown,
    }
  }  let sql = input
  let limited = false
  if (!endsWithLiteralLimit(input)) {
    sql = `SELECT * FROM (${input}) AS _insightflow_result LIMIT ${MAX_RESULT_ROWS}`
    limited = true
  }
  return { ok: true, sql, tables: [...new Set(refs)], limited }
}
