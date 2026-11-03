import { NextResponse } from "next/server"
import { isOpenRouterConfigured, getOpenRouterModel } from "@/lib/ai/server/openrouter"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({
    ok: true,
    aiConfigured: isOpenRouterConfigured(),
    model: getOpenRouterModel(),
    time: new Date().toISOString(),
  })
}
