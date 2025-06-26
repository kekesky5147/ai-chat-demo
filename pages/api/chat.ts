// pages/api/chat.ts
import type { NextApiRequest, NextApiResponse } from "next"

export const config = {
  api: {
    bodyParser: false,
  },
}

// API로 받는 메시지 타입 정의
interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

// POST /api/chat
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"])
    return res.status(405).end("Method Not Allowed")
  }

  // raw body 읽기
  const buf: Buffer[] = []
  for await (const chunk of req) {
    buf.push(chunk as Buffer)
  }

  let payload: {
    model: string
    stream?: boolean
    messages: ChatMessage[]
  }
  try {
    payload = JSON.parse(Buffer.concat(buf).toString("utf8"))
  } catch {
    return res.status(400).json({ error: "Invalid JSON" })
  }

  // OpenAI 스트림 요청
  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: payload.model,
      messages: payload.messages,
      stream: true,
    }),
  })

  if (!openaiRes.ok || !openaiRes.body) {
    const err = await openaiRes.text()
    return res.status(openaiRes.status).json({ error: `OpenAI Error: ${err}` })
  }

  // 클라이언트로 SSE 스트림 헤더
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache, no-transform")
  res.setHeader("Connection", "keep-alive")
  res.flushHeaders()

  // OpenAI 스트림을 그대로 전달
  const reader = openaiRes.body.getReader()
  const decoder = new TextDecoder()
  let done = false
  while (!done) {
    const { value, done: doneReading } = await reader.read()
    done = doneReading
    if (value) {
      const chunk = decoder.decode(value, { stream: true })
      res.write(chunk)
    }
  }
  res.end()
}
