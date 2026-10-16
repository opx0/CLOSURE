import type { Topic } from '@levelhead/contracts'

export const WEB_TOPICS: readonly Topic[] = [
  {
    id: 'web.event_loop',
    area: 'web',
    title: 'JavaScript event loop',
    ask: 'Ask them to explain how JavaScript runs asynchronous code on a single thread through the event loop.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'one call stack runs synchronous code to completion',
        'callbacks from timers, I/O and events wait in the task queue',
        'promise callbacks go to the microtask queue, which is drained before the next task',
      ],
      trade_offs: [
        'a single thread avoids data races, but one long task blocks everything',
        'CPU-heavy work belongs in a Web Worker or split into small chunks',
        'async code does not block, but is harder to follow than sequential code',
      ],
      failure_modes: [
        'a long synchronous loop freezes the page',
        'an unhandled promise rejection is silently lost',
        'microtasks that keep queueing more microtasks starve rendering',
      ],
    },
    falsePremise:
      'setTimeout(fn, 0) runs fn before any promise callbacks that are already queued, because a zero delay means immediately.',
    twist: 'the page now has to parse a 50 MB JSON file without freezing',
  },
  {
    id: 'web.cors',
    area: 'web',
    title: 'CORS',
    ask: 'Ask them to explain why a browser blocks some cross-origin requests and how CORS lets a server allow them.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'the same-origin policy compares scheme, host and port',
        'the server opts in with Access-Control-Allow-Origin and related response headers',
        'a non-simple request triggers an OPTIONS preflight before the real request',
      ],
      trade_offs: [
        'a wildcard origin is easy but cannot be combined with credentials',
        'an explicit allowlist of origins is safer but has to be maintained',
        'preflights add a round trip, which Access-Control-Max-Age can cache',
      ],
      failure_modes: [
        'reflecting any Origin back with credentials allowed exposes user data to other sites',
        'missing CORS headers on error responses hide the real error behind a CORS error',
        'assuming CORS protects the server from non-browser clients',
      ],
    },
    falsePremise:
      'CORS is enforced by the server, so a request sent with curl without an allowed Origin header gets rejected.',
    twist: 'the frontend and the API now live on two different domains and must send cookies',
  },
  {
    id: 'web.rendering_pipeline',
    area: 'web',
    title: 'Browser rendering pipeline',
    ask: 'Ask them to walk through how a browser turns HTML, CSS and JavaScript into pixels, and what makes a page slow to render.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'the HTML parser builds the DOM and the CSS parser builds the CSSOM',
        'style and layout compute what each element looks like, its size and its position',
        'paint fills in the pixels, and the compositor combines layers into the frame',
        'a synchronous script blocks HTML parsing, and a stylesheet blocks rendering until it loads',
      ],
      trade_offs: [
        'animating transform or opacity can skip layout and paint; changing width triggers layout for much of the page',
        'defer keeps script order and runs after parsing; async runs each script as soon as it loads, in any order',
        'inlining critical CSS speeds up the first paint but cannot be cached separately',
      ],
      failure_modes: [
        'layout thrashing from alternately reading layout values and writing styles in a loop',
        'a large synchronous script in the head delaying the first paint',
        'images without dimensions shifting the layout when they load',
      ],
    },
    falsePremise:
      'The browser downloads and runs all the JavaScript before it starts parsing any HTML, so where a script tag sits in the page does not matter.',
    twist: 'an animation on the page drops to 20 frames per second on low-end phones',
  },
  {
    id: 'web.react_rendering',
    area: 'web',
    title: 'React rendering and state',
    ask: 'Ask them to explain when a React component re-renders, and how a state update reaches the screen.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'a component re-renders when its state changes, when its parent re-renders, or when a context it reads changes',
        'rendering produces a new element tree that React compares with the previous one (reconciliation)',
        'only the differences are committed to the DOM',
        'state updates are batched, so the state variable does not change until the next render',
      ],
      trade_offs: [
        'lifting state up shares it between components but re-renders everything below its owner',
        'memo, useMemo and useCallback skip work but add comparison cost and complexity',
        'global state in a context is convenient but re-renders every consumer on each change',
      ],
      failure_modes: [
        'mutating state in place, so React sees the same reference and skips the update',
        'an effect missing a dependency and reading a stale value',
        'array indexes as keys in a list that reorders, which mixes up component state',
      ],
    },
    falsePremise:
      'A component only re-renders when its props change, so a child whose props stay the same never re-renders when its parent does.',
    twist:
      'a list of 10,000 rows re-renders in full every time the user types a character in a search box',
  },
  {
    id: 'web.client_storage',
    area: 'web',
    title: 'Cookies, localStorage and tokens',
    ask: 'Ask them to compare cookies, localStorage and sessionStorage, and where they would keep a login token in the browser.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'the browser sends cookies with every matching request automatically; storage values are sent only if a script adds them',
        'HttpOnly hides a cookie from JavaScript, Secure limits it to HTTPS, and SameSite limits sending it cross-site',
        'localStorage persists until it is cleared; sessionStorage lasts only as long as the tab',
        'both storage APIs are per origin and readable by any script running on the page',
      ],
      trade_offs: [
        'an HttpOnly cookie hides the token from XSS but needs protection against CSRF',
        'a token in localStorage is not sent cross-site, but any injected script can steal it',
        'cookies add bytes to every request and hold about 4 KB; storage holds megabytes but is synchronous and stores only strings',
      ],
      failure_modes: [
        'an XSS payload reading a token from localStorage and sending it to an attacker',
        'a cookie without SameSite or a CSRF token letting another site make requests as the user',
        'sensitive data left in localStorage on a shared computer after logout',
      ],
    },
    falsePremise:
      'Data in localStorage is encrypted and tied to the logged-in user, so a token kept there is safe from any script on the page.',
    twist:
      'the site now embeds third-party analytics and chat widgets that run their own scripts on the page',
  },
]
