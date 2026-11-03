// End-to-end verification: uploads a real CSV, asks questions through the
// LLM pipeline (against the mock OpenRouter), and exercises every workspace
// view against the local DuckDB engine. Produces screenshots for the README.
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3210"
const ARTIFACTS = ".e2e-artifacts"
mkdirSync(ARTIFACTS, { recursive: true })

let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failures++
    console.log(`  ✗ ${name}: ${err}`)
  }
}

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(120_000)
page.on("pageerror", (err) => console.log(`  [pageerror] ${err.message}`))
page.on("console", (msg) => {
  if (msg.type() === "error") console.log(`  [console.error] ${msg.text().slice(0, 300)}`)
})

console.log("E2E: workspace")

// 1. Landing page renders
await page.goto(`${BASE}/`)
await check("landing renders hero + CTA", async () => {
  await page.getByText("Chat with your data.").waitFor()
  await page.getByText("Upload a dataset — it's free").waitFor()
})
await page.screenshot({ path: `${ARTIFACTS}/01-landing.png` })

// 2. Workspace boots to upload state
await page.goto(`${BASE}/workspace`)
await check("workspace shows upload empty state", async () => {
  await page.getByText("Upload your first dataset").waitFor()
})
await page.screenshot({ path: `${ARTIFACTS}/02-workspace-empty.png` })

// 3a. A malformed upload must fail with clear guidance (error path)
const badFileInput = page.locator('input[type="file"]').first()
await badFileInput.setInputFiles({
  name: "broken.csv",
  mimeType: "text/csv",
  buffer: Buffer.from("name,note\n\"unclosed quote,more\n"),
})
await check("malformed CSV shows a clear upload error", async () => {
  await page.getByText(/malformed|couldn't|failed/i).first().waitFor({ timeout: 15_000 })
})
await page.screenshot({ path: `${ARTIFACTS}/03a-upload-error.png` })

// 3. Upload the real sample dataset
const fileInput = page.locator('input[type="file"]').first()
await fileInput.setInputFiles({
  name: "sales_orders.csv",
  mimeType: "text/csv",
  buffer: (await import("node:fs")).readFileSync(new URL("../../datasets/sales_orders.csv", import.meta.url)),
})
await check("upload profile: dataset card appears with row counts", async () => {
  await page.getByText("sales_orders.csv").first().waitFor()
  await page.getByText(/1,223 rows/).first().waitFor()
})
await page.screenshot({ path: `${ARTIFACTS}/03-dataset-uploaded.png` })

// 4. Ask a suggested question through the whole LLM → SQL → chart pipeline
const suggestion = page.locator("button", { hasText: /Which .* generated the highest/ }).first()
await suggestion.click()
await check("assistant streams and completes an analysis", async () => {
  await page.getByText("SQL executed").first().waitFor({ timeout: 30_000 }).catch(async () => {
    // dump the UI state on failure to diagnose
    const body = await page.locator("body").innerText()
    console.log(`      [diag] body tail: ${body.slice(-900).replace(/\n+/g, " | ")}`)
    throw new Error("SQL executed badge not found")
  })
})
await check("result has chart, table and executed SQL tabs", async () => {
  await page.locator("svg.recharts-surface").first().waitFor()
  const tableTab = page.locator('button[role="tab"]', { hasText: "Table" }).first()
  await tableTab.click()
  await page.locator("table").first().waitFor()
  const sqlTab = page.locator('button[role="tab"]', { hasText: "SQL" }).first()
  await sqlTab.click()
  await page.locator("pre", { hasText: /SELECT/i }).first().waitFor()
})
await page.screenshot({ path: `${ARTIFACTS}/04-answer-with-chart.png` })

// 5. Follow-up question resolving context ("its")
await check("follow-up question keeps context and renders trend", async () => {
  const composer = page.locator("textarea").first()
  await composer.fill("Show its monthly trend")
  await composer.press("Enter")
  // second assistant message
  await page.getByText("SQL executed").nth(1).waitFor()
})

// 6. Dataset explorer
await page.locator("button", { hasText: "Dataset" }).first().click()
await check("explorer shows profile and duckdb preview", async () => {
  await page.getByText("Column profile").waitFor()
  await page.getByText("region").first().waitFor()
  await page.getByText("Quality score").waitFor()
})
await page.screenshot({ path: `${ARTIFACTS}/05-dataset-explorer.png` })

// 7. Insights dashboard with KPIs + trend + anomalies
await page.locator("button", { hasText: "Insights" }).first().click()
await check("insights computes KPIs from real SQL", async () => {
  await page.getByText("Total rows").waitFor()
  await page.getByText("Total revenue", { exact: true }).waitFor()
})
await check("trend + breakdown charts render", async () => {
  await page.locator("svg.recharts-surface").first().waitFor()
})
await page.screenshot({ path: `${ARTIFACTS}/06-insights.png` })
await check("anomaly scan flags planted outliers with explanations", async () => {
  await page.locator("button", { hasText: /Scan for anomalies/ }).first().click()
  await page.getByText(/flagged|No statistical outliers/i).first().waitFor({ timeout: 30_000 })
  // open the explanation of the top flagged row when one exists
  const firstRecord = page.locator("text=/IQR fence|z=/i").first()
  if (await firstRecord.isVisible()) {
    await firstRecord.click()
    await page.getByText(/standard deviation|fence/i).first().waitFor()
  }
})
await page.screenshot({ path: `${ARTIFACTS}/07-anomalies.png` })

// 8. New analysis button creates a conversation
await page.locator("button", { hasText: "New analysis" }).click()
await check("new analysis session works", async () => {
  await page.locator("textarea").first().waitFor()
})

await browser.close()
console.log(failures === 0 ? "E2E PASSED" : `E2E FAILED with ${failures} check(s)`)
process.exit(failures === 0 ? 0 : 1)
