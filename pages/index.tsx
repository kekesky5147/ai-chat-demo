// pages/index.tsx
'use client'

import { useState, useRef, useEffect, DragEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export default function Home () {
  const [input, setInput] = useState<string>('')
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [dragActive, setDragActive] = useState<boolean>(false)
  const [composing, setComposing] = useState<boolean>(false) // 한글 조합 중

  const sendingRef = useRef<boolean>(false) // 중복 전송 방지
  const controllerRef = useRef<AbortController | null>(null)
  const chatContainerRef = useRef<HTMLDivElement | null>(null)

  // 자동 스크롤
  useEffect(() => {
    const c = chatContainerRef.current
    if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' })
  }, [chat])

  // 한글 조합 시작/종료 추적
  const handleCompositionStart = () => setComposing(true)
  const handleCompositionEnd = () => setComposing(false)

  // KeyDown: Enter 기본 동작(줄바꿈)을 막기만 함
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
    }
  }

  // KeyUp: Enter + !Shift + !composing 일 때 전송
  const handleKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !composing) {
      e.preventDefault()
      sendMessage()
    }
  }

  // 파일 읽고 요약 시작
  const processFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result)
      const fileMsg: ChatMessage = {
        role: 'user',
        content:
          '📄 문서를 업로드했습니다. 요약 및 핵심 내용을 정리해 주세요:\n\n' +
          text
      }
      // assistant 슬록도 ChatMessage 타입으로 미리 선언
      const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
      const newChat: ChatMessage[] = [...chat, fileMsg, assistantMsg]
      setChat(newChat)
      summarizeDocument(text, newChat.length - 1)
    }
    reader.readAsText(file)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) processFile(f)
    e.target.value = ''
  }

  const handleDrag = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(e.type === 'dragenter' || e.type === 'dragover')
  }
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files?.[0]) processFile(e.dataTransfer.files[0])
  }

  // 문서 요약 스트리밍
  const summarizeDocument = async (docText: string, assistantIndex: number) => {
    setLoading(true)
    controllerRef.current?.abort()
    const ctrl = new AbortController()
    controllerRef.current = ctrl

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'user', content: `다음 문서를 요약해줘:\n\n${docText}` }
          ],
          stream: true
        })
      })
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let done = false

      while (!done) {
        const { value, done: d } = await reader.read()
        done = d
        if (value) {
          const chunk = decoder.decode(value, { stream: true })
          chunk
            .split('\n\n')
            .filter(line => line.startsWith('data: '))
            .forEach(line => {
              const json = line.replace(/^data: /, '').trim()
              if (json === '[DONE]') {
                done = true
                return
              }
              try {
                const parsed = JSON.parse(json)
                const delta = parsed.choices[0].delta.content
                if (delta) {
                  setChat(prev => {
                    const copy = [...prev]
                    copy[assistantIndex].content += delta
                    return copy
                  })
                }
              } catch {}
            })
        }
      }
    } catch {
      setChat(prev => {
        const copy = [...prev]
        copy[assistantIndex].content = '문서 요약 중 오류가 발생했습니다.'
        return copy
      })
    } finally {
      setLoading(false)
    }
  }

  // 일반 채팅 스트리밍
  const sendMessage = async () => {
    if (sendingRef.current) return
    sendingRef.current = true

    const text = input.trim()
    if (!text) {
      sendingRef.current = false
      return
    }

    setInput('')
    setLoading(true)
    controllerRef.current?.abort()
    const ctrl = new AbortController()
    controllerRef.current = ctrl

    const userMsg: ChatMessage = { role: 'user', content: text }
    const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
    const newChat = [...chat, userMsg, assistantMsg]
    setChat(newChat)

    const aiIndex = newChat.length - 1

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: '이 AI 어시스턴트는 …' },
            ...chat,
            userMsg
          ],
          stream: true
        })
      })
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let done = false

      while (!done) {
        const { value, done: d } = await reader.read()
        done = d
        if (value) {
          const chunk = decoder.decode(value, { stream: true })
          chunk
            .split('\n\n')
            .filter(line => line.startsWith('data: '))
            .forEach(line => {
              const json = line.replace(/^data: /, '').trim()
              if (json === '[DONE]') {
                done = true
                return
              }
              try {
                const parsed = JSON.parse(json)
                const delta = parsed.choices[0].delta.content
                if (delta) {
                  setChat(prev => {
                    const copy = [...prev]
                    copy[aiIndex].content += delta
                    return copy
                  })
                }
              } catch {}
            })
        }
      }
    } catch {
      setChat(prev => {
        const copy = [...prev]
        copy[aiIndex].content = '응답 중 오류가 발생했습니다.'
        return copy
      })
    } finally {
      setLoading(false)
      sendingRef.current = false
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: '2rem auto', textAlign: 'center' }}>
      <h1>대여금 반환 소송 챗봇</h1>

      {/* 업로드 & 드래그 */}
      <div
        style={{ display: 'flex', gap: 12, marginBottom: 12 }}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
      >
        <div
          style={{
            flex: 1,
            padding: '16px',
            border: dragActive ? '2px dashed #0070f3' : '2px dashed #ccc',
            borderRadius: 4,
            textAlign: 'center',
            color: '#666'
          }}
        >
          {dragActive ? '여기에 놓으세요!' : '드래그해서 파일 업로드'}
        </div>
        <label
          htmlFor='file-upload'
          style={{
            display: 'inline-flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '8px 16px',
            backgroundColor: '#000',
            color: '#fff',
            borderRadius: 4,
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          문서 업로드
        </label>
        <input
          id='file-upload'
          type='file'
          accept='.txt,.md'
          onChange={handleFileUpload}
          style={{ display: 'none' }}
        />
      </div>

      {/* 채팅창 */}
      <div
        ref={chatContainerRef}
        style={{
          border: '1px solid #ccc',
          padding: 16,
          height: 400,
          overflowY: 'auto'
        }}
      >
        {chat.map((msg, i) => (
          <div
            key={i}
            style={{
              textAlign: msg.role === 'user' ? 'right' : 'left',
              marginBottom: '1rem'
            }}
          >
            <div
              style={{
                display: 'inline-block',
                background: msg.role === 'user' ? '#DCF8C6' : '#F1F0F0',
                padding: '8px 12px',
                borderRadius: 8,
                maxWidth: '80%',
                wordBreak: 'break-word'
              }}
            >
              <strong style={{ display: 'block', marginBottom: 4 }}>
                {msg.role === 'user' ? '나' : 'AI'}
              </strong>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {msg.content}
              </ReactMarkdown>
            </div>
          </div>
        ))}
        {loading && <p>AI가 타이핑 중…</p>}
      </div>

      {/* 입력창 */}
      <textarea
        rows={3}
        value={input}
        onChange={e => setInput(e.target.value)}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        placeholder='메시지를 입력하세요…'
        style={{ width: '100%', marginTop: 8 }}
      />

      <button
        onClick={sendMessage}
        disabled={loading}
        style={{ marginTop: 8, padding: '8px 16px' }}
      >
        전송
      </button>
    </div>
  )
}
