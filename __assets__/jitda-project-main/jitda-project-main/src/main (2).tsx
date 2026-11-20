import React, { Component, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { MapProvider } from './map/MapContext'
import './styles.css'

type ErrorBoundaryState = { error: Error | null }

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-error-fallback" role="alert" aria-labelledby="app-error-title">
          <section>
            <h1 id="app-error-title">문제가 생겼어요.</h1>
            <p>새로고침해 주세요.</p>
            <small>{this.state.error.message || '오류 내용을 확인할 수 없어요.'}</small>
            <button type="button" aria-label="앱 새로고침" onClick={() => window.location.reload()}>새로고침</button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
  }, { once: true })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <MapProvider>
        <App />
      </MapProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
