// Frame Audit for Dev Mode — finds layers that break developer handoff.
// Rules:
//   OVERFLOW     child extends beyond its parent frame's bounds (>1px on any edge)
//   GIANT        layer bounding box area > 2x its top-level screen frame (outermost only)
//   HIDDEN       layer with visible = false
//   IMAGE_BLOAT  image fill intrinsic area > (3x)^2 its rendered area
//   BASE_SIZE    top-level screen frame not 402x874 (iPhone 16 Pro base)
//
// All geometry uses absoluteBoundingBox, NOT absoluteRenderBounds: render bounds
// include drop shadows/blur (false overflow on every shadowed card) and are
// pre-clipped by clipsContent ancestors (which would hide exactly the junk we hunt).

const OVERFLOW_TOLERANCE = 1 // px a single edge may stick out
const GIANT_AREA_RATIO = 2 // layer area vs screen area
const IMAGE_SCALE_RATIO = 3 // source resolution vs rendered size, per axis
const IMAGE_SIZE_TIMEOUT_MS = 5000 // getSizeAsync can hang on some platforms
const BASE_W = 402
const BASE_H = 874
const BASE_TOLERANCE = 2
// Pages whose name starts with one of these (case-insensitive) are skipped —
// covers/playgrounds are decorative by design and would drown real findings.
const IGNORED_PAGE_PREFIXES = ['cover', 'playground', 'archive', 'scratch']

const findings = []
const imageSizeCache = new Map() // imageHash -> {width,height} | null

function bounds(node) {
  return node.absoluteBoundingBox
}

function addFinding(rule, node, page, detail) {
  findings.push({ rule, nodeId: node.id, name: node.name, page: page.name, detail })
}

// Is a spill beyond `node`'s parent actually invisible? True if any ancestor clips.
function clippedByAncestor(node) {
  let p = node.parent
  while (p && p.type !== 'PAGE') {
    if ('clipsContent' in p && p.clipsContent) return true
    p = p.parent
  }
  return false
}

function auditNode(node, page, parentFrame, topFrame, giantFlagged) {
  if (node.visible === false) {
    addFinding('HIDDEN', node, page, 'invisible layer — delete or move to a scratch page')
    // still recurse: hidden groups often hide the giant assets we care about
  }

  const b = bounds(node)
  let flaggedGiant = false

  if (b && parentFrame) {
    const pb = bounds(parentFrame)
    if (pb) {
      const over = Math.max(
        pb.x - b.x,
        pb.y - b.y,
        b.x + b.width - (pb.x + pb.width),
        b.y + b.height - (pb.y + pb.height),
      )
      if (over > OVERFLOW_TOLERANCE) {
        const clipped = clippedByAncestor(node) ? 'clipped (invisible junk)' : 'VISIBLE spill'
        addFinding(
          'OVERFLOW',
          node,
          page,
          `${Math.round(b.width)}x${Math.round(b.height)} sticks ${Math.round(over)}px outside "${parentFrame.name}" — ${clipped}`,
        )
      }
    }
  }

  if (b && topFrame && node !== topFrame && !giantFlagged) {
    const tb = bounds(topFrame)
    if (tb && b.width * b.height > GIANT_AREA_RATIO * tb.width * tb.height) {
      flaggedGiant = true // suppress duplicate GIANT on descendants of this node
      addFinding(
        'GIANT',
        node,
        page,
        `${Math.round(b.width)}x${Math.round(b.height)} — ${(
          (b.width * b.height) /
          (tb.width * tb.height)
        ).toFixed(1)}x the screen area`,
      )
    }
  }

  return flaggedGiant
}

function imageSizeWithTimeout(image) {
  return Promise.race([
    image.getSizeAsync(),
    new Promise((resolve) => setTimeout(() => resolve(null), IMAGE_SIZE_TIMEOUT_MS)),
  ])
}

async function auditImageFills(node, page) {
  if (!('fills' in node) || !Array.isArray(node.fills)) return
  const b = bounds(node)
  if (!b || b.width === 0 || b.height === 0) return
  for (const fill of node.fills) {
    if (fill.type !== 'IMAGE' || !fill.imageHash) continue
    let size
    if (imageSizeCache.has(fill.imageHash)) {
      size = imageSizeCache.get(fill.imageHash)
    } else {
      const image = figma.getImageByHash(fill.imageHash)
      try {
        size = image ? await imageSizeWithTimeout(image) : null
      } catch (e) {
        size = null // corrupt/unavailable image bytes
      }
      imageSizeCache.set(fill.imageHash, size)
    }
    if (!size) continue
    const ratio = IMAGE_SCALE_RATIO * IMAGE_SCALE_RATIO
    if (size.width * size.height > ratio * b.width * b.height) {
      addFinding(
        'IMAGE_BLOAT',
        node,
        page,
        `source ${size.width}x${size.height} rendered at ${Math.round(b.width)}x${Math.round(b.height)} — downscale the asset`,
      )
    }
  }
}

function walk(node, page, parentFrame, topFrame, giantFlagged, out) {
  const flaggedGiant = auditNode(node, page, parentFrame, topFrame, giantFlagged)
  out.push({ node, page })

  // Instance internals mirror the main component; overrides are not audited
  // (known simplification — the instance's own box is still checked above).
  if (node.type === 'INSTANCE') return

  if ('children' in node) {
    const isClippingFrame =
      (node.type === 'FRAME' || node.type === 'COMPONENT') && node !== topFrame
    const nextParent = isClippingFrame ? node : parentFrame
    for (const child of node.children) {
      walk(child, page, nextParent, topFrame, giantFlagged || flaggedGiant, out)
    }
  }
}

// Page-level children, with SECTION containers (possibly nested) flattened away.
function topLevelNodes(children, out) {
  for (const child of children) {
    if (child.type === 'SECTION') {
      topLevelNodes(child.children, out)
    } else {
      out.push(child)
    }
  }
  return out
}

function isScreenSized(node) {
  return node.width >= 300 && node.width <= 500 && node.height >= 600 && node.height <= 1100
}

function isIgnoredPage(page) {
  const name = page.name.trim().toLowerCase()
  return IGNORED_PAGE_PREFIXES.some((p) => name.startsWith(p))
}

async function run() {
  await figma.loadAllPagesAsync()

  const visited = []
  const skippedPages = []
  for (const page of figma.root.children) {
    if (isIgnoredPage(page)) {
      skippedPages.push(page.name)
      continue
    }
    for (const top of topLevelNodes(page.children, [])) {
      const frameLike = top.type === 'FRAME' || top.type === 'COMPONENT'
      if (frameLike && isScreenSized(top)) {
        // node.width/height, not bounds: rotation-free, effect-free base check
        if (Math.abs(top.width - BASE_W) + Math.abs(top.height - BASE_H) > BASE_TOLERANCE) {
          addFinding(
            'BASE_SIZE',
            top,
            page,
            `${Math.round(top.width)}x${Math.round(top.height)} — base is ${BASE_W}x${BASE_H} (iPhone 16 Pro)`,
          )
        }
      }
      // Frame-like tops anchor OVERFLOW/GIANT; loose layers still get HIDDEN/IMAGE_BLOAT.
      walk(top, page, frameLike ? top : null, frameLike ? top : null, false, visited)
    }
  }

  for (const { node, page } of visited) {
    await auditImageFills(node, page)
  }

  figma.showUI(__html__, { width: 420, height: 560 })
  figma.ui.postMessage({ type: 'results', findings, skippedPages })
  figma.notify(`Frame Audit: ${findings.length} finding(s)`)
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'jump') {
    const node = await figma.getNodeByIdAsync(msg.nodeId)
    if (!node) {
      figma.notify('Node no longer exists (already cleaned?)')
      return
    }
    let page = node.parent
    while (page && page.type !== 'PAGE') page = page.parent
    if (page) await figma.setCurrentPageAsync(page)
    figma.currentPage.selection = [node]
    figma.viewport.scrollAndZoomIntoView([node])
  }
  if (msg.type === 'close') figma.closePlugin()
}

run().catch((err) => {
  figma.notify(`Audit failed: ${err && err.message ? err.message : err}`)
  figma.closePlugin()
})
