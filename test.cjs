// Local harness: runs code.js in a sandbox with a mocked `figma` global and a
// synthetic document, then asserts the audit rules fire (and don't) correctly.
// Usage: node test.js
const fs = require('fs')
const vm = require('vm')
const path = require('path')

// ---------- tiny fixture builder ----------
let nextId = 1
function n(type, name, props = {}) {
  const node = {
    id: `${nextId++}:0`,
    type,
    name,
    visible: true,
    children: [],
    ...props,
  }
  if (props.x !== undefined) {
    node.absoluteBoundingBox = { x: props.x, y: props.y, width: props.width, height: props.height }
  }
  for (const c of node.children) c.parent = node
  return node
}

function link(parent, ...children) {
  parent.children = children
  for (const c of children) c.parent = parent
  return parent
}

// ---------- document ----------
// Page 1: a SECTION wrapping a screen with the classic offenders. The numbers are
// taken from a real production file: a 1594x1699 decoration parked at (-679,-330)
// behind a 402x874 screen, plus a 414px-wide rectangle inside a 402px frame.
const giantDecoration = n('RECTANGLE', 'brand_orb_large', {
  x: -679, y: -330, width: 1594, height: 1699,
})
const wideRect = n('RECTANGLE', 'Rectangle 427321742', { x: 0, y: 0, width: 414, height: 875 })
const hiddenLayer = n('RECTANGLE', 'old design', { x: 10, y: 10, width: 50, height: 50, visible: false })
const cleanText = n('TEXT', 'Title', { x: 44, y: 576, width: 314, height: 82 })
const screen = link(
  n('FRAME', 'Rewards', { x: 0, y: 0, width: 402, height: 874, clipsContent: true }),
  giantDecoration, wideRect, hiddenLayer, cleanText,
)
const section = link(n('SECTION', 'Rewards flow'), screen)

// Page 1 also: wrong-base screen + bloated image + giant-dedup group, at page level
const wrongBase = n('FRAME', 'Old iPhone 14 screen', { x: 600, y: 0, width: 390, height: 844, clipsContent: true })
const bloatImg = n('RECTANGLE', 'photo', {
  x: 610, y: 10, width: 100, height: 100,
  fills: [{ type: 'IMAGE', imageHash: 'bloated' }],
})
link(wrongBase, bloatImg)

const giantInner = n('RECTANGLE', 'bg art', { x: -3000, y: -3000, width: 2000, height: 2000 })
const giantWrapper = link(n('GROUP', 'bg group', { x: -3000, y: -3000, width: 2000, height: 2000 }), giantInner)
const dedupScreen = link(
  n('FRAME', 'Dedup screen', { x: 1200, y: 0, width: 402, height: 874, clipsContent: false }),
  giantWrapper,
)

const page1 = link(n('PAGE', 'Screens'), section, wrongBase, dedupScreen)

// Page 2: clean screen — zero findings expected from it
const cleanScreen = link(
  n('FRAME', 'Clean', { x: 0, y: 0, width: 402, height: 874, clipsContent: true }),
  n('TEXT', 'ok', { x: 10, y: 10, width: 100, height: 20 }),
)
const page2 = link(n('PAGE', 'Clean page'), cleanScreen)

// Page 3: "Cover ..." page with a blatant violation — must be skipped entirely
const coverJunk = n('RECTANGLE', 'sphere motif', { x: -5000, y: -5000, width: 7575, height: 7575 })
const coverFrame = link(
  n('FRAME', 'Singular sphere', { x: 0, y: 0, width: 402, height: 874, clipsContent: true }),
  coverJunk,
)
const page3 = link(n('PAGE', 'Cover — brand'), coverFrame)

// ---------- figma mock ----------
function makeSandbox(pages, { failLoad = false } = {}) {
  const state = { notifications: [], uiMessages: [], closed: false, onmessage: null }
  const sandbox = {
    setTimeout,
    console,
    __html__: '<html/>',
    figma: {
      root: { children: pages },
      currentPage: { selection: [] },
      loadAllPagesAsync: async () => {
        if (failLoad) throw new Error('memory limit')
      },
      getImageByHash: (hash) => ({
        getSizeAsync: async () =>
          hash === 'bloated' ? { width: 1000, height: 1000 } : { width: 100, height: 100 },
      }),
      getNodeByIdAsync: async () => null,
      setCurrentPageAsync: async () => {},
      showUI: () => {},
      notify: (msg) => state.notifications.push(msg),
      closePlugin: () => { state.closed = true },
      viewport: { scrollAndZoomIntoView: () => {} },
      ui: {
        postMessage: (msg) => state.uiMessages.push(msg),
        set onmessage(fn) { state.onmessage = fn },
        get onmessage() { return state.onmessage },
      },
    },
  }
  return { sandbox, state }
}

async function runPlugin(pages, opts) {
  const { sandbox, state } = makeSandbox(pages, opts)
  const code = fs.readFileSync(path.join(__dirname, 'code.js'), 'utf8')
  vm.runInNewContext(code, sandbox, { filename: 'code.js' })
  // run() is async fire-and-forget; wait for it to settle
  await new Promise((r) => setTimeout(r, 50))
  const results = state.uiMessages.find((m) => m.type === 'results')
  return {
    findings: results ? results.findings : [],
    skippedPages: results ? results.skippedPages : [],
    state,
  }
}

// ---------- assertions ----------
let failed = 0
function expect(cond, label) {
  if (cond) console.log(`  ok   ${label}`)
  else { failed++; console.error(`  FAIL ${label}`) }
}
function count(findings, rule, nameIncludes) {
  return findings.filter(
    (f) => f.rule === rule && (!nameIncludes || f.name.includes(nameIncludes)),
  ).length
}

;(async () => {
  console.log('case: full document audit')
  const { findings, skippedPages } = await runPlugin([page1, page2, page3])
  for (const f of findings) console.log(`       [${f.rule}] ${f.name} (${f.page}) — ${f.detail}`)

  // Section flattening: the screen inside a SECTION must be audited
  expect(count(findings, 'OVERFLOW', 'brand_orb_large') === 1, 'giant decoration flagged OVERFLOW (inside SECTION)')
  expect(findings.find((f) => f.rule === 'OVERFLOW' && f.name.includes('brand_orb_large'))?.detail.includes('clipped'),
    'decoration overflow tagged clipped (ancestor clips)')
  expect(count(findings, 'GIANT', 'brand_orb_large') === 1, 'giant decoration flagged GIANT (7.7x area)')
  expect(count(findings, 'OVERFLOW', 'Rectangle 427321742') === 1, '414px rect flagged OVERFLOW in 402 frame')
  expect(count(findings, 'HIDDEN', 'old design') === 1, 'hidden layer flagged HIDDEN')
  expect(count(findings, 'OVERFLOW', 'Title') === 0, 'clean text NOT flagged')

  // BASE_SIZE
  expect(count(findings, 'BASE_SIZE', 'Old iPhone 14') === 1, '390x844 screen flagged BASE_SIZE')
  expect(count(findings, 'BASE_SIZE', 'Rewards') === 0, '402x874 screen NOT flagged BASE_SIZE')

  // IMAGE_BLOAT: 1000x1000 source on 100x100 render = 100x area > 9x
  expect(count(findings, 'IMAGE_BLOAT', 'photo') === 1, '10x-per-axis image flagged IMAGE_BLOAT')

  // GIANT dedup: wrapper group + inner art both >2x — only outermost flagged
  expect(count(findings, 'GIANT', 'bg group') === 1, 'giant wrapper flagged GIANT')
  expect(count(findings, 'GIANT', 'bg art') === 0, 'inner giant suppressed (dedup)')
  expect(findings.find((f) => f.rule === 'OVERFLOW' && f.name === 'bg group')?.detail.includes('VISIBLE'),
    'spill in non-clipping frame tagged VISIBLE')

  // Clean page contributes nothing
  expect(findings.filter((f) => f.page === 'Clean page').length === 0, 'clean page has zero findings')

  // Ignored pages: "Cover — brand" has a 7575px violation but must be skipped
  expect(findings.filter((f) => f.page === 'Cover — brand').length === 0, 'Cover page findings suppressed')
  expect(skippedPages.includes('Cover — brand'), 'Cover page reported as skipped')

  console.log('case: loadAllPagesAsync throws')
  const { findings: f2, state: s2 } = await runPlugin([page1], { failLoad: true })
  expect(f2.length === 0, 'no findings posted on failure')
  expect(s2.notifications.some((m) => m.includes('Audit failed')), 'failure notified to user')
  expect(s2.closed, 'plugin closed on failure')

  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILURE(S)`)
  process.exit(failed === 0 ? 0 : 1)
})()
