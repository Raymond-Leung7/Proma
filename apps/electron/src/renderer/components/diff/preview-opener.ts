/**
 * useOpenPreview — 统一的预览入口 Hook
 *
 * 把分散在 SidePanel / PreviewOpenButton / AgentView 等处的「打开预览」逻辑收敛到一处，
 * 按用户偏好（previewModePreferenceAtom）路由到 Tab 或右侧分屏。
 *
 * 用户仍可通过：
 *   - 拖拽 preview Tab 出 TabBar（即时切换为分屏）
 *   - PreviewPanel 顶栏 Maximize2（即时切换为 Tab）
 *   - PreviewTabContent 顶栏「切换为侧边分屏」按钮（即时切换为分屏）
 * 在两种模式间即时切换，本 hook 仅控制默认行为。
 */

import * as React from 'react'
import { useStore } from 'jotai'
import {
  previewFileMapAtom,
  previewPanelOpenMapAtom,
  previewModePreferenceAtom,
  type PreviewFile,
} from '@/atoms/preview-atoms'
import {
  activeTabIdAtom,
  closeTab,
  createPreviewTabId,
  getPreviewTabTitle,
  isPreviewTab,
  openTab,
  sessionViewStateMapAtom,
  tabsAtom,
} from '@/atoms/tab-atoms'

/** Jotai store 类型（从 useStore 推导，避免直接 import 内部 Store 类型） */
type JotaiStore = ReturnType<typeof useStore>

interface OpenPreviewOptions {
  /** 跳过偏好读取，强制以 Tab 方式打开（用于 PreviewPanel 的 Maximize2 等显式入口） */
  forceTab?: boolean
  /** 跳过偏好读取，强制以分屏方式打开（用于拖拽 Tab 出区域转分屏） */
  forceSplit?: boolean
}

export function useOpenPreview() {
  const store = useStore()

  return React.useCallback(
    (sessionId: string, file: PreviewFile, opts: OpenPreviewOptions = {}) => {
      // 1. 文件状态两种模式都需要，先写入
      store.set(previewFileMapAtom, (prev) => {
        const m = new Map(prev)
        m.set(sessionId, file)
        return m
      })

      const preferSplit = opts.forceSplit
        ? true
        : opts.forceTab
          ? false
          : store.get(previewModePreferenceAtom) === 'split'

      if (preferSplit) {
        // 分屏：开启预览面板，不创建 Tab
        store.set(previewPanelOpenMapAtom, (prev) => {
          const m = new Map(prev)
          m.set(sessionId, true)
          return m
        })
        return
      }

      // Tab：保持旧行为（关闭分屏 + 创建/复用 preview Tab）
      store.set(previewPanelOpenMapAtom, (prev) => {
        const m = new Map(prev)
        m.set(sessionId, false)
        return m
      })
      const result = openTab(store.get(tabsAtom), {
        type: 'preview',
        sessionId,
        title: getPreviewTabTitle(file.filePath),
      })
      store.set(tabsAtom, result.tabs)
      store.set(activeTabIdAtom, result.activeTabId)
    },
    [store],
  )
}

/**
 * tearOffPreviewToSplit — 把 preview Tab 即时切换为右侧分屏。
 *
 * 用于「拖拽 preview Tab 出 TabBar」与「PreviewTabContent 顶栏切换按钮」两条入口共用。
 * 流程：关闭 preview Tab → 激活对应会话的 agent Tab → 开启右侧分屏。
 * previewFileMap 中保留的文件就是分屏要显示的内容，无需重新打开。
 *
 * 若传入的 tabId 不是 preview Tab（或已找不到），不做任何事。
 */
export function tearOffPreviewToSplit(store: JotaiStore, tabId: string): void {
  const tabs = store.get(tabsAtom)
  const tab = tabs.find((t) => t.id === tabId)
  if (!tab || !isPreviewTab(tab)) return

  const sessionId = tab.sessionId

  // 关闭 preview Tab，激活相邻 Tab（通常是会话 Tab）
  const closed = closeTab(store.get(tabsAtom), store.get(activeTabIdAtom), tabId)
  store.set(tabsAtom, closed.tabs)
  // 优先激活该会话的 agent Tab，让右侧分屏可见
  const agentTab = closed.tabs.find((t) => t.type === 'agent' && t.sessionId === sessionId)
  store.set(activeTabIdAtom, agentTab?.id ?? closed.activeTabId)

  // 标记会话视图为 session，避免切走再切回时重建 preview Tab
  store.set(sessionViewStateMapAtom, (prev) => {
    const m = new Map(prev)
    m.set(sessionId, { previewTabOpen: false, lastView: 'session' })
    return m
  })

  // 开启右侧分屏
  store.set(previewPanelOpenMapAtom, (prev) => {
    const m = new Map(prev)
    m.set(sessionId, true)
    return m
  })
}

/** 根据会话 ID 派生对应的 preview Tab ID */
export function getPreviewTabIdForSession(sessionId: string): string {
  return createPreviewTabId(sessionId)
}

