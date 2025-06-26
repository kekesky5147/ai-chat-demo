// pages/_app.tsx
import type { AppProps } from 'next/app'
import '../styles/globals.css' // ➊

export default function MyApp ({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />
}
