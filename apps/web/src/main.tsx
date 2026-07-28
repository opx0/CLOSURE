import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { App } from './app.tsx'
import './styles.css'

// TanStack Query owns every piece of server state; nothing is duplicated into component state
// (STACK §4). Retries stay off: a failed honesty-critical call should be visible, not smoothed over.
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 } },
})

const root = document.getElementById('root')
if (root === null) throw new Error('index.html is missing #root')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter basename="/app">
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
