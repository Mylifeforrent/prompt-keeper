(() => {
  'use strict';

  const D = window.PK_DATA;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const PAGES = {
    prompts: { title: 'Prompts', subtitle: '本地资产库 · Git 可选同步', placeholder: '搜索 Prompt 标题、正文、标签…' },
    instructions: { title: 'Agent 指令', subtitle: '仓库契约 · 项目投影 · 全局分发', placeholder: '搜索契约标题、正文、标签…' },
    skills: { title: 'Skills', subtitle: 'SKILL.md · 多平台分发', placeholder: '搜索技能名称、描述、文件夹…' },
    mcp: { title: 'MCP', subtitle: '服务模板 · 密钥仅本机', placeholder: '搜索 MCP 服务、文件夹…' },
    sync: { title: '同步中心', subtitle: '拉取 · 推送 · 冲突 · 分发', placeholder: '搜索变更、历史事件…' },
    settings: { title: '设置', subtitle: '外观 · 同步策略 · 数据', placeholder: '搜索设置…' },
  };

  const NAV = [
    { id: 'prompts', label: 'Prompts', icon: 'message' },
    { id: 'instructions', label: 'Agent 指令', icon: 'file' },
    { id: 'skills', label: 'Skills', icon: 'grid' },
    { id: 'mcp', label: 'MCP', icon: 'zap' },
    { id: 'sync', label: '同步', icon: 'git-branch' },
    { id: 'settings', label: '设置', icon: 'sliders' },
  ];

  const SKILL_PLATFORMS = [
    { id: 'claude', name: 'Claude Code', dir: '~/.claude/skills' },
    { id: 'cursor', name: 'Cursor', dir: '~/.cursor/skills' },
    { id: 'windsurf', name: 'Windsurf', dir: '~/.codeium/windsurf/skills' },
    { id: 'codex', name: 'Codex CLI', dir: '~/.codex/skills' },
    { id: 'cline', name: 'Cline', dir: '~/.cline/skills' },
    { id: 'kiro', name: 'Kiro', dir: '~/.kiro/skills' },
    { id: 'qoder', name: 'Qoder', dir: '~/.qoder/skills' },
    { id: 'opencode', name: 'OpenCode', dir: '~/.config/opencode/skills' },
  ];

  const STATUS_META = {
    synced: { label: '已同步', badge: 'success', icon: 'check' },
    pending: { label: '待推送', badge: 'warning', icon: 'arrow-up' },
    incoming: { label: '待拉取', badge: 'info', icon: 'arrow-down' },
    conflict: { label: '冲突', badge: 'danger', icon: 'alert' },
    blocked: { label: '凭据阻断', badge: 'danger', icon: 'lock' },
    local: { label: '仅本机', badge: 'neutral', icon: 'file' },
    stale: { label: '待更新', badge: 'warning', icon: 'refresh' },
    drifted: { label: '漂移', badge: 'danger', icon: 'alert' },
    missing: { label: '未投影', badge: 'neutral', icon: 'circle-check' },
  };

  const initialTheme = new URLSearchParams(location.search).get('theme');
  const state = {
    page: ['prompts', 'instructions', 'skills', 'mcp', 'sync', 'settings'].includes(location.hash.slice(1))
      ? location.hash.slice(1)
      : 'prompts',
    theme: ['light', 'dark', 'system'].includes(initialTheme)
      ? initialTheme
      : localStorage.getItem('pk_hifi_theme') || 'light',
    search: '',
    mobileDetail: false,

    promptTab: 'mine',
    prompts: D.prompts.map((p) => ({ ...p })),
    selectedPrompt: 'p-review',
    modalPromptId: null,
    promptView: localStorage.getItem('pk_hifi_prompt_view') || 'card',
    promptFolder: '',
    tagFilters: [],
    favOnly: false,
    promptSort: 'updated',
    platformCategory: '全部',

    instructionTab: 'library',
    contracts: D.contracts.map((c) => ({ ...c })),
    selectedContract: 'c-repo-baseline',
    contractFolder: '',
    contractScope: 'all',
    previewTarget: 'agents-md',
    previewPath: 'src/components/PromptDetail.tsx',
    globalPaths: Object.fromEntries(D.globalTargets.map((t) => [t.id, t.path])),
    selectedGlobalTargets: new Set(['gt-claude', 'gt-cursor']),
    selectedGlobalContracts: new Set(['c-repo-baseline']),

    skillTab: 'mine',
    skills: D.skills.map((s) => ({ ...s, installs: { ...s.installs } })),
    skillFolder: '',
    storeSource: 'all',
    storeCategory: '全部',
    skillModalId: null,
    skillModalTab: 'content',
    wizard: null,

    mcpFolder: '',
    mcps: D.mcps.map((m) => ({ ...m })),
    mcpSection: 'mine',
    selectedMcp: 'm-filesystem',
    mcpFav: false,
    mcpTab: 'config',
    deployModal: null,
    deploySelected: new Set(),

    syncTab: 'overview',
    changesTab: 'incoming',
    changesKind: 'all',
    resolvedChanges: new Set(),
    conflictStrategy: 'remote',
    deployKind: 'all',
    deployCell: null,

    expanded: new Set(),
    toasts: 0,
  };

  /* ------------------------------------------------------------------ */
  /* Utilities                                                          */
  /* ------------------------------------------------------------------ */

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function icon(name, cls = '') {
    return `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }

  function inlineMd(text) {
    let value = esc(text);
    value = value.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
    value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return value;
  }

  function md(text) {
    const lines = String(text ?? '').split('\n');
    const out = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (/^\s*```/.test(line)) {
        const lang = line.replace(/^\s*```/, '').trim();
        const buffer = [];
        index += 1;
        while (index < lines.length && !/^\s*```/.test(lines[index])) {
          buffer.push(lines[index]);
          index += 1;
        }
        index += 1;
        out.push(
          `<pre${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(buffer.join('\n'))}</code></pre>`,
        );
        continue;
      }

      if (/^\s*$/.test(line)) {
        index += 1;
        continue;
      }

      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^\s*[-*]\s+/.test(line)) {
        const items = [];
        while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
          items.push(`<li>${inlineMd(lines[index].replace(/^\s*[-*]\s+/, ''))}</li>`);
          index += 1;
        }
        out.push(`<ul>${items.join('')}</ul>`);
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
          items.push(`<li>${inlineMd(lines[index].replace(/^\s*\d+\.\s+/, ''))}</li>`);
          index += 1;
        }
        out.push(`<ol>${items.join('')}</ol>`);
        continue;
      }

      if (/^\s*\|/.test(line)) {
        const tableLines = [];
        while (index < lines.length && /^\s*\|/.test(lines[index])) {
          tableLines.push(lines[index]);
          index += 1;
        }
        const cells = (row) =>
          row
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((cell) => cell.trim());
        if (tableLines.length >= 2 && /^[\s|:-]+$/.test(tableLines[1])) {
          out.push(
            `<table><thead><tr>${cells(tableLines[0])
              .map((cell) => `<th>${inlineMd(cell)}</th>`)
              .join('')}</tr></thead><tbody>${tableLines
              .slice(2)
              .map((row) => `<tr>${cells(row).map((cell) => `<td>${inlineMd(cell)}</td>`).join('')}</tr>`)
              .join('')}</tbody></table>`,
          );
        } else {
          out.push(`<p>${inlineMd(tableLines.join(' '))}</p>`);
        }
        continue;
      }

      const paragraph = [line];
      index += 1;
      while (
        index < lines.length &&
        !/^\s*$/.test(lines[index]) &&
        !/^\s*```/.test(lines[index]) &&
        !/^(#{1,3})\s+/.test(lines[index]) &&
        !/^\s*[-*]\s+/.test(lines[index]) &&
        !/^\s*\d+\.\s+/.test(lines[index])
      ) {
        paragraph.push(lines[index]);
        index += 1;
      }
      out.push(`<p>${inlineMd(paragraph.join(' '))}</p>`);
    }

    return out.join('');
  }

  function statusBadge(status, label) {
    const meta = STATUS_META[status] || STATUS_META.local;
    return `<span class="badge badge-${meta.badge} badge-tight badge-dot">${esc(label || meta.label)}</span>`;
  }

  function num(value) {
    return Number(value).toLocaleString('zh-CN');
  }

  function folderLabel(folder) {
    return folder || '未分类';
  }

  function folderMatches(folder, selected) {
    if (!selected) return true;
    if (selected === '__unfiled__') return !folder;
    return !!folder && (folder === selected || folder.startsWith(selected + '/'));
  }

  function repoFolderPath(prefix, folder) {
    return `${prefix}/${folder || '未分类'}`;
  }

  function ensureExpanded(path) {
    if (!path || path === '__unfiled__') return;
    const parts = path.split('/');
    let current = '';
    parts.forEach((part) => {
      current = current ? `${current}/${part}` : part;
      state.expanded.add(current);
    });
  }

  function buildTree(items, getFolder) {
    const root = { children: new Map(), count: 0 };
    items.forEach((item) => {
      const folder = getFolder(item);
      if (!folder) return;
      const parts = folder.split('/').filter(Boolean);
      let node = root;
      node.count += 1;
      parts.forEach((part) => {
        if (!node.children.has(part)) {
          node.children.set(part, { name: part, path: '', children: new Map(), count: 0 });
        }
        node = node.children.get(part);
        node.count += 1;
      });
    });
    const assign = (node, parent) => {
      node.path = parent ? `${parent}/${node.name}` : node.name;
      node.children = new Map(
        [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh')),
      );
      node.children.forEach((child) => assign(child, node.path));
      return node;
    };
    return [...root.children.values()].map((node) => assign(node, ''));
  }

  function countUnfiled(items, getFolder) {
    return items.filter((item) => !getFolder(item)).length;
  }

  function allTags(prompts) {
    return [...new Set(prompts.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b, 'zh'));
  }

  function toast(message, options = {}) {
    const tone = options.tone || 'success';
    const title = options.title || { success: '操作完成', warning: '需要注意', danger: '已被拦截', info: '提示' }[tone];
    const root = $('#toast-root');
    const node = document.createElement('div');
    node.className = `toast ${tone}`;
    node.innerHTML = `
      <span class="toast-icon">${icon(tone === 'success' ? 'check' : tone === 'warning' ? 'alert' : tone === 'danger' ? 'lock' : 'info')}</span>
      <span class="toast-main"><strong>${esc(title)}</strong><p>${esc(message)}</p></span>
    `;
    root.appendChild(node);
    while (root.children.length > 3) root.firstElementChild.remove();
    setTimeout(() => {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 220);
    }, options.duration || 3200);
  }

  async function copyText(text, successMessage) {
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      try {
        const helper = document.createElement('textarea');
        helper.value = text;
        helper.setAttribute('readonly', '');
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        copied = document.execCommand('copy');
        helper.remove();
      } catch {
        copied = false;
      }
    }

    if (copied) {
      toast(successMessage || '已复制到剪贴板');
    } else {
      toast('复制失败，请检查浏览器剪贴板权限', { tone: 'danger' });
    }
    return copied;
  }

  function replaceTemplate(text, values) {
    return String(text ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name) =>
      values[name] !== undefined && values[name] !== '' ? values[name] : match,
    );
  }

  /* ------------------------------------------------------------------ */
  /* Theme + shell                                                      */
  /* ------------------------------------------------------------------ */

  function applyTheme() {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const resolved = state.theme === 'system' ? (prefersDark ? 'dark' : 'light') : state.theme;
    document.documentElement.dataset.theme = resolved;
    const button = $('#theme-toggle');
    if (button) {
      button.innerHTML = icon(resolved === 'dark' ? 'sun' : 'moon');
      const next = state.theme === 'light' ? '暗色' : state.theme === 'dark' ? '跟随系统' : '亮色';
      button.title = `当前：${state.theme === 'system' ? '跟随系统' : state.theme === 'dark' ? '暗色' : '亮色'} · 切换到${next}`;
      button.setAttribute('aria-label', button.title);
    }
    localStorage.setItem('pk_hifi_theme', state.theme);
  }

  function renderShell() {
    const nav = $('#nav');
    nav.innerHTML = NAV.map((item) => {
      const active = state.page === item.id;
      const count =
        item.id === 'prompts'
          ? state.prompts.length
          : item.id === 'instructions'
            ? state.contracts.length
            : item.id === 'skills'
              ? state.skills.length
              : item.id === 'mcp'
                ? state.mcps.length
                : item.id === 'sync'
                  ? D.counts.sync
                  : null;
      return `
        <button type="button" class="nav-item ${active ? 'active' : ''}" data-action="navigate" data-page="${item.id}"
          ${active ? 'aria-current="page"' : ''} title="${esc(item.label)}${count !== null ? ` · ${count}` : ''}">
          ${icon(item.icon)}
          <span class="label">${esc(item.label)}</span>
          ${count !== null ? `<span class="count ${item.id === 'sync' ? 'warn' : ''}">${count}</span>` : ''}
          ${item.id === 'sync' ? '<span class="nav-warning" aria-hidden="true"></span>' : ''}
        </button>
      `;
    }).join('');

    const meta = PAGES[state.page];
    $('#page-title').textContent = meta.title;
    $('#page-subtitle').textContent = meta.subtitle;
    const search = $('#global-search');
    search.placeholder = meta.placeholder;
    search.value = state.search;
    applyTheme();
  }

  function navigate(page) {
    if (!PAGES[page]) return;
    if (state.page === page) return;
    state.page = page;
    state.search = '';
    state.mobileDetail = false;
    history.pushState({ page }, '', '#' + page);
    closeOverlay();
    render();
    $('#workspace').scrollTop = 0;
  }

  function render() {
    renderShell();
    renderWorkspace();
  }

  function renderWorkspace() {
    const workspace = $('#workspace');
    workspace.innerHTML = renderPage();
    workspace.scrollTop = 0;
  }

  function renderWorkspaceOnly() {
    $('#workspace').innerHTML = renderPage();
  }

  function renderPage() {
    switch (state.page) {
      case 'instructions':
        return renderInstructions();
      case 'skills':
        return renderSkills();
      case 'mcp':
        return renderMcp();
      case 'sync':
        return renderSync();
      case 'settings':
        return renderSettings();
      default:
        return renderPrompts();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Shared UI                                                          */
  /* ------------------------------------------------------------------ */

  function tabsHtml(tabs, active, actionName) {
    return `
      <div class="tabs" role="tablist">
        ${tabs
          .map(
            (tab) => `
          <button type="button" role="tab" aria-selected="${tab.value === active}"
            class="tab ${tab.value === active ? 'active' : ''}"
            data-action="${actionName}" data-value="${tab.value}">
            ${esc(tab.label)}
            ${tab.count !== undefined ? `<span class="count">${tab.count}</span>` : ''}
          </button>
        `,
          )
          .join('')}
      </div>
    `;
  }

  function emptyState({ iconName = 'folder', title, description, action = '' }) {
    return `
      <div class="empty">
        <span class="empty-icon">${icon(iconName)}</span>
        <strong>${esc(title)}</strong>
        ${description ? `<p>${esc(description)}</p>` : ''}
        ${action}
      </div>
    `;
  }

  function renderTree(items, getFolder, selected, action) {
    const tree = buildTree(items, getFolder);
    const unfiled = countUnfiled(items, getFolder);
    const renderNodes = (nodes, depth) =>
      nodes
        .map((node) => {
          const open = state.expanded.has(node.path);
          const active = selected === node.path;
          return `
            <div class="tree-row ${active ? 'active' : ''}" style="--d:${depth}">
              <button type="button" class="tree-caret ${node.children.size ? '' : 'invisible'}"
                data-action="toggle-folder" data-folder="${esc(node.path)}"
                aria-label="${open ? '收起' : '展开'} ${esc(node.name)}">
                ${icon(open ? 'chevron-down' : 'chevron-right')}
              </button>
              <button type="button" class="tree-target" data-action="${action}" data-folder="${esc(node.path)}" title="${esc(node.path)}">
                ${icon('folder')}
                <span class="tree-name">${esc(node.name)}</span>
                <span class="tree-count">${node.count}</span>
              </button>
            </div>
            ${open ? renderNodes([...node.children.values()], depth + 1) : ''}
          `;
        })
        .join('');

    return `
      <div class="tree-scroll">
        <div class="tree-row tree-all ${selected ? '' : 'active'}">
          <span class="tree-caret invisible"></span>
          <button type="button" class="tree-target" data-action="${action}" data-folder="">
            ${icon('grid')}
            <span class="tree-name">全部</span>
            <span class="tree-count">${items.length}</span>
          </button>
        </div>
        <div class="tree-sep"></div>
        ${renderNodes(tree, 0)}
        ${
          unfiled
            ? `
          <div class="tree-row ${selected === '__unfiled__' ? 'active' : ''}" style="--d:0">
            <span class="tree-caret invisible"></span>
            <button type="button" class="tree-target" data-action="${action}" data-folder="__unfiled__">
              ${icon('file')}
              <span class="tree-name">未分类</span>
              <span class="tree-count">${unfiled}</span>
            </button>
          </div>`
            : ''
        }
      </div>
    `;
  }

  /* ------------------------------------------------------------------ */
  /* Prompts                                                            */
  /* ------------------------------------------------------------------ */

  function filteredPrompts() {
    const query = state.search.trim().toLowerCase();
    let list = state.prompts.filter((prompt) => {
      if (state.favOnly && !prompt.favorite) return false;
      if (state.promptFolder && !folderMatches(prompt.folder, state.promptFolder)) return false;
      if (state.tagFilters.length && !state.tagFilters.every((tag) => prompt.tags.includes(tag))) return false;
      if (query) {
        const hay = [
          prompt.title,
          prompt.description,
          prompt.system,
          prompt.user,
          prompt.tags.join(' '),
          prompt.folder || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    list = list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (state.promptSort === 'title') return a.title.localeCompare(b.title, 'zh');
      if (state.promptSort === 'usage') return b.usage - a.usage;
      return b.updatedAt - a.updatedAt;
    });
    return list;
  }

  function groupByFolder(prompts) {
    const groups = new Map();
    prompts.forEach((prompt) => {
      const key = prompt.folder || '__unfiled__';
      if (!groups.has(key)) groups.set(key, { folder: prompt.folder, prompts: [] });
      groups.get(key).prompts.push(prompt);
    });
    return [...groups.values()].sort((a, b) => {
      if (a.folder === null) return 1;
      if (b.folder === null) return -1;
      return a.folder.localeCompare(b.folder, 'zh');
    });
  }

  function renderPrompts() {
    const listSubnav = `
      <div class="subnav">
        ${tabsHtml(
          [
            { value: 'mine', label: '我的 Prompt', count: state.prompts.length },
            { value: 'platform', label: '平台发现' },
          ],
          state.promptTab,
          'set-prompt-tab',
        )}
        <div class="subnav-right">
          ${
            state.promptTab === 'mine'
              ? `<span class="badge badge-info badge-tight">Git 可选同步</span>
                 <span>${state.prompts.filter((p) => p.sync === 'local').length} 条仅本机 · 不写入 Agent 目录</span>`
              : `<span class="badge badge-info badge-tight">平台来源</span><span>按需搜索、复制或保存到本地</span>`
          }
        </div>
      </div>
    `;

    if (state.promptTab === 'platform') {
      return `<div class="page">${listSubnav}<div class="content-scroll"><div class="page-wrap">${renderPlatformPrompts()}</div></div></div>`;
    }

    const prompts = filteredPrompts();
    const selected =
      prompts.find((prompt) => prompt.id === state.selectedPrompt) || prompts[0] || null;
    const tags = allTags(state.prompts);
    const hasFilter =
      !!state.search.trim() || state.favOnly || !!state.promptFolder || state.tagFilters.length > 0;

    return `
      <div class="page">
        ${listSubnav}
        <div class="workspace-body">
          <aside class="folders-pane" aria-label="Prompt 文件夹">
            <div class="pane-head">${icon('folder')}Prompt 文件夹</div>
            ${renderTree(state.prompts, (p) => p.folder, state.promptFolder, 'select-prompt-folder')}
            <div class="tree-foot">${icon('git-branch')}文件夹会原样映射为仓库目录</div>
          </aside>

          <div class="list-pane">
            <div class="list-toolbar">
              <div class="toolbar-row">
                <div class="select">
                  <select data-change="prompt-sort" aria-label="排序方式">
                    <option value="updated" ${state.promptSort === 'updated' ? 'selected' : ''}>按更新时间</option>
                    <option value="title" ${state.promptSort === 'title' ? 'selected' : ''}>按标题</option>
                    <option value="usage" ${state.promptSort === 'usage' ? 'selected' : ''}>按使用次数</option>
                  </select>
                  ${icon('chevron-down')}
                </div>
                <button type="button" class="toggle-square ${state.favOnly ? 'active' : ''}"
                  data-action="toggle-fav-filter" aria-pressed="${state.favOnly}" title="只看收藏" aria-label="只看收藏">
                  ${icon('star', 'icon-sm')}
                </button>
                <div class="segmented" role="group" aria-label="视图切换">
                  <button type="button" data-action="set-prompt-view" data-view="card"
                    class="${state.promptView === 'card' ? 'active' : ''}" title="卡片视图" aria-label="卡片视图" aria-pressed="${state.promptView === 'card'}">
                    ${icon('grid', 'icon-sm')}
                  </button>
                  <button type="button" data-action="set-prompt-view" data-view="table"
                    class="${state.promptView === 'table' ? 'active' : ''}" title="表格视图" aria-label="表格视图" aria-pressed="${state.promptView === 'table'}">
                    ${icon('sliders', 'icon-sm')}
                  </button>
                </div>
              </div>
              <div class="tag-scroll" role="group" aria-label="标签筛选">
                ${
                  tags.length
                    ? tags
                        .map(
                          (tag) => `
                            <button type="button" class="chip ${state.tagFilters.includes(tag) ? 'active' : ''}"
                              data-action="toggle-tag" data-tag="${esc(tag)}" aria-pressed="${state.tagFilters.includes(tag)}">#${esc(tag)}</button>
                          `,
                        )
                        .join('')
                    : '<span class="empty-hint">暂无标签</span>'
                }
              </div>
            </div>

            ${
              state.promptFolder
                ? `<div class="active-filter">${icon('folder')}<strong>${esc(folderLabel(state.promptFolder === '__unfiled__' ? null : state.promptFolder))}</strong>
                    <button type="button" data-action="clear-prompt-folder">返回全部</button></div>`
                : ''
            }

            <div class="list-scroll">
              ${renderPromptList(prompts, selected, hasFilter)}
            </div>

            <div class="list-foot">
              <span class="tabular">${prompts.length} / ${state.prompts.length} 条</span>
              ${hasFilter ? '<button type="button" class="link" data-action="clear-prompt-filters">清除筛选</button>' : ''}
              <button type="button" class="btn btn-outline btn-sm" data-action="new-prompt" title="新建 Prompt（快捷键 N）">
                ${icon('plus', 'icon-sm')}新建
              </button>
            </div>
          </div>

          <section class="detail-pane ${state.mobileDetail ? 'mobile-open' : ''}" id="detail-pane" aria-label="Prompt 详情">
            ${selected ? renderPromptDetail(selected) : renderPromptDetailEmpty(state.prompts.length > 0)}
          </section>
        </div>
      </div>
    `;
  }

  function renderPromptList(prompts, selected, hasFilter) {
    if (!prompts.length) {
      return hasFilter
        ? emptyState({
            iconName: 'search',
            title: '未找到匹配结果',
            description: '搜索词、标签、收藏或文件夹筛选可能过窄',
            action:
              '<button type="button" class="btn btn-outline btn-sm" data-action="clear-prompt-filters">清除全部筛选</button>',
          })
        : emptyState({
            iconName: 'message',
            title: '还没有 Prompt',
            description: '新建第一个 Prompt，用 {{变量名}} 定义模板变量',
            action:
              '<button type="button" class="btn btn-primary btn-sm" data-action="new-prompt">新建 Prompt</button>',
          });
    }

    if (state.promptView === 'table') {
      return `
        <table class="prompt-table">
          <thead><tr><th>标题</th><th style="width:88px">文件夹</th><th style="width:64px">版本</th><th style="width:52px">更新</th></tr></thead>
          <tbody>
            ${prompts
              .map(
                (prompt) => `
              <tr data-action="select-prompt" data-id="${prompt.id}" tabindex="0" role="button"
                class="${selected && selected.id === prompt.id ? 'active' : ''}">
                <td><span class="cell-title">
                  ${prompt.pinned ? icon('pin', 'icon-xs pin') : ''}
                  ${prompt.favorite ? icon('star', 'icon-xs star') : ''}
                  <span>${esc(prompt.title)}</span>
                </span></td>
                <td class="cell-muted">${esc(folderLabel(prompt.folder))}</td>
                <td class="cell-muted tabular">v${prompt.version}</td>
                <td class="cell-muted tabular">${esc(prompt.updatedLabel)}</td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      `;
    }

    const groups = groupByFolder(prompts);
    let index = 0;
    return groups
      .map(
        (group) => `
        <div class="group-head">
          ${icon('folder')}
          <strong>${esc(folderLabel(group.folder))}</strong>
          <span class="count">${group.prompts.length}</span>
          <span class="path">prompts/${esc(group.folder || '未分类')}</span>
        </div>
        <div class="card-stack">
          ${group.prompts
            .map((prompt) => {
              const active = selected && selected.id === prompt.id;
              const more = prompt.tags.length - 2;
              const node = `
                <button type="button" class="prompt-card ${active ? 'active' : ''}" style="--i:${index++}"
                  data-action="select-prompt" data-id="${prompt.id}" aria-pressed="${active}">
                  <div class="card-title-row">
                    <div class="card-title-main">
                      <div class="card-title">
                        <span class="text">${esc(prompt.title)}</span>
                        ${prompt.pinned ? icon('pin', 'icon-xs pin') : ''}
                        ${prompt.favorite ? icon('star', 'icon-xs star') : ''}
                      </div>
                      <div class="card-desc">${esc(prompt.description || '（无描述）')}</div>
                    </div>
                    <span class="card-time tabular">${esc(prompt.updatedLabel)}</span>
                  </div>
                  <div class="card-snippet">${esc(prompt.system || prompt.user)}</div>
                  <div class="card-meta">
                    <div class="tags">
                      ${prompt.tags.slice(0, 2).map((tag) => `<span class="badge badge-primary">${esc(tag)}</span>`).join('')}
                      ${more > 0 ? `<span class="more">+${more}</span>` : ''}
                      ${prompt.variables.length ? `<span class="badge badge-info">{ }×${prompt.variables.length}</span>` : ''}
                      ${statusBadge(prompt.sync, prompt.syncLabel)}
                    </div>
                    <span class="usage">用 ${prompt.usage} · v${prompt.version}</span>
                  </div>
                </button>
              `;
              return node;
            })
            .join('')}
        </div>
      `,
      )
      .join('');
  }

  function renderPromptDetail(prompt) {
    return `
      <div class="detail-header">
        <div class="detail-title-row">
          <button type="button" class="mobile-back" data-action="close-mobile-detail" aria-label="返回列表">${icon('chevron-left', 'icon-lg')}</button>
          <div class="detail-title-main">
            <div class="detail-eyebrow">${icon('message')}Prompt · ${esc(prompt.folder || '未分类')}</div>
            <h2 class="detail-title">${esc(prompt.title)}${prompt.pinned ? icon('pin', 'pin') : ''}</h2>
            <p class="detail-desc">${esc(prompt.description || '（无描述）')}</p>
          </div>
          <div class="detail-actions">
            <button type="button" class="btn btn-ghost btn-icon" data-action="toggle-prompt-favorite" data-id="${prompt.id}"
              title="${prompt.favorite ? '取消收藏' : '收藏'}" aria-label="${prompt.favorite ? '取消收藏' : '收藏'}" aria-pressed="${prompt.favorite}">
              ${icon('star', prompt.favorite ? 'star-fill' : '')}
            </button>
            <button type="button" class="btn btn-ghost btn-icon" data-action="toggle-prompt-pin" data-id="${prompt.id}"
              title="${prompt.pinned ? '取消置顶' : '置顶'}" aria-label="${prompt.pinned ? '取消置顶' : '置顶'}" aria-pressed="${prompt.pinned}">
              ${icon('pin', prompt.pinned ? 'pin-on' : '')}
            </button>
            <span class="divider"></span>
            <button type="button" class="btn btn-ghost btn-icon btn-ghost-danger" data-action="delete-prompt" data-id="${prompt.id}"
              title="删除" aria-label="删除 Prompt">${icon('trash')}</button>
          </div>
        </div>
        <div class="detail-chips">
          <span class="badge badge-neutral badge-tight">${icon('folder')}${esc(folderLabel(prompt.folder))}</span>
          ${prompt.tags.map((tag) => `<span class="badge badge-primary badge-tight">#${esc(tag)}</span>`).join('')}
          <span class="badge badge-outline badge-tight tabular">v${prompt.version}</span>
          <span class="badge badge-outline badge-tight tabular">用 ${prompt.usage} 次</span>
          ${statusBadge(prompt.sync, prompt.syncLabel)}
          <span class="detail-updated tabular">更新于 ${esc(prompt.updatedLabel)}</span>
        </div>
        <div class="repo-path">
          ${icon('git-branch')}<span>仓库文件</span>
          <code>${esc(prompt.repoPath)}</code>
        </div>
        <div class="detail-buttons">
          <button type="button" class="btn btn-primary" data-action="copy-prompt" data-id="${prompt.id}">${icon('copy')}复制 Prompt</button>
          <button type="button" class="btn btn-outline" data-action="test-prompt" data-id="${prompt.id}">${icon('flask')}AI 测试</button>
          <button type="button" class="btn btn-outline" data-action="edit-prompt" data-id="${prompt.id}">${icon('pencil')}编辑</button>
          <button type="button" class="btn btn-outline" data-action="sync-prompt" data-id="${prompt.id}">${icon('git-branch')}同步</button>
          <button type="button" class="btn btn-outline" data-action="prompt-versions" data-id="${prompt.id}">${icon('history')}版本</button>
        </div>
      </div>

      <div class="detail-body">
        ${
          prompt.system
            ? `<section>
                <div class="section-head">System Prompt</div>
                <div class="md-block">
                  <div class="md-card md">${md(prompt.system)}</div>
                  <button type="button" class="inline-edit" data-action="edit-prompt" data-id="${prompt.id}">${icon('pencil', 'icon-xs')}编辑</button>
                </div>
              </section>`
            : ''
        }
        <section>
          <div class="section-head">User Prompt</div>
          <div class="md-block">
            <div class="md-card md">${md(prompt.user)}</div>
            <button type="button" class="inline-edit" data-action="edit-prompt" data-id="${prompt.id}">${icon('pencil', 'icon-xs')}编辑</button>
          </div>
        </section>
        ${
          prompt.variables.length
            ? `<section>
                <div class="section-head">模板变量 <span class="badge badge-outline badge-tight">${prompt.variables.length}</span></div>
                <div class="var-list">
                  ${prompt.variables
                    .map(
                      (variable) => `<span class="var-chip">{{${esc(variable.name)}}}${
                        variable.type !== 'text' ? `<em>${esc(variable.type)}</em>` : ''
                      }</span>`,
                    )
                    .join('')}
                </div>
                <p class="hint-text">复制或测试时会弹表单填值；值保留 30 天自动记忆，不写入仓库。</p>
              </section>`
            : ''
        }
        <div class="note-strip">
          ${icon('shield')}
          <span>Prompt 正文会进入 AI 上下文。推送前会扫描高置信度凭据；含明文 Token 的版本会被阻断，必须替换为 <code>{{变量}}</code>。</span>
        </div>
      </div>
    `;
  }

  function renderPromptDetailEmpty(hasPrompts) {
    return emptyState({
      iconName: hasPrompts ? 'search' : 'message',
      title: hasPrompts ? '没有可显示的 Prompt' : '左侧选择一个 Prompt',
      description: hasPrompts ? '调整搜索或筛选条件后再试' : '新建后即可查看 System / User 正文与变量',
      action: hasPrompts
        ? '<button type="button" class="btn btn-outline btn-sm" data-action="clear-prompt-filters">清除筛选</button>'
        : '<button type="button" class="btn btn-primary btn-sm" data-action="new-prompt">新建 Prompt</button>',
    });
  }

  function renderPlatformPrompts() {
    const query = state.search.trim().toLowerCase();
    const categories = ['全部', ...new Set(D.platformPrompts.map((p) => p.category))];
    const items = D.platformPrompts.filter((item) => {
      if (state.platformCategory !== '全部' && item.category !== state.platformCategory) return false;
      if (query && ![item.title, item.description, item.tags.join(' ')].join(' ').toLowerCase().includes(query)) return false;
      return true;
    });

    return `
      <div class="store-toolbar">
        <div class="skills-head" style="margin:0">
          ${icon('layers')}<span>平台精选 <strong>${items.length}</strong> 条</span>
        </div>
        <div class="store-cats">
          ${categories
            .map(
              (category) => `<button type="button" class="chip ${state.platformCategory === category ? 'active' : ''}"
                data-action="set-platform-category" data-category="${esc(category)}">${esc(category)}</button>`,
            )
            .join('')}
        </div>
      </div>
      ${
        items.length
          ? `<div class="skills-grid">
              ${items
                .map(
                  (item, index) => `
                <article class="skill-card" style="--i:${index}">
                  <button type="button" class="skill-main" data-action="preview-platform-prompt" data-id="${item.id}">
                    <div class="skill-top">
                      <span class="skill-emoji">${icon('message', 'icon-lg')}</span>
                      <div style="min-width:0;flex:1">
                        <div class="skill-name">${esc(item.title)}</div>
                        <div class="skill-sub">${esc(item.author)} · 使用 ${num(item.uses)} 次</div>
                      </div>
                      <span class="badge badge-primary badge-tight">${esc(item.category)}</span>
                    </div>
                    <p class="skill-desc">${esc(item.description)}</p>
                  </button>
                  <div class="skill-foot">
                    <span class="skill-folder">${icon('clock', 'icon-xs')}<span>${esc(item.updatedLabel)}</span></span>
                    <div class="right">
                      <button type="button" class="btn btn-outline btn-xs" data-action="copy-platform-prompt" data-id="${item.id}">${icon('copy', 'icon-xs')}复制</button>
                      <button type="button" class="btn btn-soft btn-xs" data-action="save-platform-prompt" data-id="${item.id}">保存</button>
                    </div>
                  </div>
                </article>
              `,
                )
                .join('')}
            </div>`
          : emptyState({
              iconName: 'search',
              title: '没有匹配的平台 Prompt',
              description: '换一个分类或关键词试试',
              action: '<button type="button" class="btn btn-outline btn-sm" data-action="set-platform-category" data-category="全部">全部分类</button>',
            })
      }
    `;
  }

  /* ------------------------------------------------------------------ */
  /* Instructions                                                       */
  /* ------------------------------------------------------------------ */

  function filteredContracts() {
    const query = state.search.trim().toLowerCase();
    return state.contracts
      .filter((contract) => {
        if (state.contractFolder && !folderMatches(contract.folder, state.contractFolder)) return false;
        if (state.contractScope !== 'all' && contract.scope !== state.contractScope) return false;
        if (query) {
          const hay = [
            contract.title,
            contract.description,
            contract.body,
            contract.tags.join(' '),
            contract.folder || '',
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function projectTarget(contract, targetId) {
    const target = D.contractTargets.find((item) => item.id === targetId);
    if (!target) return null;
    return {
      ...target,
      status: target.statusByContract[contract.id] || 'missing',
    };
  }

  function renderInstructions() {
    const attention = D.contractTargets.reduce((count, target) => {
      return (
        count +
        Object.values(target.statusByContract).filter((status) => status === 'stale' || status === 'drifted')
          .length
      );
    }, 0);

    const subnav = `
      <div class="subnav">
        ${tabsHtml(
          [
            { value: 'library', label: '契约库', count: state.contracts.length },
            { value: 'preview', label: '生效预览' },
            { value: 'projections', label: '项目投影', count: attention },
            { value: 'global', label: '全局分发', count: 2 },
          ],
          state.instructionTab,
          'set-instruction-tab',
        )}
        <div class="subnav-right">
          <span class="badge badge-info badge-tight">Git 可选同步</span>
          <span>1 条仅本机 · 投影独立确认</span>
        </div>
      </div>
    `;

    const body =
      state.instructionTab === 'preview'
        ? `<div class="content-scroll"><div class="page-wrap">${renderResolvedPreview()}</div></div>`
        : state.instructionTab === 'projections'
          ? `<div class="content-scroll"><div class="page-wrap">${renderProjections()}</div></div>`
          : state.instructionTab === 'global'
            ? `<div class="content-scroll"><div class="page-wrap">${renderGlobalDispatch()}</div></div>`
            : renderInstructionLibrary();

    return `<div class="page">${subnav}${body}</div>`;
  }

  function renderInstructionLibrary() {
    const contracts = filteredContracts();
    const selected =
      contracts.find((contract) => contract.id === state.selectedContract) || contracts[0] || null;
    const hasFilter =
      !!state.search.trim() || !!state.contractFolder || state.contractScope !== 'all';

    return `
      <div class="workspace-body">
        <aside class="folders-pane" aria-label="指令文件夹">
          <div class="pane-head">${icon('folder')}指令文件夹</div>
          ${renderTree(state.contracts, (c) => c.folder, state.contractFolder, 'select-contract-folder')}
          <div class="tree-foot">${icon('git-branch')}仓库契约与项目投影分开管理</div>
        </aside>

        <div class="list-pane">
          <div class="list-toolbar">
            <div class="toolbar-row">
              <div class="select" style="flex:1">
                <select data-change="contract-scope" aria-label="按范围筛选">
                  <option value="all" ${state.contractScope === 'all' ? 'selected' : ''}>全部范围</option>
                  <option value="项目级" ${state.contractScope === '项目级' ? 'selected' : ''}>项目级</option>
                  <option value="路径级" ${state.contractScope === '路径级' ? 'selected' : ''}>路径级</option>
                </select>
                ${icon('chevron-down')}
              </div>
              <span class="badge badge-outline badge-tight tabular">${contracts.length} 条</span>
            </div>
          </div>

          ${
            state.contractFolder
              ? `<div class="active-filter">${icon('folder')}<strong>${esc(
                  folderLabel(state.contractFolder === '__unfiled__' ? null : state.contractFolder),
                )}</strong><button type="button" data-action="clear-contract-folder">返回全部</button></div>`
              : ''
          }

          <div class="list-scroll">
            ${
              contracts.length
                ? `<div class="card-stack">
                    ${contracts
                      .map((contract, index) => {
                        const active = selected && selected.id === contract.id;
                        return `
                          <button type="button" class="prompt-card ${active ? 'active' : ''}" style="--i:${index}"
                            data-action="select-contract" data-id="${contract.id}" aria-pressed="${active}">
                            <div class="card-title-row">
                              <div class="card-title-main">
                                <div class="card-title">
                                  <span class="text">${esc(contract.title)}</span>
                                  <span class="badge badge-outline badge-tight tabular">v${contract.version}</span>
                                </div>
                                <div class="card-desc">${esc(contract.description)}</div>
                              </div>
                              <span class="card-time">${esc(contract.updatedLabel)}</span>
                            </div>
                            <div class="card-meta" style="margin-top:7px">
                              <div class="tags">
                                <span class="badge badge-neutral">${icon('folder')}${esc(folderLabel(contract.folder))}</span>
                                <span class="badge badge-${contract.scope === '项目级' ? 'primary' : 'info'}">${esc(contract.scope)}</span>
                                <span class="badge badge-outline">优先级 ${contract.priority}</span>
                                ${statusBadge(contract.sync, contract.syncLabel)}
                              </div>
                            </div>
                            <div class="card-meta" style="margin-top:6px">
                              <span class="card-time" style="margin:0">${contract.targets.length} 个投影目标</span>
                              <span class="usage">仓库契约</span>
                            </div>
                          </button>
                        `;
                      })
                      .join('')}
                  </div>`
                : emptyState({
                    iconName: 'search',
                    title: hasFilter ? '未找到匹配契约' : '还没有 Agent 指令',
                    description: hasFilter ? '搜索词、文件夹或范围筛选可能过窄' : '新建一条 canonical 契约，再编译到各 Agent 原生格式',
                    action: hasFilter
                      ? '<button type="button" class="btn btn-outline btn-sm" data-action="clear-contract-filters">清除筛选</button>'
                      : '<button type="button" class="btn btn-primary btn-sm" data-action="new-contract">新建契约</button>',
                  })
            }
          </div>

          <div class="list-foot">
            <span class="tabular">${contracts.length} / ${state.contracts.length} 条</span>
            ${hasFilter ? '<button type="button" class="link" data-action="clear-contract-filters">清除筛选</button>' : ''}
            <button type="button" class="btn btn-outline btn-sm" data-action="new-contract" title="新建契约（快捷键 N）">
              ${icon('plus', 'icon-sm')}新建
            </button>
          </div>
        </div>

        <section class="detail-pane ${state.mobileDetail ? 'mobile-open' : ''}" aria-label="契约详情">
          ${
            selected
              ? renderContractDetail(selected)
              : emptyState({
                  iconName: 'file',
                  title: '左侧选择一条指令契约',
                  description: '查看生效范围、激活方式、目标投影与契约正文',
                })
          }
        </section>
      </div>
    `;
  }

  function renderContractDetail(contract) {
    const targets = contract.targets.map((targetId) => projectTarget(contract, targetId)).filter(Boolean);
    const scopeBadge = contract.scope === '项目级' ? 'primary' : 'info';

    return `
      <div class="detail-header">
        <div class="detail-title-row">
          <button type="button" class="mobile-back" data-action="close-mobile-detail" aria-label="返回列表">${icon('chevron-left', 'icon-lg')}</button>
          <div class="detail-title-main">
            <div class="detail-eyebrow">${icon('file')}Agent 指令 · ${esc(contract.folder)}</div>
            <h2 class="detail-title">${esc(contract.title)}
              <span class="badge badge-outline badge-tight tabular">v${contract.version}</span>
              ${statusBadge(contract.sync, contract.syncLabel)}
            </h2>
            <p class="detail-desc">${esc(contract.description)}</p>
          </div>
          <div class="detail-actions">
            <span class="detail-updated">更新于 ${esc(contract.updatedLabel)}</span>
            <span class="divider"></span>
            <button type="button" class="btn btn-ghost btn-icon btn-ghost-danger" data-action="delete-contract" data-id="${contract.id}"
              title="删除" aria-label="删除契约">${icon('trash')}</button>
          </div>
        </div>
        <div class="detail-chips">
          <span class="badge badge-neutral badge-tight">${icon('folder')}${esc(folderLabel(contract.folder))}</span>
          <span class="badge badge-${scopeBadge} badge-tight">${esc(contract.scope)}${contract.scope === '路径级' ? ' · src/' : ''}</span>
          <span class="badge badge-${contract.activation === '常驻' ? 'primary' : 'info'} badge-tight">${icon('file')}${esc(contract.activation)}</span>
          <span class="badge badge-outline badge-tight tabular">优先级 ${contract.priority}</span>
          ${contract.tags.map((tag) => `<span class="badge badge-primary badge-tight">#${esc(tag)}</span>`).join('')}
        </div>
        <div class="repo-path">${icon('git-branch')}<span>仓库文件</span><code>${esc(contract.repoPath)}</code></div>
        <div class="detail-buttons">
          <button type="button" class="btn btn-primary" data-action="copy-contract" data-id="${contract.id}">${icon('copy')}复制正文</button>
          <button type="button" class="btn btn-outline" data-action="edit-contract" data-id="${contract.id}">${icon('pencil')}编辑</button>
          <button type="button" class="btn btn-outline" data-action="contract-preview" data-id="${contract.id}">${icon('eye')}生效预览</button>
          <button type="button" class="btn btn-outline" data-action="contract-versions" data-id="${contract.id}">${icon('history')}版本</button>
          <button type="button" class="btn btn-outline" data-action="contract-sync" data-id="${contract.id}">${icon('git-branch')}同步</button>
        </div>
      </div>

      <div class="detail-body">
        <section class="info-grid">
          <div class="info-card"><div class="label">生效范围</div><div class="value">${esc(contract.scopeDesc)}</div></div>
          <div class="info-card"><div class="label">激活方式</div><div class="value">${esc(contract.activationDesc)}</div></div>
          <div class="info-card"><div class="label">仓库文件</div><div class="value mono">${esc(contract.repoPath)}</div><div class="hint">frontmatter 存文件夹 / 范围 / 激活 / 目标；正文即规范内容</div></div>
          <div class="info-card"><div class="label">全局目录投影</div><div class="value">${esc(contract.globalStatus)}</div><div class="hint">在「全局分发」中勾选多条指令与多个工具，路径可改写</div></div>
          <div class="info-card"><div class="label">Claude @import</div><div class="value mono">${contract.imports.length ? contract.imports.map((item) => '@' + item).join('\n') : '未配置'}</div><div class="hint">仅 CLAUDE.md 目标支持；其他目标忽略导入行</div></div>
          <div class="info-card"><div class="label">同步状态</div><div class="value">${statusBadge(contract.sync, contract.syncLabel)}</div><div class="hint">拉取、恢复与手动合并都必须逐条预览</div></div>
        </section>

        <section>
          <div class="section-head">目标与投影状态 <span class="badge badge-outline badge-tight">${targets.length} 个目标</span></div>
          <div class="target-grid">
            ${targets
              .map(
                (target) => `
                <div class="target-card">
                  <div class="target-top"><strong>${esc(target.label)}</strong>${statusBadge(target.status)}</div>
                  <div class="target-agent">${esc(target.agentName)}</div>
                  <code>${esc(target.path)}</code>
                  <div class="target-foot">
                    <span>${target.merge === 'single-file' ? '合并写入' : '独立文件'}</span>
                    ${target.status === 'stale' ? '<span class="warn">· 本地已更新，等待重新投影</span>' : ''}
                    ${target.status === 'drifted' ? '<span class="warn">· Agent 侧被手工修改</span>' : ''}
                  </div>
                </div>
              `,
              )
              .join('')}
          </div>
        </section>

        <section>
          <div class="section-head">契约正文 <span class="badge badge-outline badge-tight">每次会话可能进入上下文</span></div>
          <div class="md-card md">${md(contract.body)}</div>
        </section>

        <div class="note-strip">
          ${icon('shield')}
          <span>指令会被 Agent 自动读取。拉取、恢复与手动合并都必须逐条预览；推送前会扫描正文中的高置信度凭据。删除本地契约不会删除已投影的目标文件。</span>
        </div>
      </div>
    `;
  }

  function previewData() {
    const target = D.contractTargets.find((item) => item.id === state.previewTarget);
    const path = state.previewPath;
    const globCompatible = ['cursor', 'windsurf', 'copilot-path'].includes(target.id);
    const included = [];
    const skipped = [];
    state.contracts.forEach((contract) => {
      if (!contract.targets.includes(target.id)) {
        if (contract.activation === 'Glob' && globCompatible) {
          skipped.push({ contract, reason: '目标不包含该契约，未写入此文件' });
        }
        return;
      }
      if (contract.activation === '常驻') {
        included.push({ contract, reason: '常驻指令，按优先级合并' });
      } else if (contract.activation === 'Glob') {
        if (!globCompatible) {
          skipped.push({ contract, reason: `目标 ${target.label} 不支持 Glob 激活，投影时跳过` });
        } else if (/^src\//.test(path)) {
          included.push({ contract, reason: `路径 ${path} 命中 src/**/*.{ts,tsx}` });
        } else {
          skipped.push({ contract, reason: `路径 ${path} 未命中 src/**/*.{ts,tsx}` });
        }
      } else if (contract.activation === '模型判断') {
        skipped.push({ contract, reason: '由 Agent 根据 description 判断是否引用，不计入常驻上下文' });
      } else {
        skipped.push({ contract, reason: '手动引用，不计入常驻上下文' });
      }
    });

    const bytes = included.reduce((sum, entry) => sum + new Blob([entry.contract.body]).size, 0);
    return { target, included, skipped, bytes, maxBytes: 32768 };
  }

  function renderResolvedPreview() {
    const { target, included, skipped, bytes, maxBytes } = previewData();
    const filePath = state.previewTarget === 'agents-md' ? 'AGENTS.md' : target.path;
    const extension =
      state.previewTarget === 'cursor'
        ? '.mdc'
        : state.previewTarget === 'windsurf'
          ? '.md'
          : state.previewTarget === 'copilot-path'
            ? '.instructions.md'
            : '';
    const directory = target.path.includes('/')
      ? target.path.slice(0, target.path.lastIndexOf('/') + 1)
      : '';
    const compiledFiles =
      target.merge === 'single-file'
        ? [{ path: filePath, entries: included }]
        : included.map((entry) => ({
            path: `${directory}${entry.contract.id.replace(/^c-/, '')}${extension}`,
            entries: [entry],
          }));
    const samples = [
      'src/components/PromptDetail.tsx',
      'src/lib/contracts.ts',
      'docs/interaction-design.md',
      'README.md',
    ];

    return `
      <div class="page-wrap" style="padding:0">
        <div class="banner" style="margin-bottom:12px">
          ${icon('eye')}
          <span>这是静态模拟：按目标工具的已知发现路径、激活方式与合并规则计算「当前路径实际会读到什么」，不调用各工具 CLI。优先级与上下文预算为近似值，最终以工具实际行为为准。</span>
        </div>

        <section class="preview-filter">
          <div class="field">
            <label class="field-label">目标格式</label>
            <div class="select">
              <select data-change="preview-target">
                ${D.contractTargets
                  .map(
                    (item) => `<option value="${item.id}" ${item.id === state.previewTarget ? 'selected' : ''}>${esc(item.label)} · ${esc(item.agentName)}</option>`,
                  )
                  .join('')}
              </select>
              ${icon('chevron-down')}
            </div>
          </div>
          <div class="field grow">
            <label class="field-label">当前处理的文件路径</label>
            <input class="input mono" value="${esc(state.previewPath)}" data-change="preview-path" aria-label="当前处理的文件路径" />
            <div class="sample-paths" style="margin-top:5px">
              ${samples
                .slice(0, 3)
                .map(
                  (sample) => `<button type="button" class="chip ${state.previewPath === sample ? 'active' : ''}"
                    data-action="set-preview-path" data-path="${esc(sample)}">${esc(sample.split('/').pop())}</button>`,
                )
                .join('')}
            </div>
          </div>
        </section>

        <div class="preview-meta" style="margin-top:8px">
          <span class="badge badge-primary badge-tight">${esc(target.label)}</span>
          <span class="badge badge-outline badge-tight">${target.merge === 'single-file' ? '合并写入' : '独立文件'}</span>
          <span>${esc(target.agentName)}；优先级按最近目录优先合并。</span>
        </div>

        <div class="preview-summary" style="margin-top:12px">
          <div class="summary-card">
            <span class="num" style="background:var(--primary-soft);color:var(--primary)">${included.length}</span>
            <div><div class="label">命中的常驻契约</div><div class="sub">按优先级顺序合并</div></div>
          </div>
          <div class="summary-card">
            <span class="num" style="background:var(--info-soft);color:var(--info)">${(bytes / 1024).toFixed(1)} KB</span>
            <div><div class="label">正文合计 / 预算</div><div class="sub">${(maxBytes / 1024).toFixed(0)} KB 上下文预算</div></div>
          </div>
          <div class="summary-card">
            <span class="num" style="background:var(--warning-soft);color:var(--warning)">${skipped.length}</span>
            <div><div class="label">未进入常驻上下文</div><div class="sub">模型判断 / 手动 / 不兼容</div></div>
          </div>
        </div>

        <div class="preview-grid" style="margin-top:12px">
          <section class="panel" style="align-self:start">
            <div class="panel-head">
              <h3>${icon('layers')}按生效顺序合并</h3>
              <span class="badge badge-outline badge-tight">${target.merge === 'single-file' ? '单文件合并' : '逐契约生成'}</span>
            </div>
            <div class="chain">
              ${
                included.length
                  ? included
                      .map(
                        (entry, index) => `
                    <div class="chain-item">
                      <span class="chain-num">${index + 1}</span>
                      <div class="chain-main">
                        <strong>${esc(entry.contract.title)}</strong>
                        <p>${esc(entry.reason)}</p>
                        <code>${esc(entry.contract.repoPath)}</code>
                      </div>
                      <span class="chain-size tabular">${(new Blob([entry.contract.body]).size / 1024).toFixed(1)} KB</span>
                    </div>
                  `,
                      )
                      .join('')
                  : '<p style="padding:20px;text-align:center;color:var(--muted-fg);font-size:10px">当前路径没有命中的常驻契约。</p>'
              }
            </div>
            ${
              skipped.length
                ? `<div class="skipped">
                    <h4>未计入常驻上下文（${skipped.length}）</h4>
                    ${skipped
                      .slice(0, 4)
                      .map(
                        (entry) => `
                      <div class="skip-item">
                        <strong>${esc(entry.contract.title)}</strong>
                        <p>${esc(entry.reason)}</p>
                      </div>
                    `,
                      )
                      .join('')}
                  </div>`
                : ''
            }
          </section>

          <section class="panel">
            <div class="panel-head">
              <h3>${icon('file')}编译后的目标文件</h3>
              <span class="badge badge-outline badge-tight">${compiledFiles.length} 个文件</span>
              <span class="sub" style="margin-left:auto">生成标记用于漂移检测；手工修改不会被静默覆盖</span>
            </div>
            <div class="panel-body">
              ${
                compiledFiles.length
                  ? compiledFiles
                      .map(
                        (file) => `
                    <div class="compiled-file">
                      <div class="compiled-head">${icon('file')}<code>${esc(file.path)}</code><span class="badge badge-outline badge-tight" style="margin-left:auto">${state.previewTarget}</span></div>
                      <pre>${esc(
                        `<!-- pk:begin · managed by Prompt Keeper -->\n` +
                          file.entries
                            .map(
                              (entry) =>
                                `<!-- contract: ${entry.contract.id} · ${entry.contract.title} · v${entry.contract.version} -->\n${entry.contract.body}\n`,
                            )
                            .join('\n') +
                          `<!-- pk:end -->`,
                      )}</pre>
                    </div>
                  `,
                      )
                      .join('') +
                    '<p class="hint-text">真实产品会按目标格式写入 frontmatter 或 managed block；手工修改会被标记为漂移，批量同步不会覆盖。</p>'
                  : '<p style="padding:28px;text-align:center;color:var(--muted-fg);font-size:10px">当前路径没有需要写入的文件。</p>'
              }
            </div>
          </section>
        </div>
      </div>
    `;
  }

  function renderProjections() {
    const rows = [];
    state.contracts.forEach((contract) => {
      contract.targets.forEach((targetId) => {
        const target = projectTarget(contract, targetId);
        if (!target) return;
        rows.push({ contract, target });
      });
    });
    rows.sort((a, b) => {
      const rank = { drifted: 0, stale: 1, missing: 2, synced: 3 };
      return rank[a.target.status] - rank[b.target.status];
    });
    const counts = {
      synced: rows.filter((row) => row.target.status === 'synced').length,
      stale: rows.filter((row) => row.target.status === 'stale').length,
      drifted: rows.filter((row) => row.target.status === 'drifted').length,
      missing: rows.filter((row) => row.target.status === 'missing').length,
    };

    return `
      <div class="banner" style="margin-bottom:12px">
        ${icon('folder')}
        <span>项目投影写入<b>项目根目录</b>，与「全局分发」写入<b>用户级目录</b>分开确认。单文件目标会与其他契约合并写入；目标文件被手工修改时标记漂移，禁止批量覆盖。</span>
      </div>

      <div class="preview-summary" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:12px">
        <div class="summary-card"><span class="num" style="background:var(--success-soft);color:var(--success)">${counts.synced}</span><div><div class="label">已同步</div><div class="sub">目标文件与契约一致</div></div></div>
        <div class="summary-card"><span class="num" style="background:var(--warning-soft);color:var(--warning)">${counts.stale}</span><div><div class="label">待更新</div><div class="sub">契约已更新，等待重新投影</div></div></div>
        <div class="summary-card"><span class="num" style="background:var(--danger-soft);color:var(--danger)">${counts.drifted}</span><div><div class="label">漂移</div><div class="sub">Agent 侧被手工修改</div></div></div>
        <div class="summary-card"><span class="num" style="background:var(--muted);color:var(--muted-fg)">${counts.missing}</span><div><div class="label">未投影</div><div class="sub">尚未生成目标文件</div></div></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>${icon('send')}项目投影记录</h3>
          <span class="badge badge-outline badge-tight">${rows.length} 条</span>
          <span class="sub">覆盖漂移项需要逐项确认</span>
          <button type="button" class="btn btn-outline btn-sm" style="margin-left:auto" data-action="reproject-all">${icon('refresh', 'icon-sm')}刷新投影状态</button>
        </div>
        <div class="panel-body" style="display:flex;flex-direction:column;gap:6px">
          ${rows
            .map(
              ({ contract, target }) => `
              <div class="projection-row">
                <div class="projection-main">
                  <div class="projection-title">
                    <strong>${esc(contract.title)}</strong>
                    <span class="badge badge-neutral badge-tight">${esc(target.label)}</span>
                    ${statusBadge(target.status)}
                    <span class="badge badge-outline badge-tight tabular">v${contract.version}</span>
                  </div>
                  <p>${esc(contract.activation)} · 优先级 ${contract.priority} · ${esc(target.agentName)}</p>
                  <code class="projection-path">${esc(target.path)}</code>
                </div>
                <div class="projection-actions">
                  ${
                    target.status === 'drifted'
                      ? '<button type="button" class="btn btn-danger btn-xs" data-action="projection-action" data-status="drifted">覆盖</button>'
                      : `<button type="button" class="btn btn-outline btn-xs" data-action="projection-action" data-status="${target.status}">${
                          target.status === 'synced' ? '重新投影' : '投影'
                        }</button>`
                  }
                  <button type="button" class="btn btn-ghost btn-xs btn-ghost-danger" data-action="projection-action" data-status="remove">移除</button>
                </div>
              </div>
            `,
            )
            .join('')}
        </div>
      </div>
    `;
  }

  function renderGlobalDispatch() {
    const targets = D.globalTargets;
    const selectedTargets = targets.filter((target) => state.selectedGlobalTargets.has(target.id));
    const selectedContracts = state.contracts.filter((contract) =>
      state.selectedGlobalContracts.has(contract.id),
    );
    const allSelected = state.contracts.every((contract) => state.selectedGlobalContracts.has(contract.id));

    return `
      <div class="banner" style="margin-bottom:12px">
        ${icon('send')}
        <span>全局分发是<b>从本地库到本机 Agent 全局目录的单向写出</b>，不经过 Git，也不回写仓库。勾选多条指令与多个工具后一次性投影；每个工具的全局目录都可以改成你本机的真实路径。</span>
      </div>

      <section style="margin-bottom:12px">
        <div class="panel-head" style="padding:0 0 7px;border:0">
          <h3>${icon('server')}全局目录（可改写）</h3>
          <span class="badge badge-outline badge-tight">${targets.length} 个 Agent</span>
          <span class="sub">路径修改后，相关投影会标记为「待更新」</span>
        </div>
        <div class="global-grid">
          ${targets
            .map((target) => {
              const selected = state.selectedGlobalTargets.has(target.id);
              return `
                <div class="global-card ${selected ? 'selected' : ''}">
                  <div class="global-card-top">
                    <button type="button" class="checkbox ${selected ? 'checked' : ''}" data-action="toggle-global-target" data-id="${target.id}"
                      role="checkbox" aria-checked="${selected}" aria-label="选择 ${esc(target.label)}">${selected ? icon('check') : ''}</button>
                    <strong>${esc(target.label)}</strong>
                    <span class="badge badge-${target.detected ? 'success' : 'outline'} badge-tight">${target.detected ? '已检测' : '未检测'}</span>
                  </div>
                  <div class="global-sub">${esc(target.agentName)} · ${target.pathMode === 'file' ? '单文件' : '独立文件'} · 已投影 ${target.projected}</div>
                  <div class="global-path">
                    <input class="input" style="height:27px;font-family:var(--font-mono);font-size:9px"
                      value="${esc(state.globalPaths[target.id])}" data-change="global-path" data-id="${target.id}" aria-label="${esc(target.label)} 路径" />
                    <button type="button" class="btn btn-ghost btn-xs" data-action="reset-global-path" data-id="${target.id}"
                      ${state.globalPaths[target.id] === target.defaultPath ? 'disabled' : ''} title="恢复默认路径">默认</button>
                  </div>
                  <p class="global-note">${esc(target.pathMode === 'file' ? '多条契约用 managed block 合并写入。' : '每个契约生成一个独立文件。')}</p>
                </div>
              `;
            })
            .join('')}
        </div>
      </section>

      <section class="panel" style="margin-bottom:10px">
        <div class="panel-head">
          <h3>${icon('file')}选择要同步的指令</h3>
          <span class="badge badge-outline badge-tight">${state.contracts.length} 条可选</span>
          <button type="button" class="btn btn-outline btn-sm" style="margin-left:auto" data-action="toggle-all-global-contracts">
            ${allSelected ? '取消全选' : '全选当前'}
          </button>
        </div>
        <div class="select-list">
          ${state.contracts
            .map((contract) => {
              const active = state.selectedGlobalContracts.has(contract.id);
              return `
                <div class="select-row ${active ? 'active' : ''}" data-action="toggle-global-contract" data-id="${contract.id}" role="button" tabindex="0">
                  <button type="button" class="checkbox ${active ? 'checked' : ''}" role="checkbox" aria-checked="${active}" aria-label="选择 ${esc(contract.title)}">${active ? icon('check') : ''}</button>
                  <div class="select-main">
                    <strong>${esc(contract.title)}</strong>
                    <p>${esc(contract.description)}</p>
                    <div style="display:flex;gap:4px;margin-top:3px">
                      <span class="badge badge-neutral badge-tight">${icon('folder')}${esc(folderLabel(contract.folder))}</span>
                      <span class="badge badge-${contract.activation === '常驻' ? 'primary' : 'info'} badge-tight">${esc(contract.activation)}</span>
                      <span class="badge badge-outline badge-tight tabular">v${contract.version}</span>
                    </div>
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      </section>

      <div class="action-bar" style="margin-bottom:12px">
        <span class="summary">已选 <strong>${selectedContracts.length}</strong> 条指令 × <strong>${selectedTargets.length}</strong> 个全局目录</span>
        <span class="badge badge-warning badge-tight">1 个组合漂移，批量不会覆盖</span>
        <div class="right">
          <button type="button" class="btn btn-outline btn-sm" data-action="global-preview">${icon('eye', 'icon-sm')}预览写入内容</button>
          <button type="button" class="btn btn-primary btn-sm" data-action="global-project" ${selectedContracts.length && selectedTargets.length ? '' : 'disabled'}>
            ${icon('send', 'icon-sm')}投影所选
          </button>
        </div>
      </div>

      <section class="panel">
        <div class="panel-head">
          <h3>${icon('layers')}全局投影记录</h3>
          <span class="badge badge-outline badge-tight">${D.globalProjections.length} 条</span>
          <span class="sub">漂移项只能逐条覆盖；移除只影响本机文件</span>
        </div>
        <div class="panel-body" style="display:flex;flex-direction:column;gap:6px">
          ${D.globalProjections
            .map(
              (projection) => `
              <div class="projection-row">
                <div class="projection-main">
                  <div class="projection-title">
                    <strong>${esc(projection.contractTitle)}</strong>
                    <span class="badge badge-neutral badge-tight">${esc(projection.targetLabel)}</span>
                    ${statusBadge(projection.status, projection.statusLabel)}
                    <span class="badge badge-outline badge-tight tabular">${projection.version}</span>
                  </div>
                  <p>${esc(projection.at)} · ${esc(projection.note || '全局目录与本机库一致')}</p>
                  <code class="projection-path">${esc(projection.path)}</code>
                </div>
                <div class="projection-actions">
                  <button type="button" class="btn btn-outline btn-xs" data-action="global-projection-action" data-status="${projection.status}">
                    ${projection.status === 'drifted' ? '覆盖' : '重新投影'}
                  </button>
                  <button type="button" class="btn btn-ghost btn-xs btn-ghost-danger" data-action="global-projection-action" data-status="remove">移除</button>
                </div>
              </div>
            `,
            )
            .join('')}
        </div>
      </section>
    `;
  }

  /* ------------------------------------------------------------------ */
  /* Skills                                                             */
  /* ------------------------------------------------------------------ */

  function filteredSkills() {
    const query = state.search.trim().toLowerCase();
    return state.skills
      .filter((skill) => {
        if (state.skillFolder && !folderMatches(skill.folder, state.skillFolder)) return false;
        if (!query) return true;
        return [skill.name, skill.description, skill.tags.join(' '), skill.folder || '']
          .join(' ')
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => {
        const fa = a.folder || '\uffff';
        const fb = b.folder || '\uffff';
        return fa === fb ? a.name.localeCompare(b.name) : fa.localeCompare(fb, 'zh');
      });
  }

  function sourceBadge(source) {
    const map = {
      official: ['官方精选', 'primary'],
      community: ['社区', 'info'],
      import: ['导入', 'neutral'],
      scan: ['本地扫描', 'warning'],
    };
    const [label, variant] = map[source] || map.import;
    return `<span class="badge badge-${variant} badge-tight">${label}</span>`;
  }

  function renderSkills() {
    const skills = filteredSkills();
    const subnav = `
      <div class="subnav">
        ${tabsHtml(
          [
            { value: 'mine', label: '我的技能', count: state.skills.length },
            { value: 'store', label: '技能商店' },
          ],
          state.skillTab,
          'set-skill-tab',
        )}
        <div class="subnav-right">
          <span class="badge badge-info badge-tight">Git 可选同步</span>
          <span>一个技能一个目录 · skills/&lt;folder&gt;/&lt;name&gt;/</span>
        </div>
      </div>
    `;

    if (state.skillTab === 'store') {
      const categories = ['全部', ...new Set(D.storeSkills.map((skill) => skill.category))];
      const list = D.storeSkills.filter((skill) => {
        if (state.storeSource !== 'all' && skill.source !== state.storeSource) return false;
        if (state.storeCategory !== '全部' && skill.category !== state.storeCategory) return false;
        const query = state.search.trim().toLowerCase();
        if (query && ![skill.name, skill.description].join(' ').toLowerCase().includes(query)) return false;
        return true;
      });
      return `
        <div class="page">${subnav}
          <div class="content-scroll"><div class="page-wrap">
            <div class="store-toolbar">
              <div class="filter-pills">
                ${[
                  ['all', '全部'],
                  ['official', '官方精选'],
                  ['community', '社区'],
                ]
                  .map(
                    ([value, label]) => `<button type="button" class="${state.storeSource === value ? 'active' : ''}"
                      data-action="set-store-source" data-value="${value}">${label}</button>`,
                  )
                  .join('')}
              </div>
              <div class="store-cats">
                ${categories
                  .map(
                    (category) => `<button type="button" class="chip ${state.storeCategory === category ? 'active' : ''}"
                      data-action="set-store-category" data-category="${esc(category)}">${esc(category)}</button>`,
                  )
                  .join('')}
              </div>
            </div>
            ${
              list.length
                ? `<div class="skills-grid">
                    ${list
                      .map((skill, index) => {
                        const installed = state.skills.some((item) => item.name === skill.name);
                        return `
                        <article class="store-card" style="--i:${index}">
                          <div class="skill-top">
                            <span class="skill-emoji">${skill.emoji}</span>
                            <div style="min-width:0;flex:1">
                              <div class="skill-name">${esc(skill.name)}</div>
                              <div class="skill-sub tabular">${esc(skill.author)} · ${num(skill.downloads)} 次下载</div>
                            </div>
                            <span class="badge badge-${skill.source === 'official' ? 'primary' : 'info'} badge-tight">${skill.source === 'official' ? '官方' : '社区'}</span>
                          </div>
                          <p class="skill-desc">${esc(skill.description)}</p>
                          <div class="skill-foot">
                            ${
                              installed
                                ? '<span class="badge badge-success badge-tight">' + icon('check', 'icon-xs') + '已在我的技能</span>'
                                : `<button type="button" class="btn btn-outline btn-xs" data-action="open-install-wizard" data-id="${skill.id}">${icon('download', 'icon-xs')}安装</button>`
                            }
                            <span class="badge badge-neutral badge-tight" style="margin-left:auto">${esc(skill.category)}</span>
                          </div>
                        </article>
                      `;
                      })
                      .join('')}
                  </div>`
                : emptyState({ iconName: 'search', title: '未找到匹配技能', description: '换个关键词或来源筛选' })
            }
          </div></div>
        </div>
      `;
    }

    const hasFilter = !!state.search.trim() || !!state.skillFolder;
    return `
      <div class="page">${subnav}
        <div class="workspace-body">
          <aside class="folders-pane" aria-label="技能文件夹">
            <div class="pane-head">${icon('folder')}技能文件夹</div>
            ${renderTree(state.skills, (s) => s.folder, state.skillFolder, 'select-skill-folder')}
            <div class="tree-foot">${icon('git-branch')}一个技能一个目录，脚本随技能同步</div>
          </aside>
          <div style="min-width:0;flex:1;display:flex;flex-direction:column">
            <div style="min-height:0;flex:1;overflow-y:auto;padding:14px 16px 18px">
              <div class="skills-head">
                ${icon('grid')}<span>共 <strong>${skills.length}</strong> 个技能</span>
                ${
                  state.skillFolder
                    ? `<span class="badge badge-neutral badge-tight">${icon('folder')}${esc(folderLabel(state.skillFolder === '__unfiled__' ? null : state.skillFolder))}</span>
                       <button type="button" class="btn btn-ghost btn-xs" data-action="clear-skill-folder">返回全部</button>`
                    : ''
                }
                <span class="right">${icon('layers')}文件夹即仓库目录 · 安装后可编辑并进入待推送</span>
              </div>
              ${
                skills.length
                  ? `<div class="skills-grid">
                      ${skills
                        .map((skill, index) => {
                          const installed = Object.entries(skill.installs).filter(([, mode]) => mode !== 'external').length;
                          const external = Object.values(skill.installs).filter((mode) => mode === 'external').length;
                          return `
                          <article class="skill-card" style="--i:${index}">
                            <button type="button" class="skill-main" data-action="open-skill" data-id="${skill.id}">
                              <div class="skill-top">
                                <span class="skill-emoji">${skill.emoji}</span>
                                <div style="min-width:0;flex:1">
                                  <div class="skill-name">${esc(skill.name)}</div>
                                  <div class="skill-sub">v${esc(skill.version)} · ${esc(skill.author)}</div>
                                </div>
                                ${sourceBadge(skill.source)}
                              </div>
                              <p class="skill-desc">${esc(skill.description)}</p>
                            </button>
                            <div class="skill-foot">
                              <span class="skill-folder">${icon('folder', 'icon-xs')}<span>${esc(folderLabel(skill.folder))}</span></span>
                              <div class="right">
                                ${installed ? `<span class="badge badge-success badge-tight">${icon('check', 'icon-xs')}${installed} 平台</span>` : '<span class="badge badge-outline badge-tight">未分发</span>'}
                                ${external ? `<span class="badge badge-warning badge-tight">外部 ${external}</span>` : ''}
                                ${skill.pending ? '<span class="badge badge-warning badge-tight">待推送</span>' : ''}
                                <button type="button" class="skill-edit" data-action="open-skill" data-id="${skill.id}" title="查看 / 编辑" aria-label="编辑 ${esc(skill.name)}">${icon('pencil', 'icon-xs')}</button>
                              </div>
                            </div>
                          </article>
                        `;
                        })
                        .join('')}
                    </div>`
                  : emptyState({
                      iconName: 'grid',
                      title: hasFilter ? '未找到匹配技能' : '还没有技能',
                      description: hasFilter ? '换个关键词或文件夹试试' : '去技能商店安装，或从本地扫描导入',
                      action: hasFilter
                        ? '<button type="button" class="btn btn-outline btn-sm" data-action="clear-skill-filters">清除筛选</button>'
                        : '<button type="button" class="btn btn-primary btn-sm" data-action="set-skill-tab" data-value="store">去技能商店</button>',
                    })
              }
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ */
  /* MCP                                                                */
  /* ------------------------------------------------------------------ */

  function filteredMcps() {
    const query = state.search.trim().toLowerCase();
    return state.mcps.filter((server) => {
      if (state.mcpFav && !server.favorite) return false;
      if (state.mcpFolder && !folderMatches(server.folder, state.mcpFolder)) return false;
      if (query) {
        return [server.name, server.description, server.tags.join(' '), server.folder || '']
          .join(' ')
          .toLowerCase()
          .includes(query);
      }
      return true;
    });
  }

  function mcpConfig(server) {
    return JSON.stringify(server.config, null, 2);
  }

  function renderMcp() {
    const servers = filteredMcps();
    const selected =
      servers.find((server) => server.id === state.selectedMcp) || servers[0] || null;

    const subnav = `
      <div class="subnav">
        ${tabsHtml(
          [
            { value: 'mine', label: '我的库', count: state.mcps.length },
            { value: 'agents', label: 'Agent MCP' },
            { value: 'store', label: 'MCP 商店', count: D.mcpStore.length },
          ],
          state.mcpSection,
          'set-mcp-section',
        )}
        <div class="subnav-right">
          <span class="badge badge-info badge-tight">密钥仅本机</span>
          <span>一个 server 一个 JSON · 明文凭据禁止进 Git</span>
        </div>
      </div>
    `;

    if (state.mcpSection === 'agents') {
      return `<div class="page">${subnav}<div class="content-scroll"><div class="page-wrap">${renderAgentMcp()}</div></div></div>`;
    }

    if (state.mcpSection === 'store') {
      return `<div class="page">${subnav}<div class="content-scroll"><div class="page-wrap">${renderMcpStore()}</div></div></div>`;
    }

    return `
      <div class="page">
        ${subnav}
        <div class="workspace-body">
          <aside class="folders-pane" aria-label="MCP 文件夹">
            <div class="pane-head">${icon('folder')}MCP 文件夹</div>
            ${renderTree(state.mcps, (m) => m.folder, state.mcpFolder, 'select-mcp-folder')}
            <div class="tree-foot">${icon('lock')}env / headers 只同步占位符，密钥留在钥匙串</div>
          </aside>

          <div class="list-pane" style="width:370px">
            <div class="list-toolbar">
              <div class="toolbar-row">
                <button type="button" class="toggle-square ${state.mcpFav ? 'active' : ''}" data-action="toggle-mcp-fav-filter"
                  aria-pressed="${state.mcpFav}" title="只看收藏" aria-label="只看收藏">${icon('star', 'icon-sm')}</button>
                <span class="badge badge-outline badge-tight tabular">${servers.length} / ${state.mcps.length} 个服务</span>
                <button type="button" class="btn btn-outline btn-sm" style="margin-left:auto" data-action="new-mcp">
                  ${icon('plus', 'icon-sm')}新建
                </button>
              </div>
            </div>
            <div class="mcp-list">
              ${
                servers.length
                  ? servers
                      .map((server) => {
                        const active = selected && selected.id === server.id;
                        const distributed = Object.keys(server.installs).length;
                        return `
                          <div class="mcp-row ${active ? 'active' : ''}" data-action="select-mcp" data-id="${server.id}" role="button" tabindex="0">
                            <div class="mcp-row-top">
                              <strong>${esc(server.name)}</strong>
                              <span class="badge badge-${server.transport === 'stdio' ? 'neutral' : 'info'} badge-tight">${server.transport}</span>
                              ${server.health.some((issue) => issue.level === 'error') ? `<span class="badge badge-danger badge-tight">${icon('alert', 'icon-xs')}error</span>` : server.health.length ? `<span class="badge badge-warning badge-tight">${icon('alert', 'icon-xs')}warn</span>` : ''}
                              ${server.favorite ? icon('star', 'icon-xs star') : ''}
                              <span class="row-tools">
                                <button type="button" class="switch" role="switch" aria-checked="${server.enabled}"
                                  data-action="toggle-mcp" data-id="${server.id}" aria-label="${server.enabled ? '停用' : '启用'} ${esc(server.name)}"></button>
                              </span>
                            </div>
                            <p>${esc(server.description)}</p>
                            <div class="mcp-row-meta">
                              <span class="folder">${icon('folder', 'icon-xs')}<span>${esc(folderLabel(server.folder))}</span></span>
                              ${distributed ? `<span class="badge badge-success badge-tight">已分发 ${distributed}</span>` : ''}
                              ${!server.enabled ? '<span class="badge badge-warning badge-tight">已停用</span>' : ''}
                              <span class="time">${esc(server.updatedLabel)}</span>
                            </div>
                          </div>
                        `;
                      })
                      .join('')
                  : `<p style="padding:34px 14px;text-align:center;color:var(--muted-fg);font-size:10px">没有匹配的服务</p>`
              }
            </div>
          </div>

          <section class="detail-pane ${state.mobileDetail ? 'mobile-open' : ''}" aria-label="MCP 详情">
            ${selected ? renderMcpDetail(selected) : emptyState({ iconName: 'server', title: '左侧选择一个 MCP 服务', description: '查看脱敏配置、健康检查与分发状态' })}
          </section>
        </div>
      </div>
    `;
  }

  function renderAgentMcp() {
    const agents = D.agents.filter((agent) => agent.detected);
    return `
      <div class="banner" style="margin-bottom:12px">
        ${icon('server')}
        <span>这里展示各 Agent 已读取的 MCP 配置文件，包含本应用写入的条目与外部安装条目。反向导入会把外部条目纳入「我的库」，之后即可纳入版本与 Git 模板同步。</span>
      </div>
      <div class="global-grid">
        ${agents
          .map((agent) => {
            const managed = state.mcps.filter((server) => server.installs[agent.id]);
            const external = D.mcpExternal[agent.id] || [];
            return `
              <section class="panel">
                <div class="panel-head">
                  <span class="agent-avatar">${esc(agent.short)}</span>
                  <div style="min-width:0">
                    <h3 style="display:block">${esc(agent.name)}</h3>
                    <span class="sub" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono)">${esc(agent.mcpFile)}</span>
                  </div>
                  <span class="badge badge-success badge-tight" style="margin-left:auto">${managed.length} 个托管</span>
                </div>
                <div class="panel-body" style="display:flex;flex-direction:column;gap:5px">
                  ${
                    managed.length
                      ? managed
                          .map(
                            (server) => `
                            <div class="target-row" style="padding:6px 8px">
                              ${icon('server')}
                              <div class="info"><strong>${esc(server.name)}</strong><span>${server.transport} · 由 Prompt Keeper 写入</span></div>
                              <span class="badge badge-${server.enabled ? 'success' : 'warning'} badge-tight">${server.enabled ? '启用' : '停用'}</span>
                            </div>
                          `,
                          )
                          .join('')
                      : '<p class="hint-text" style="margin:0">还没有本应用管理的 MCP 条目。</p>'
                  }
                  ${external
                    .map(
                      (entry) => `
                      <div class="target-row" style="padding:6px 8px;border-style:dashed">
                        ${icon('server')}
                        <div class="info"><strong>${esc(entry.name)}</strong><span>${esc(entry.hint)}</span></div>
                        <button type="button" class="btn btn-outline btn-xs" data-action="import-external-mcp" data-agent="${agent.id}" data-name="${esc(entry.name)}">反向导入</button>
                      </div>
                    `,
                    )
                    .join('')}
                </div>
                <div class="panel-foot">
                  <span class="sub" style="font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(agent.mcpFile)}</span>
                  <button type="button" class="btn btn-ghost btn-xs" style="margin-left:auto" data-action="open-agent-mcp-config" data-agent="${agent.id}">打开配置</button>
                </div>
              </section>
            `;
          })
          .join('')}
      </div>
    `;
  }

  function renderMcpStore() {
    const query = state.search.trim().toLowerCase();
    const list = D.mcpStore.filter((item) => {
      if (!query) return true;
      return [item.name, item.description, item.whatItDoes].join(' ').toLowerCase().includes(query);
    });
    return `
      <div class="banner" style="margin-bottom:12px">
        ${icon('zap')}
        <span>从商店安装 MCP 会先展示完整配置与凭据字段；安装后只写入本机库，真实 Token 需要你填写并加密存储，仓库仍只同步 <code>${'${VAR}'}</code> 占位。</span>
      </div>
      <div class="store-toolbar">
        <div class="skills-head" style="margin:0">${icon('server')}<span>MCP 商店 <strong>${list.length}</strong> 个服务</span></div>
        <div class="store-cats"><span class="chip active">全部</span></div>
      </div>
      ${
        list.length
          ? `<div class="skills-grid">
              ${list
                .map(
                  (item, index) => `
                  <article class="store-card" style="--i:${index}">
                    <div class="skill-top">
                      <span class="skill-emoji">${icon('server', 'icon-lg')}</span>
                      <div style="min-width:0;flex:1">
                        <div class="skill-name">${esc(item.name)}</div>
                        <div class="skill-sub tabular">商店 · ${num(item.downloads)} 次安装</div>
                      </div>
                      <span class="badge badge-info badge-tight">${item.transport}</span>
                    </div>
                    <p class="skill-desc">${esc(item.description)}</p>
                    <div class="skill-foot">
                      <span class="skill-folder">${icon('key', 'icon-xs')}<span>${item.envDocs.length ? `${item.envDocs.length} 个凭据字段` : '无需凭据'}</span></span>
                      <div class="right">
                        <button type="button" class="btn btn-outline btn-xs" data-action="install-mcp-store" data-id="${item.id}">${icon('download', 'icon-xs')}安装</button>
                      </div>
                    </div>
                  </article>
                `,
                )
                .join('')}
            </div>`
          : emptyState({ iconName: 'search', title: '没有匹配的 MCP 服务', description: '换个关键词试试' })
      }
    `;
  }

  function renderMcpDetail(server) {
    const issues = server.health || [];
    const errorCount = issues.filter((issue) => issue.level === 'error').length;
    const managed = Object.keys(server.installs).length;
    const hasError = issues.some((issue) => issue.level === 'error');

    const tabContent =
      state.mcpTab === 'health'
        ? `
          <div style="display:flex;flex-direction:column;gap:7px">
            <div style="display:flex;align-items:center;gap:7px">
              ${
                hasError
                  ? `<span class="badge badge-danger badge-tight">${icon('alert', 'icon-xs')}${errorCount} 个错误 · ${issues.length - errorCount} 个警告</span>`
                  : issues.length
                    ? `<span class="badge badge-warning badge-tight">${icon('alert', 'icon-xs')}${issues.length} 个警告</span>`
                    : `<span class="badge badge-success badge-tight">${icon('check', 'icon-xs')}全部通过</span>`
              }
              <span style="color:var(--muted-fg);font-size:9.5px">检查项：命令存在性 / URL 合法性 / 必填 env / 凭据格式</span>
            </div>
            ${issues
              .map(
                (issue) => `
                <div class="health-card ${issue.level === 'error' ? 'error' : issue.level === 'info' ? 'info' : ''}">
                  ${icon('alert')}
                  <div><code>${esc(issue.field)}</code><p>${esc(issue.message)}</p></div>
                </div>
              `,
              )
              .join('')}
            ${!issues.length ? '<p class="hint-text">未发现静态问题。真实产品还会在 PATH 中探测命令、对远端 URL 做连通性探测。</p>' : ''}
          </div>
        `
        : state.mcpTab === 'deploy'
          ? `
            <div style="display:flex;flex-direction:column;gap:6px">
              <p class="hint-text" style="margin:0 0 3px">各平台配置文件中该服务的当前状态。真实产品基于 SHA-256 entry digest 识别「外部修改 / 双向冲突」。</p>
              ${D.mcpTargets
                .map(
                  (target) => `
                  <div class="target-row">
                    ${icon('file')}
                    <div class="info"><strong>${esc(target.name)}</strong><span>${esc(target.file)}</span></div>
                    ${
                      server.installs[target.id]
                        ? '<span class="badge badge-success badge-tight">已写入 · 本应用管理</span>'
                        : '<span class="badge badge-outline badge-tight">未创建</span>'
                    }
                  </div>
                `,
                )
                .join('')}
            </div>
          `
          : `
            <div style="display:flex;flex-direction:column;gap:9px">
              <div style="display:flex;flex-wrap:wrap;gap:6px">
                <button type="button" class="btn btn-outline btn-sm" data-action="copy-mcp-config" data-id="${server.id}">${icon('copy', 'icon-sm')}复制配置</button>
                <button type="button" class="btn btn-outline btn-sm" data-action="edit-mcp" data-id="${server.id}">${icon('pencil', 'icon-sm')}JSON / 表单编辑</button>
              </div>
              <div class="code-panel">
                <div class="code-panel-head">${icon('terminal')}${esc(server.repoPath)}</div>
                <pre>${esc(mcpConfig(server))}</pre>
              </div>
              <div class="note-strip">
                ${icon('shield')}
                <span>凭据字段（KEY / TOKEN / SECRET / PASSWORD / Authorization）以 AES-256-GCM 加密存于本机 SQLite，主密钥在系统钥匙串；界面回显一律 <code>[REDACTED]</code>，编辑时未改动的脱敏值沿用原值。</span>
              </div>
              <div>
                <label class="field-label" for="mcp-notes">个人备注（不产生版本）</label>
                <textarea class="textarea" id="mcp-notes" rows="2" data-change="mcp-notes" data-id="${server.id}" placeholder="记录 Token 轮换时间、使用注意事项…">${esc(server.notes || '')}</textarea>
              </div>
            </div>
          `;

    return `
      <div class="detail-header">
        <div class="detail-title-row">
          <button type="button" class="mobile-back" data-action="close-mobile-detail" aria-label="返回列表">${icon('chevron-left', 'icon-lg')}</button>
          <div class="detail-title-main">
            <div class="detail-eyebrow">${icon('server')}MCP Server · ${esc(server.folder)}</div>
            <h2 class="detail-title">${esc(server.name)}
              <span class="badge badge-${server.transport === 'stdio' ? 'neutral' : 'info'} badge-tight">${server.transport}</span>
              ${hasError ? `<span class="badge badge-danger badge-tight">${icon('alert', 'icon-xs')}健康检查 ${issues.length}</span>` : ''}
            </h2>
            <p class="detail-desc">${esc(server.description)}</p>
          </div>
          <div class="detail-actions">
            <button type="button" class="btn btn-ghost btn-icon" data-action="toggle-mcp-favorite" data-id="${server.id}"
              title="${server.favorite ? '取消收藏' : '收藏'}" aria-label="${server.favorite ? '取消收藏' : '收藏'}" aria-pressed="${server.favorite}">
              ${icon('star', server.favorite ? 'star-fill' : '')}
            </button>
            <span class="divider"></span>
            <button type="button" class="btn btn-ghost btn-icon btn-ghost-danger" data-action="delete-mcp" data-id="${server.id}"
              title="删除" aria-label="删除 MCP">${icon('trash')}</button>
          </div>
        </div>
        <div class="detail-chips">
          <span class="badge badge-neutral badge-tight">${icon('folder')}${esc(folderLabel(server.folder))}</span>
          <span class="badge badge-${server.source === 'manual' ? 'outline' : server.source === 'market' ? 'primary' : 'warning'} badge-tight">${
            server.source === 'manual' ? '手动创建' : server.source === 'market' ? '来自商店' : '导入'
          }</span>
          ${server.tags.map((tag) => `<span class="badge badge-primary badge-tight">#${esc(tag)}</span>`).join('')}
          <span class="badge badge-${server.enabled ? 'success' : 'warning'} badge-tight">${server.enabled ? '已启用' : '已停用'}</span>
          <span class="detail-updated">更新于 ${esc(server.updatedLabel)}</span>
        </div>
        <div class="repo-path">${icon('git-branch')}<span>仓库文件</span><code>${esc(server.repoPath)}</code></div>
        <div class="detail-buttons">
          <button type="button" class="btn btn-primary" data-action="deploy-mcp" data-id="${server.id}" ${server.enabled ? '' : 'disabled title="已停用的服务禁止分发"'}>
            ${icon('send')}应用到平台
          </button>
          <button type="button" class="btn btn-outline" data-action="edit-mcp" data-id="${server.id}">${icon('pencil')}编辑</button>
          <button type="button" class="btn btn-outline" data-action="mcp-versions" data-id="${server.id}">${icon('history')}版本（${server.version}）</button>
        </div>
      </div>

      <div class="mcp-tabs">
        ${[
          ['config', '配置（脱敏）'],
          ['health', `健康检查（${issues.length}）`],
          ['deploy', `分发状态（${managed}/${D.mcpTargets.length}）`],
        ]
          .map(
            ([value, label]) => `<button type="button" class="mcp-tab ${state.mcpTab === value ? 'active' : ''}"
              data-action="set-mcp-detail-tab" data-value="${value}">${label}</button>`,
          )
          .join('')}
      </div>
      <div class="detail-body">${tabContent}</div>
    `;
  }

  /* ------------------------------------------------------------------ */
  /* Sync                                                               */
  /* ------------------------------------------------------------------ */

  function activeChanges() {
    return D.syncChanges.filter((change) => !state.resolvedChanges.has(change.id));
  }

  function changeCounts() {
    const changes = activeChanges();
    const count = (direction) => changes.filter((change) => change.direction === direction).length;
    return {
      incoming: count('incoming'),
      outgoing: count('outgoing'),
      conflict: count('conflict'),
      blocked: changes.filter((change) => change.blocked).length,
    };
  }

  function renderSync() {
    const counts = changeCounts();
    const subnav = `
      <div class="subnav">
        ${tabsHtml(
          [
            { value: 'overview', label: '概览' },
            { value: 'changes', label: '变更', count: counts.incoming + counts.outgoing + counts.conflict },
            { value: 'deploy', label: '分发', count: 5 },
            { value: 'history', label: '历史' },
          ],
          state.syncTab,
          'set-sync-tab',
        )}
        <div class="subnav-right">
          ${icon('git-branch')}
          <span class="mono" style="font-size:9.5px">${D.repo.url} · ${D.repo.branch}</span>
          <span class="badge badge-success badge-tight">已连接</span>
        </div>
      </div>
    `;

    const body =
      state.syncTab === 'changes'
        ? `<div class="content-scroll"><div class="page-wrap">${renderSyncChanges()}</div></div>`
        : state.syncTab === 'deploy'
          ? `<div class="content-scroll"><div class="page-wrap">${renderSyncDeploy()}</div></div>`
          : state.syncTab === 'history'
            ? `<div class="content-scroll"><div class="page-wrap">${renderSyncHistory()}</div></div>`
            : `<div class="content-scroll"><div class="page-wrap">${renderSyncOverview()}</div></div>`;

    return `<div class="page">${subnav}${body}</div>`;
  }

  function renderSyncOverview() {
    const repo = D.repo;
    const counts = changeCounts();
    const detected = D.agents.filter((agent) => agent.detected);
    return `
      <div style="display:flex;flex-direction:column;gap:11px">
        <section class="sync-hero">
          <div class="sync-hero-inner">
            <span class="repo-mark">${icon('git-branch')}</span>
            <div class="sync-hero-copy">
              <div class="sync-hero-title">
                <h2>${esc(repo.url)}</h2>
                <span class="badge badge-neutral badge-tight">${esc(repo.visibility)}</span>
                <span class="badge badge-outline badge-tight">${icon('git-branch', 'icon-xs')}${esc(repo.branch)}</span>
              </div>
              <p>已连接 · 上次 fetch ${esc(repo.lastFetch)} · 上次合入 ${esc(repo.lastSync)} · ${esc(repo.auth)}</p>
              <div class="sync-hero-path">${esc(repo.localPath)}</div>
            </div>
            <div class="sync-hero-actions">
              <button type="button" class="btn btn-outline btn-sm" data-action="sync-fetch">${icon('refresh', 'icon-sm')}立即 fetch</button>
              <button type="button" class="btn btn-outline btn-sm" data-action="sync-push">${icon('arrow-up', 'icon-sm')}推送…</button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="sync-settings">${icon('sliders', 'icon-sm')}设置</button>
            </div>
          </div>
          <div class="sync-hero-meta">
            <span class="badge badge-info badge-tight">${icon('arrow-up', 'icon-xs')}领先远程 ${repo.ahead}</span>
            <span class="badge badge-warning badge-tight">${icon('arrow-down', 'icon-xs')}落后远程 ${repo.behind}</span>
            <span>${esc(repo.pushMode)} · ${esc(repo.autoFetch)}</span>
          </div>
        </section>

        <section class="policy-grid">
          <article class="policy-card">
            <div class="policy-top"><span class="policy-icon">${icon('grid')}</span><strong>Skills</strong><span class="badge badge-primary badge-tight">双向同步</span></div>
            <p>按文件夹写入 skills/&lt;folder&gt;/&lt;skill&gt;/SKILL.md；脚本随仓库双向进出，拉取后审核再分发。</p>
            <div class="policy-foot">2 待拉取 · 1 待推送</div>
          </article>
          <article class="policy-card">
            <div class="policy-top"><span class="policy-icon">${icon('server')}</span><strong>MCP</strong><span class="badge badge-info badge-tight">模板双向 · 密钥本机</span></div>
            <p>按文件夹写入 mcp/&lt;folder&gt;/&lt;name&gt;.json；仓库只存 ${'${VAR}'} 占位，真实 Token 留在本机钥匙串。</p>
            <div class="policy-foot">1 项被安全策略阻断</div>
          </article>
          <article class="policy-card">
            <div class="policy-top"><span class="policy-icon">${icon('message')}</span><strong>Prompts</strong><span class="badge badge-primary badge-tight">按 Prompt 参与</span></div>
            <p>frontmatter 存元数据与变量定义，正文分 System / User；私密 Prompt 可逐条设为仅本机。</p>
            <div class="policy-foot">5 条待处理 · 1 条仅本机</div>
          </article>
          <article class="policy-card">
            <div class="policy-top"><span class="policy-icon">${icon('file')}</span><strong>Agent 指令</strong><span class="badge badge-primary badge-tight">按契约参与</span></div>
            <p>仓库存 canonical .contract.md；项目投影与「本机全局目录」分发分开确认，全局路径可逐项改写。</p>
            <div class="policy-foot">4 条待处理 · 2 项阻断 · 1 条仅本机</div>
          </article>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>${icon('folder')}仓库目录结构 = 平台文件夹</h3>
            <span class="badge badge-outline badge-tight">不使用平台也能直接浏览</span>
          </div>
          <div class="panel-body">
            <div class="terminal">
              <div class="terminal-head">
                <span class="terminal-dot red"></span><span class="terminal-dot amber"></span><span class="terminal-dot green"></span>
                <span style="margin-left:5px">tony/ai-assets</span>
                <span>main · tree</span>
              </div>
              <pre><span class="tok-folder">prompts/</span><span class="tok-file">编程/代码质量/review.prompt.md</span>
<span class="tok-folder">instructions/</span><span class="tok-file">团队/前端/frontend.contract.md</span>
<span class="tok-folder">skills/</span><span class="tok-file">开发流程/Git/commit-helper/SKILL.md</span>
<span class="tok-folder">mcp/</span><span class="tok-file">开发/GitHub/github.json</span>

<span class="tok-dim"># 最后一级保持单文件约定</span>
<span class="tok-green">Prompt</span>  一条一个 .prompt.md
<span class="tok-green">指令</span>    一条一个 .contract.md
<span class="tok-green">Skill</span>   一个技能一个目录
<span class="tok-green">MCP</span>     一个 server 一个 .json</pre>
            </div>
          </div>
        </section>

        <button type="button" class="blocked-alert" data-action="sync-open-changes">
          ${icon('lock')}
          <span>
            <strong>${counts.blocked} 项资产包含明文凭据，推送已被阻断</strong>
            <p>前往「变更」处理 Prompt / 指令正文或 MCP env / headers 中的明文；真实值不会进入仓库。</p>
          </span>
          ${icon('chevron-right')}
        </button>

        <section class="stat-grid">
          <button type="button" class="stat-card" data-action="sync-open-changes">
            <div class="stat-top"><span class="stat-value info">${counts.incoming}</span><span class="label">待拉取</span>${icon('chevron-right', 'icon-xs chev')}</div>
            <div class="stat-hint">含 1 条 Prompt · 2 条指令 · 合入前需确认</div>
          </button>
          <button type="button" class="stat-card" data-action="sync-open-changes">
            <div class="stat-top"><span class="stat-value warning">${counts.outgoing}</span><span class="label">待推送</span>${icon('chevron-right', 'icon-xs chev')}</div>
            <div class="stat-hint">${counts.blocked} 项被阻断 · 本地改动待提交</div>
          </button>
          <button type="button" class="stat-card" data-action="sync-open-changes">
            <div class="stat-top"><span class="stat-value danger">${counts.conflict}</span><span class="label">冲突</span>${icon('chevron-right', 'icon-xs chev')}</div>
            <div class="stat-hint">双方都改过，禁止静默覆盖</div>
          </button>
          <button type="button" class="stat-card" data-action="sync-open-deploy">
            <div class="stat-top"><span class="stat-value primary">5</span><span class="label">分发待处理</span>${icon('chevron-right', 'icon-xs chev')}</div>
            <div class="stat-hint">3 过时 · 2 漂移</div>
          </button>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>${icon('grid')}本机 Agent</h3>
            <span class="badge badge-success badge-tight">已检测 ${detected.length}</span>
            <span class="sub">只向已安装的工具分发，避免制造空目录</span>
            <button type="button" class="btn btn-ghost btn-sm" style="margin-left:auto" data-action="redetect-agents">${icon('refresh', 'icon-sm')}重新检测</button>
            <button type="button" class="btn btn-outline btn-sm" data-action="sync-open-deploy">管理分发${icon('chevron-right', 'icon-sm')}</button>
          </div>
          <div class="panel-body">
            <div class="agent-grid">
              ${detected
                .map((agent, index) => `
                  <div class="agent-card">
                    <span class="agent-avatar">${esc(agent.short)}</span>
                    <div style="min-width:0;flex:1">
                      <div class="name">${esc(agent.name)}</div>
                      <div class="path">${esc(agent.skillDir || agent.mcpFile)}</div>
                    </div>
                    <span class="badge badge-${index === 1 || index === 3 ? 'warning' : 'success'} badge-tight">${index === 1 || index === 3 ? '1 待处理' : '正常'}</span>
                  </div>
                `)
                .join('')}
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>${icon('history')}最近同步</h3>
            <button type="button" class="btn btn-ghost btn-sm" style="margin-left:auto" data-action="sync-open-history">全部历史${icon('chevron-right', 'icon-sm')}</button>
          </div>
          <div class="panel-body">
            <div class="timeline">
              ${D.syncEvents
                .slice(0, 5)
                .map((event) => renderTimelineRow(event))
                .join('')}
            </div>
          </div>
        </section>
      </div>
    `;
  }

  function renderTimelineRow(event) {
    const iconMap = {
      fetch: 'refresh',
      review: 'eye',
      pull: 'arrow-down',
      push: 'arrow-up',
      conflict: 'alert',
      deploy: 'send',
      connect: 'git-branch',
    };
    return `
      <div class="timeline-row">
        <span class="timeline-icon ${event.tone}">${icon(iconMap[event.type] || 'git-branch')}</span>
        <div class="timeline-main"><strong>${esc(event.title)}</strong><p>${esc(event.detail)}</p></div>
        <span class="timeline-time">${esc(event.at)}</span>
      </div>
    `;
  }

  function renderSyncChanges() {
    const changes = activeChanges().filter((change) => change.direction === state.changesTab);
    const filtered =
      state.changesKind === 'all'
        ? changes
        : changes.filter((change) => change.kind === state.changesKind);
    const counts = changeCounts();

    return `
      <div style="display:flex;flex-direction:column;gap:11px">
        <div class="banner">
          ${icon('shield')}
          <span>仓库与本地库之间是三方合并：<b>远端（仓库）</b>、<b>本地（本机库）</b>、<b>基线（上次同步）</b>。任何一方单独修改都能自动前进；双方都改时进入「冲突」，禁止静默覆盖。</span>
        </div>

        <div class="filter-bar">
          ${tabsHtml(
            [
              { value: 'incoming', label: '待拉取', count: counts.incoming },
              { value: 'outgoing', label: '待推送', count: counts.outgoing },
              { value: 'conflict', label: '冲突', count: counts.conflict },
            ],
            state.changesTab,
            'set-changes-tab',
          )}
          <div class="filter-pills">
            ${[
              ['all', '全部'],
              ['prompt', 'Prompt'],
              ['contract', '指令'],
              ['skill', 'Skill'],
              ['mcp', 'MCP'],
            ]
              .map(
                ([value, label]) => `<button type="button" class="${state.changesKind === value ? 'active' : ''}"
                  data-action="set-changes-kind" data-value="${value}">${label}</button>`,
              )
              .join('')}
          </div>
          <span style="color:var(--muted-fg);font-size:9.5px">
            ${
              state.changesTab === 'incoming'
                ? 'Prompt 与 Agent 指令必须预览全文后逐条接受'
                : state.changesTab === 'outgoing'
                  ? '推送前会再次扫描正文与 MCP env / headers'
                  : '可以选择采用仓库、保留本地，或手动合并后写入'
            }
          </span>
          <div style="margin-left:auto;display:flex;gap:5px">
            ${
              state.changesTab === 'incoming'
                ? '<button type="button" class="btn btn-primary btn-sm" data-action="accept-low-risk">接受低风险变更</button>'
                : state.changesTab === 'outgoing'
                  ? '<button type="button" class="btn btn-primary btn-sm" data-action="sync-push">推送所选…</button>'
                  : '<button type="button" class="btn btn-outline btn-sm" data-action="sync-open-history">查看历史</button>'
            }
          </div>
        </div>

        ${
          filtered.length
            ? `<div class="change-list">${filtered.map((change) => renderChangeRow(change)).join('')}</div>`
            : `<div class="panel"><div class="empty" style="min-height:240px">
                <span class="empty-icon">${icon(state.changesTab === 'conflict' ? 'check' : state.changesTab === 'incoming' ? 'arrow-down' : 'arrow-up')}</span>
                <strong>${state.changesTab === 'incoming' ? '没有待拉取的变更' : state.changesTab === 'outgoing' ? '没有待推送的本地改动' : '没有冲突'}</strong>
                <p>${state.changesTab === 'conflict' ? '同步状态良好；下次双方改动同一文件时会在这里提示。' : 'fetch 后新的远端差异会出现在这里。'}</p>
              </div></div>`
        }
      </div>
    `;
  }

  function renderChangeRow(change) {
    const assetIcon = { prompt: 'message', contract: 'file', skill: 'grid', mcp: 'server' }[change.kind];
    const assetLabel = { prompt: 'Prompt', contract: '指令', skill: 'Skill', mcp: 'MCP' }[change.kind];
    const directionVariant =
      change.direction === 'incoming' ? 'info' : change.direction === 'outgoing' ? 'warning' : 'danger';
    return `
      <article class="change-row ${change.direction === 'conflict' ? 'conflict' : ''} ${change.blocked ? 'blocked' : ''}">
        <span class="change-icon">${icon(change.blocked ? 'lock' : assetIcon)}</span>
        <div class="change-main">
          <div class="change-title">
            <strong>${esc(change.assetName)}</strong>
            <span class="badge badge-neutral badge-tight">${assetLabel}</span>
            <span class="badge badge-${directionVariant} badge-tight">${
              change.direction === 'incoming' ? '待拉取' : change.direction === 'outgoing' ? '待推送' : '冲突'
            }</span>
            <span class="badge badge-outline badge-tight">${esc(change.changeLabel)}</span>
            ${change.risk !== 'none' ? `<span class="badge badge-${change.risk === 'secrets' ? 'danger' : 'warning'} badge-tight">${icon(change.risk === 'secrets' ? 'lock' : 'alert', 'icon-xs')}${esc(change.riskLabel)}</span>` : ''}
            ${change.blocked ? '<span class="badge badge-danger badge-tight">已阻止推送</span>' : ''}
            <span class="version">${esc(change.versionLine)}</span>
          </div>
          <p>${esc(change.summary)}</p>
          <div class="change-path">
            <code>${esc(change.path)}</code>
            <span class="add">+${change.additions}</span>
            <span class="del">−${change.deletions}</span>
            ${change.files ? `<span>· ${esc(change.files)}</span>` : ''}
          </div>
        </div>
        <div class="change-actions">
          ${
            change.direction === 'incoming'
              ? `<button type="button" class="btn btn-outline btn-sm" data-action="review-change" data-id="${change.id}">
                  ${change.kind === 'prompt' || change.kind === 'contract' || change.risk !== 'none' ? '预览并接受' : '接受'}
                  ${icon('chevron-right', 'icon-sm')}
                </button>`
              : change.direction === 'outgoing'
                ? change.blocked
                  ? `<button type="button" class="btn btn-danger btn-sm" data-action="secret-change" data-id="${change.id}">${icon('lock', 'icon-sm')}处理密钥</button>`
                  : `<button type="button" class="btn btn-outline btn-sm" data-action="push-change" data-id="${change.id}">${icon('arrow-up', 'icon-sm')}推送</button>`
                : `<button type="button" class="btn btn-danger btn-sm" data-action="conflict-change" data-id="${change.id}">${icon('alert', 'icon-sm')}解决冲突</button>`
          }
        </div>
      </article>
    `;
  }

  function renderSyncDeploy() {
    const skills = state.skills.map((skill) => ({
      kind: 'skill',
      id: skill.id,
      name: skill.name,
      version: `v${skill.version}`,
      description: skill.description,
    }));
    const mcps = state.mcps.map((server) => ({
      kind: 'mcp',
      id: server.id,
      name: server.name,
      version: `v${server.version}`,
      description: server.description,
    }));
    const assets =
      state.deployKind === 'all'
        ? [...skills, ...mcps]
        : state.deployKind === 'skill'
          ? skills
          : mcps;
    const agents = D.agents.filter((agent) => agent.detected);

    const deploymentStatus = (asset, agentId) => {
      const deployment = D.deployments.find(
        (item) => item.kind === asset.kind && item.assetId === asset.id && item.agentId === agentId,
      );
      return deployment ? deployment.status : 'missing';
    };

    return `
      <div style="display:flex;flex-direction:column;gap:11px">
        <div class="banner">
          ${icon('send')}
          <span>分发层是<b>单向写出</b>：本地库 → 各 Agent 默认目录，不回写仓库。Agent 内被手工改过的文件标记为<b>漂移</b>，不会在批量同步中被覆盖；需要逐项确认。</span>
        </div>

        <div class="filter-bar">
          <div class="filter-pills">
            ${[
              ['all', '全部'],
              ['skill', 'Skills'],
              ['mcp', 'MCP'],
            ]
              .map(
                ([value, label]) => `<button type="button" class="${state.deployKind === value ? 'active' : ''}"
                  data-action="set-deploy-kind" data-value="${value}">${label}</button>`,
              )
              .join('')}
          </div>
          <span style="color:var(--muted-fg);font-size:9.5px">已检测 ${agents.length} 个 Agent · 过时 3 · 漂移 2</span>
          <div style="margin-left:auto;display:flex;gap:5px">
            <button type="button" class="btn btn-outline btn-sm" data-action="redetect-agents">${icon('refresh', 'icon-sm')}重新检测</button>
            <button type="button" class="btn btn-primary btn-sm" data-action="sync-all-stale">${icon('refresh', 'icon-sm')}同步全部过时（3）</button>
          </div>
        </div>

        <div class="matrix-wrap">
          <table class="matrix">
            <thead><tr><th>资产</th>${agents.map((agent) => `<th>${esc(agent.name)}<span class="path">${esc(agent.skillDir || agent.mcpFile)}</span></th>`).join('')}</tr></thead>
            <tbody>
              ${assets
                .map((asset) => {
                  return `<tr>
                    <td><div class="asset-cell">
                      <span class="asset-icon">${icon(asset.kind === 'skill' ? 'grid' : 'server')}</span>
                      <div><div class="asset-name">${esc(asset.name)} <span style="font-weight:400;color:var(--muted-fg-2)">${asset.version}</span></div><div class="asset-desc">${esc(asset.description)}</div></div>
                    </div></td>
                    ${agents
                      .map((agent) => {
                        const supported = !(asset.kind === 'skill' && !agent.skillDir) && !(asset.kind === 'mcp' && !agent.mcpFile);
                        if (!supported) return '<td><span style="color:var(--muted-fg-2);font-size:9px">不支持</span></td>';
                        const status = deploymentStatus(asset, agent.id);
                        const label = { synced: '已同步', stale: '过时', drifted: '漂移', missing: '未分发' }[status];
                        return `<td><button type="button" class="deploy-pill ${status}" data-action="open-deploy-cell" data-asset-kind="${asset.kind}" data-asset-id="${asset.id}" data-agent-id="${agent.id}">
                          ${icon(status === 'stale' ? 'refresh' : status === 'drifted' ? 'alert' : status === 'synced' ? 'check' : 'plus')}${label}
                        </button></td>`;
                      })
                      .join('')}
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>

        <p class="hint-text">默认以 symlink 发布，库内编辑即时生效；文件系统不支持时回退 copy 并逐条提示。分发目标路径按工具规范生成，已停用的 MCP 不允许分发。</p>
      </div>
    `;
  }

  function renderSyncHistory() {
    return `
      <div style="display:flex;flex-direction:column;gap:11px">
        <div class="banner">
          ${icon('history')}
          <span>所有 fetch、拉取、推送、冲突与分发都会留下可审计记录。真实产品把事件写入本机 SQLite，并保留每次写入的版本与目标路径。</span>
        </div>
        <div class="panel">
          <div class="panel-head">
            <h3>${icon('history')}同步历史</h3>
            <span class="badge badge-outline badge-tight">${D.syncEvents.length} 条</span>
            <span class="sub">最近 7 天</span>
          </div>
          <div class="panel-body">
            <div class="timeline">
              ${D.syncEvents.map((event) => renderTimelineRow(event)).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                           */
  /* ------------------------------------------------------------------ */

  function renderSettings() {
    const sections = [
      ['appearance', '外观'],
      ['sync-policy', '同步策略'],
      ['repo-layout', '仓库目录结构'],
      ['global-dirs', 'Agent 全局目录'],
      ['data', '数据'],
      ['about', '关于'],
    ];
    const themes = [
      ['light', '亮色', '固定使用亮色主题', 'sun'],
      ['dark', '暗色', '固定使用暗色主题', 'moon'],
      ['system', '跟随系统', '随操作系统外观自动切换', 'monitor'],
    ];

    return `
      <div class="content-scroll" style="height:100%">
        <div class="settings-layout">
          <aside class="settings-nav">
            <div class="label">设置</div>
            ${sections.map(([id, label]) => `<a href="#settings-${id}">${label}</a>`).join('')}
          </aside>
          <div class="settings-stack">
            <section class="settings-section" id="settings-appearance">
              <div class="settings-head">
                <span class="settings-icon">${icon('sun')}</span>
                <div><h2>外观</h2><p>主题立即生效并持久化到本机。</p></div>
              </div>
              <div class="settings-body">
                <div class="theme-grid">
                  ${themes
                    .map(
                      ([value, label, desc, iconName]) => `
                      <button type="button" class="theme-card ${state.theme === value ? 'active' : ''}"
                        data-action="set-theme" data-theme="${value}" aria-pressed="${state.theme === value}">
                        <div class="title">${icon(iconName)}${label}</div>
                        <p>${desc}</p>
                        ${state.theme === value ? `<span class="theme-check">${icon('check')}</span>` : ''}
                      </button>
                    `,
                    )
                    .join('')}
                </div>
              </div>
            </section>

            <section class="settings-section" id="settings-sync-policy">
              <div class="settings-head">
                <span class="settings-icon">${icon('git-branch')}</span>
                <div><h2>同步策略</h2><p>Git 仓库负责跨机器 / 跨团队共享；本机负责审核、投影与向各 Agent 分发。Prompt 与 Agent 指令默认跟随仓库策略，但每条都可以设为仅本机。</p></div>
              </div>
              <div class="settings-body">
                <dl class="kv-list">
                  <div class="kv-row"><dt>Skills</dt><dd class="primary">双向同步 · 按文件夹映射目录</dd></div>
                  <div class="kv-row"><dt>MCP</dt><dd class="info">一 server 一文件 · 密钥只存本机</dd></div>
                  <div class="kv-row"><dt>Prompts</dt><dd class="info">按文件夹映射 · 可设为仅本机</dd></div>
                  <div class="kv-row"><dt>Agent 指令</dt><dd class="info">仓库文件夹 + 项目投影 + 全局目录投影</dd></div>
                </dl>
                <p class="settings-note">仓库连接、拉取 / 推送、冲突解决与 Skill / MCP 分发统一在「同步」工作区完成；Agent 指令的投影与漂移在「Agent 指令」工作区完成。原型不会访问真实 Git 或文件系统。</p>
              </div>
            </section>

            <section class="settings-section" id="settings-repo-layout">
              <div class="settings-head">
                <span class="settings-icon">${icon('folder')}</span>
                <div><h2>仓库目录结构</h2><p>平台中的文件夹就是仓库目录；目录内可以继续建子文件夹，每个目录里保持单文件约定。</p></div>
              </div>
              <div class="settings-body">
                <div class="terminal">
                  <div class="terminal-head"><span class="terminal-dot red"></span><span class="terminal-dot amber"></span><span class="terminal-dot green"></span><span style="margin-left:5px">repository layout</span><span>v0.5</span></div>
                  <pre><span class="tok-folder">prompts/</span><span class="tok-file">&lt;分类&gt;/&lt;子分类&gt;/&lt;slug&gt;.prompt.md</span>
<span class="tok-folder">instructions/</span><span class="tok-file">&lt;分类&gt;/&lt;子分类&gt;/&lt;slug&gt;.contract.md</span>
<span class="tok-folder">skills/</span><span class="tok-file">&lt;分类&gt;/&lt;skill-name&gt;/SKILL.md</span>
<span class="tok-folder">mcp/</span><span class="tok-file">&lt;分类&gt;/&lt;server-name&gt;.json</span></pre>
                </div>
              </div>
            </section>

            <section class="settings-section" id="settings-global-dirs">
              <div class="settings-head">
                <span class="settings-icon">${icon('send')}</span>
                <div><h2>Agent 全局目录</h2><p>Agent 指令可以单独投影到本机 Agent 的用户级目录；路径可在「Agent 指令 → 全局分发」中逐项修改。</p></div>
              </div>
              <div class="settings-body">
                ${D.globalTargets
                  .map(
                    (target) => `
                    <div class="global-dir-row">
                      <strong>${esc(target.agentName)}</strong>
                      <span class="badge badge-neutral badge-tight">${target.pathMode === 'file' ? '单文件' : '独立文件'}</span>
                      <code>${esc(state.globalPaths[target.id])}</code>
                    </div>
                  `,
                  )
                  .join('')}
              </div>
            </section>

            <section class="settings-section" id="settings-data">
              <div class="settings-head">
                <span class="settings-icon">${icon('database')}</span>
                <div><h2>数据</h2><p>高保真原型的数据保存在浏览器内存，主题与视图偏好保存在 localStorage（键 pk_hifi_theme / pk_hifi_prompt_view）。</p></div>
              </div>
              <div class="settings-body">
                <button type="button" class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger-border)" data-action="reset-demo">
                  ${icon('refresh', 'icon-sm')}重置演示数据
                </button>
              </div>
            </section>

            <section class="settings-section" id="settings-about">
              <div class="settings-head">
                <span class="settings-icon">${icon('sparkles')}</span>
                <div><h2>关于</h2><p>Prompt Keeper 高保真原型 v0.5.0</p></div>
              </div>
              <div class="settings-body">
                <p style="color:var(--muted-fg);font-size:10px;line-height:17px">在 PromptHub（AGPL-3.0）v0.6.2 的 Prompt / Skill / MCP 管理域之上，增加 Git 仓库双向同步、多 Agent 分发层与 Agent 指令契约；v0.5 把四类资产统一为「文件夹即仓库目录」，并为 Agent 指令增加可改写路径的本机全局目录分发。</p>
                <p style="color:var(--muted-fg-2);font-size:9px;line-height:15px;margin-top:6px">本原型不含真实后端；Git 操作、投影、分发与 AI 响应均为模拟。交互设计依据 docs/interaction-design.md。</p>
              </div>
            </section>
          </div>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------------ */
  /* Overlay: modal + drawer                                            */
  /* ------------------------------------------------------------------ */

  let overlayState = null;

  function renderOverlay(content) {
    $('#overlay-root').innerHTML = content;
    const focusable = $('#overlay-root').querySelector(
      'input:not([type="hidden"]), textarea, select, button:not([disabled])',
    );
    if (focusable) focusable.focus();
  }

  function closeOverlay() {
    $('#overlay-root').innerHTML = '';
    overlayState = null;
    state.modalPromptId = null;
    if (state.wizard) state.wizard = null;
    if (state.deployModal) state.deployModal = null;
    if (state.deployCell) state.deployCell = null;
    if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
  }

  let lastFocused = null;

  function modalShell({ title, subtitle = '', body, footer = '', size = '', closeAction = 'close-modal' }) {
    return `
      <div class="overlay" data-overlay>
        <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
          <div class="modal-head">
            <div class="modal-head-main"><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
            <button type="button" class="modal-close" data-action="${closeAction}" aria-label="关闭">${icon('x', 'icon-sm')}</button>
          </div>
          <div class="modal-body">${body}</div>
          ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
        </div>
      </div>
    `;
  }

  function openModal(config) {
    lastFocused = document.activeElement;
    overlayState = { type: 'modal' };
    renderOverlay(modalShell(config));
  }

  function drawerShell({ title, subtitle = '', body, footer = '' }) {
    return `
      <div class="drawer-overlay" data-overlay>
        <div class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="drawer-head">
            <div class="modal-head-main"><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
            <button type="button" class="modal-close" data-action="close-modal" aria-label="关闭">${icon('x', 'icon-sm')}</button>
          </div>
          <div class="drawer-body">${body}</div>
          <div class="drawer-foot">${footer}</div>
        </div>
      </div>
    `;
  }

  function openDrawer(config) {
    lastFocused = document.activeElement;
    overlayState = { type: 'drawer' };
    renderOverlay(drawerShell(config));
  }

  /* ------------------------------------------------------------------ */
  /* Prompt modals                                                      */
  /* ------------------------------------------------------------------ */

  function openPromptForm(prompt) {
    const editing = !!prompt;
    const model = prompt || {
      title: '',
      description: '',
      folder: '',
      tags: [],
      system: '',
      user: '',
      variables: [],
    };
    const body = `
      <form class="form-grid" data-form="prompt" id="prompt-form">
        <input type="hidden" name="id" value="${esc(model.id || '')}" />
        <div class="form-row">
          <div>
            <label class="field-label" for="prompt-title">标题 *</label>
            <input class="input" id="prompt-title" name="title" value="${esc(model.title)}" placeholder="例如：代码审查助手" required />
          </div>
          <div>
            <label class="field-label" for="prompt-folder">文件夹</label>
            <input class="input mono" id="prompt-folder" name="folder" value="${esc(model.folder || '')}" placeholder="编程/前端" list="prompt-folders" />
            <datalist id="prompt-folders">${[...new Set(state.prompts.map((item) => item.folder).filter(Boolean))]
              .map((folder) => `<option value="${esc(folder)}"></option>`)
              .join('')}</datalist>
          </div>
        </div>
        <div>
          <label class="field-label" for="prompt-description">描述</label>
          <input class="input" id="prompt-description" name="description" value="${esc(model.description)}" placeholder="一句话说明用途与输出" />
        </div>
        <div>
          <label class="field-label" for="prompt-system">System Prompt</label>
          <textarea class="textarea" id="prompt-system" name="system" rows="4" placeholder="定义角色、约束与输出格式…">${esc(model.system)}</textarea>
        </div>
        <div>
          <label class="field-label" for="prompt-user">User Prompt</label>
          <textarea class="textarea" id="prompt-user" name="user" rows="4" placeholder="用 {{变量名}} 定义模板变量…">${esc(model.user)}</textarea>
        </div>
        <div>
          <label class="field-label" for="prompt-tags">标签（逗号分隔）</label>
          <input class="input" id="prompt-tags" name="tags" value="${esc(model.tags.join(', '))}" placeholder="编程, 代码审查" />
        </div>
        <p class="hint-text">文件夹会原样映射为仓库目录；保存后生成新版本并进入待推送。含明文凭据的正文会在推送前被阻断。</p>
      </form>
    `;
    openModal({
      title: editing ? '编辑 Prompt' : '新建 Prompt',
      subtitle: editing ? '保存后生成新版本，并在列表中标记待推送' : '用 {{变量名}} 定义模板变量，文件夹即仓库目录',
      size: 'wide',
      body,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
        <button type="submit" form="prompt-form" class="btn btn-primary">${icon('check')}${editing ? '保存修改' : '创建 Prompt'}</button>
      `,
    });
  }

  function openVariableForm(prompt) {
    state.selectedPrompt = prompt.id;
    state.modalPromptId = prompt.id;
    const fields = prompt.variables
      .map((variable) => {
        const id = `var-${variable.name}`;
        if (variable.type === 'textarea') {
          return `<div><label class="field-label" for="${id}">{{${esc(variable.name)}}}${variable.required ? ' *' : ''}</label>
            <textarea class="textarea" id="${id}" name="${esc(variable.name)}" rows="3" placeholder="${esc(variable.label || '填写内容')}"></textarea></div>`;
        }
        if (variable.type === 'select') {
          return `<div><label class="field-label" for="${id}">{{${esc(variable.name)}}}</label>
            <div class="select"><select id="${id}" name="${esc(variable.name)}">${(variable.options || [])
              .map((option) => `<option value="${esc(option)}">${esc(option)}</option>`)
              .join('')}</select>${icon('chevron-down')}</div></div>`;
        }
        return `<div><label class="field-label" for="${id}">{{${esc(variable.name)}}}${variable.required ? ' *' : ''}</label>
          <input class="input" id="${id}" name="${esc(variable.name)}" value="${esc(variable.example || '')}" placeholder="例如：${esc(variable.example || '填写内容')}" /></div>`;
      })
      .join('');

    openModal({
      title: `复制「${prompt.title}」`,
      subtitle: '填写模板变量；值仅在本机临时使用，不写入仓库',
      body: `<form class="form-grid" data-form="copy-variables" id="copy-form">${fields}</form>`,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
        <button type="submit" form="copy-form" class="btn btn-primary">${icon('copy')}复制到剪贴板</button>
      `,
    });
  }

  function openPromptVersions(prompt) {
    openModal({
      title: `版本历史 — ${prompt.title}`,
      subtitle: '恢复历史版本会另存当前内容为新版本，不会静默丢失修改',
      body: `
        <div>
          ${prompt.versions
            .map(
              (version) => `
              <div class="version-row ${version.current ? 'current' : ''}">
                <span class="version-num">v${version.v}</span>
                <div class="version-main">
                  <strong>${version.current ? '当前版本' : '历史版本'} · ${esc(version.note)}</strong>
                  <p>${esc(version.at)} · ${version.current ? '编辑于本机' : '可恢复'}</p>
                </div>
                ${version.current ? '<span class="badge badge-primary badge-tight">使用中</span>' : `<button type="button" class="btn btn-outline btn-xs" data-action="restore-prompt-version" data-id="${prompt.id}" data-version="${version.v}">恢复</button>`}
              </div>
            `,
            )
            .join('')}
        </div>
      `,
      footer: '<button type="button" class="btn btn-primary" data-action="close-modal">完成</button>',
    });
  }

  function openPromptTest(prompt) {
    state.selectedPrompt = prompt.id;
    state.modalPromptId = prompt.id;
    const fields = prompt.variables
      .map((variable) => {
        const id = `test-${variable.name}`;
        if (variable.type === 'textarea') {
          return `<div class="test-field"><label for="${id}">{{${esc(variable.name)}}}<code>textarea</code></label>
            <textarea class="textarea" id="${id}" name="${esc(variable.name)}" rows="3" placeholder="${esc(variable.label || '输入测试内容')}">function sum(items) { return items.reduce((a, b) => a + b, 0) }</textarea></div>`;
        }
        if (variable.type === 'select') {
          return `<div class="test-field"><label for="${id}">{{${esc(variable.name)}}}<code>select</code></label>
            <div class="select"><select id="${id}" name="${esc(variable.name)}">${(variable.options || [])
              .map((option) => `<option>${esc(option)}</option>`)
              .join('')}</select>${icon('chevron-down')}</div></div>`;
        }
        return `<div class="test-field"><label for="${id}">{{${esc(variable.name)}}}<code>text</code></label>
          <input class="input" id="${id}" name="${esc(variable.name)}" value="${esc(variable.example || '')}" placeholder="填写测试值" /></div>`;
      })
      .join('');

    openDrawer({
      title: `AI 测试 · ${prompt.title}`,
      subtitle: '模拟运行：变量填值后按模板渲染，不会调用真实模型',
      body: `
        <form data-form="test-prompt" id="test-form">
          <div class="test-controls">
            <div class="test-field">
              <label>测试模型</label>
              <div class="select"><select name="model"><option>GPT-5.2</option><option>Claude Sonnet 4.5</option><option>GLM-5.3 Flash</option><option>DeepSeek V4</option></select>${icon('chevron-down')}</div>
            </div>
            ${fields || '<p class="hint-text">该 Prompt 没有模板变量，将直接使用完整正文测试。</p>'}
            <button type="submit" class="btn btn-primary" style="margin-top:2px">${icon('play', 'icon-sm')}运行测试</button>
          </div>
        </form>
        <div id="test-result-area">
          <div class="note-strip" style="margin-top:12px">${icon('flask')}<span>运行后会在这里展示模拟输出、耗时与命中变量。真实产品会把渲染后的 Prompt 发送到所选模型。</span></div>
        </div>
      `,
      footer: '<button type="button" class="btn btn-outline" data-action="close-modal">关闭</button>',
    });
  }

  /* ------------------------------------------------------------------ */
  /* Contract modals                                                    */
  /* ------------------------------------------------------------------ */

  function openContractSync(contract) {
    openModal({
      title: `同步范围 — ${contract.title}`,
      subtitle: '仓库契约与本机库的能力边界',
      body: `
        <div class="form-grid">
          <div class="info-grid">
            <div class="info-card"><div class="label">当前状态</div><div class="value">${statusBadge(contract.sync, contract.syncLabel)}</div></div>
            <div class="info-card"><div class="label">仓库文件</div><div class="value mono">${esc(contract.repoPath)}</div></div>
          </div>
          <div>
            <span class="field-label">同步策略</span>
            <div class="choice-grid">
              <button type="button" class="choice active">
                ${icon('git-branch')}
                <span><strong>跟随仓库策略</strong><p>从 instructions/ 目录双向同步；推送前扫描凭据。</p></span>
              </button>
              <button type="button" class="choice">
                ${icon('file')}
                <span><strong>仅本机</strong><p>保留在本机库，不写入仓库；仍可项目投影与全局分发。</p></span>
              </button>
            </div>
          </div>
          <div class="note-strip">${icon('shield')}<span>契约正文会进入 Agent 上下文。拉取、恢复与手动合并都必须逐条预览；推送前会扫描高置信度凭据。</span></div>
        </div>
      `,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
        <button type="button" class="btn btn-primary" data-action="save-contract-sync">保存同步范围</button>
      `,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Skill modals                                                       */
  /* ------------------------------------------------------------------ */

  function skillPlatformRows(skill) {
    return SKILL_PLATFORMS.map((platform) => {
      const mode = skill.installs[platform.id];
      const installed = !!mode && mode !== 'external';
      return `
        <div class="target-row">
          ${icon('folder')}
          <div class="info">
            <strong>${esc(platform.name)}</strong>
            <span>${esc(platform.dir)}/${esc(skill.name)}/</span>
          </div>
          ${
            installed
              ? `<span class="badge badge-success badge-tight">已安装 · ${mode}</span>
                 <button type="button" class="btn btn-ghost btn-xs btn-ghost-danger" data-action="remove-skill-platform" data-skill="${skill.id}" data-platform="${platform.id}">移除</button>`
              : mode === 'external'
                ? '<span class="badge badge-warning badge-tight">外部安装</span>'
                : `<span class="badge badge-outline badge-tight">未安装</span>
                   <button type="button" class="btn btn-outline btn-xs" data-action="install-skill-platform" data-skill="${skill.id}" data-platform="${platform.id}">安装</button>`
          }
        </div>
      `;
    }).join('');
  }

  function renderSkillModal() {
    const skill = state.skills.find((item) => item.id === state.skillModalId);
    if (!skill) return;
    if (!$('#overlay-root').children.length) lastFocused = document.activeElement;
    overlayState = { type: 'modal' };
    const installed = Object.values(skill.installs).filter((mode) => mode !== 'external').length;
    const content =
      state.skillModalTab === 'platforms'
        ? `<div style="display:flex;flex-direction:column;gap:6px">
             <p class="hint-text" style="margin:0 0 3px">symlink 模式多工具共享同一份文件、改动即时同步；copy 模式各平台保留独立副本。</p>
             ${skillPlatformRows(skill)}
           </div>`
        : `<div class="md">${md(skill.instructions)}</div>`;

    $('#overlay-root').innerHTML = modalShell({
      title: `${skill.emoji} ${skill.name}`,
      subtitle: `${skill.description} · v${skill.version} · ${skill.author}`,
      size: 'wide',
      body: `
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-bottom:9px">
          <span class="badge badge-neutral badge-tight">${icon('folder')}${esc(folderLabel(skill.folder))}</span>
          ${sourceBadge(skill.source)}
          <span class="badge badge-outline badge-tight">${installed}/${SKILL_PLATFORMS.length} 平台</span>
          <code style="margin-left:auto;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:4px;background:var(--muted);padding:2px 6px;font-family:var(--font-mono);font-size:8.5px;color:var(--muted-fg)">${esc(skill.repoPath)}</code>
        </div>
        <div class="filter-pills" style="margin-bottom:9px">
          <button type="button" class="${state.skillModalTab === 'content' ? 'active' : ''}" data-action="set-skill-modal-tab" data-value="content">指令内容（SKILL.md）</button>
          <button type="button" class="${state.skillModalTab === 'platforms' ? 'active' : ''}" data-action="set-skill-modal-tab" data-value="platforms">分发平台（${installed}/${SKILL_PLATFORMS.length}）</button>
        </div>
        <div class="md-card" style="padding:12px 14px">${content}</div>
      `,
      footer: `
        <span class="left" style="margin-right:auto;color:var(--muted-fg-2);font-size:9px">安装于 3 天前 · 保存编辑后进入待推送</span>
        <button type="button" class="btn btn-outline btn-sm" data-action="toast-skill-edit">${icon('pencil', 'icon-sm')}编辑</button>
        <button type="button" class="btn btn-ghost btn-sm btn-ghost-danger" data-action="toast-skill-delete">${icon('trash', 'icon-sm')}删除</button>
        <button type="button" class="btn btn-outline btn-sm" data-action="toast-skill-versions">${icon('history', 'icon-sm')}版本</button>
        <button type="button" class="btn btn-primary btn-sm" data-action="close-modal">完成</button>
      `,
    });
  }

  function openSkillModal(id) {
    state.skillModalId = id;
    state.skillModalTab = 'content';
    lastFocused = document.activeElement;
    overlayState = { type: 'modal' };
    renderSkillModal();
  }

  function openInstallWizard(id) {
    const item = D.storeSkills.find((skill) => skill.id === id);
    if (!item) return;
    state.wizard = { item, step: 1, platforms: ['claude'], mode: 'symlink', installing: false };
    lastFocused = document.activeElement;
    overlayState = { type: 'modal' };
    renderWizard();
  }

  function renderWizard() {
    const wizard = state.wizard;
    if (!wizard) return;
    const { item, step } = wizard;
    const totalSize = item.files.reduce((sum, file) => sum + parseFloat(file.size), 0).toFixed(1);
    const steps = `
      <div class="install-steps" style="margin-bottom:10px">
        ${['审核内容', '选择平台', '安装结果']
          .map(
            (label, index) => `
            <span class="step ${step === index + 1 ? 'active' : ''} ${step > index + 1 ? 'done' : ''}">
              <span class="step-dot">${step > index + 1 ? icon('check', 'icon-xs') : index + 1}</span>${label}
            </span>
            ${index < 2 ? '<span class="step-line"></span>' : ''}
          `,
          )
          .join('')}
      </div>
    `;

    let body = '';
    let footer = '';

    if (step === 1) {
      body = `
        ${steps}
        <div class="banner" style="margin-bottom:9px">${icon('shield')}<span>安装前必须审核：以下内容将原样写入目标平台目录。</span></div>
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-bottom:8px">
          <span class="badge badge-neutral badge-tight">v${esc(item.version)}</span>
          <span class="badge badge-outline badge-tight">${item.files.length} 个文件</span>
          <span class="badge badge-outline badge-tight">共 ${totalSize} KB</span>
        </div>
        <div class="panel" style="margin-bottom:9px">
          ${item.files
            .map((file) => `<div class="target-row" style="border:0;border-bottom:1px solid var(--border);border-radius:0"><span style="font-family:var(--font-mono);font-size:9px">${esc(file.path)}</span><span style="margin-left:auto;color:var(--muted-fg);font-size:9px">${esc(file.size)}</span></div>`)
            .join('')}
        </div>
        <div class="md-card md" style="max-height:230px;overflow:auto">${md(item.instructions)}</div>
      `;
      footer = `
        <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
        <button type="button" class="btn btn-primary" data-action="wizard-next">内容无问题，继续${icon('chevron-right', 'icon-sm')}</button>
      `;
    } else if (step === 2) {
      body = `
        ${steps}
        <div class="form-grid">
          <div>
            <span class="field-label">目标平台（多选）</span>
            <div style="display:flex;flex-wrap:wrap;gap:5px">
              ${SKILL_PLATFORMS.map(
                (platform) => `
                <button type="button" class="chip ${wizard.platforms.includes(platform.id) ? 'active' : ''}"
                  data-action="wizard-toggle-platform" data-id="${platform.id}">
                  ${wizard.platforms.includes(platform.id) ? icon('check', 'icon-xs') : ''}${esc(platform.name)}
                </button>
              `,
              ).join('')}
            </div>
          </div>
          <div>
            <span class="field-label">安装模式</span>
            <div class="choice-grid">
              ${[
                ['symlink', 'symlink（推荐）', '库内编辑即时生效，多工具共享同一份'],
                ['copy', 'copy', '各平台独立副本，更新后需重新分发'],
              ]
                .map(
                  ([value, title, desc]) => `
                  <button type="button" class="choice ${wizard.mode === value ? 'active' : ''}" data-action="wizard-mode" data-value="${value}">
                    ${icon(value === 'symlink' ? 'link' : 'copy')}
                    <span><strong>${title}</strong><p>${desc}</p></span>
                  </button>
                `,
                )
                .join('')}
            </div>
          </div>
          <div class="note-strip">${icon('info')}<span>已选 ${wizard.platforms.length} 个平台；安装会写入各平台的技能目录，真实产品在 symlink 不受支持时回退 copy。</span></div>
        </div>
      `;
      footer = `
        <button type="button" class="btn btn-outline" data-action="wizard-back">返回审核</button>
        <button type="button" class="btn btn-primary" data-action="wizard-install" ${wizard.platforms.length && !wizard.installing ? '' : 'disabled'}>
          ${wizard.installing ? '<span class="spinner"></span>安装中…' : `确认安装（${wizard.platforms.length} 个平台）`}
        </button>
      `;
    } else {
      body = `
        ${steps}
        <div style="display:flex;flex-direction:column;gap:6px">
          ${wizard.platforms
            .map(
              (platformId) => {
                const platform = SKILL_PLATFORMS.find((item) => item.id === platformId);
                return `<div class="target-row"><span class="badge badge-success badge-tight">${icon('check', 'icon-xs')}</span><div class="info"><strong>${esc(platform.name)}</strong><span>${esc(platform.dir)}/${esc(item.name)}/</span></div><span class="badge badge-success badge-tight">已以 ${wizard.mode} 写入</span></div>`;
              },
            )
            .join('')}
        </div>
        <p class="hint-text">安装完成后技能出现在「我的技能」；保存编辑会生成版本并进入待推送。</p>
      `;
      footer = '<button type="button" class="btn btn-primary" data-action="wizard-finish">完成</button>';
    }

    $('#overlay-root').innerHTML = modalShell({
      title: `安装审核 — ${item.name}`,
      subtitle: `第 ${step} 步 · ${['审核技能内容', '选择目标平台', '安装结果'][step - 1]}`,
      size: 'wide',
      body,
      footer,
    });
  }

  /* ------------------------------------------------------------------ */
  /* MCP modals                                                         */
  /* ------------------------------------------------------------------ */

  function openMcpDeploy(server) {
    state.deployModal = server.id;
    state.deploySelected = new Set(Object.keys(server.installs));
    renderMcpDeployModal();
  }

  function renderMcpDeployModal() {
    const server = state.mcps.find((item) => item.id === state.deployModal);
    if (!server) return;
    const previewTarget = D.mcpTargets.find((target) => target.id === [...state.deploySelected][0]) || D.mcpTargets[0];
    const payload = {
      mcpServers: {
        [server.name]: {
          ...(server.transport === 'stdio'
            ? { command: server.command, args: server.args }
            : { url: server.url, headers: server.headers }),
          env: Object.fromEntries(Object.keys(server.env || {}).map((key) => [key, '[REDACTED]'])),
        },
      },
    };

    $('#overlay-root').innerHTML = modalShell({
      title: `分发到 Agent 平台 — ${server.name}`,
      subtitle: '应用会按平台规范改写其 MCP 配置文件；写入为原型模拟，不触碰真实文件',
      size: 'wide',
      body: `
        <div style="display:flex;flex-direction:column;gap:6px">
          ${D.mcpTargets
            .map(
              (target) => {
                const selected = state.deploySelected.has(target.id);
                const managed = !!server.installs[target.id];
                return `
                  <div class="target-row" style="border-color:${selected ? 'color-mix(in oklab, var(--primary) 50%, var(--border))' : 'var(--border)'};background:${selected ? 'color-mix(in oklab, var(--primary-soft) 30%, var(--card))' : 'var(--card)'}">
                    <button type="button" class="checkbox ${selected ? 'checked' : ''}" data-action="toggle-deploy-target" data-id="${target.id}" role="checkbox" aria-checked="${selected}" aria-label="选择 ${esc(target.name)}">${selected ? icon('check') : ''}</button>
                    <div class="info"><strong>${esc(target.name)}</strong><span>${esc(target.file)}</span></div>
                    ${managed ? '<span class="badge badge-success badge-tight">已由本应用管理</span>' : '<span class="badge badge-outline badge-tight">未创建</span>'}
                    <span class="badge badge-neutral badge-tight">${target.format}</span>
                  </div>
                `;
              },
            )
            .join('')}
        </div>
        <div style="margin-top:10px">
          <div style="display:flex;align-items:center;gap:5px;margin-bottom:4px">
            <span class="field-label" style="margin:0">写入预览 · ${esc(previewTarget.file)}</span>
            <span class="badge badge-outline badge-tight">${previewTarget.format}</span>
          </div>
          <div class="code-panel"><div class="code-panel-head">${icon('lock')}凭据 [REDACTED]</div><pre>${esc(JSON.stringify(payload, null, 2))}</pre></div>
        </div>
      `,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
        <button type="button" class="btn btn-primary" data-action="apply-mcp-deploy" ${state.deploySelected.size ? '' : 'disabled'}>
          ${icon('send')}应用到所选（${state.deploySelected.size}）
        </button>
      `,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Sync modals                                                        */
  /* ------------------------------------------------------------------ */

  function findChange(id) {
    return D.syncChanges.find((change) => change.id === id);
  }

  function openReviewChange(change) {
    if (change.kind === 'prompt' && change.risk === 'none') {
      // Prompt 必须逐条预览
    }
    const instruction = change.kind === 'prompt' || change.kind === 'contract';
    const body = `
      <div class="banner" style="margin-bottom:9px">
        ${icon(instruction ? 'eye' : 'shield')}
        <span>${
          instruction
            ? `<b>${change.kind === 'prompt' ? 'Prompt' : 'Agent 指令'}必须逐条预览</b>：会影响后续 AI 输出或每次会话，接受后只写入本机库，不会自动分发。`
            : '仓库内容会原样写入本机库；技能中的脚本可能被执行，请先读完。'
        }</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-bottom:8px">
        <span class="badge badge-neutral badge-tight">${change.kind === 'prompt' ? 'Prompt' : change.kind === 'contract' ? '指令' : change.kind === 'skill' ? 'Skill' : 'MCP'}</span>
        <span class="badge badge-outline badge-tight">${esc(change.versionLine)}</span>
        <span class="badge badge-outline badge-tight">1 个文件</span>
        <code style="overflow:hidden;max-width:100%;border-radius:4px;background:var(--muted);padding:2px 5px;font-family:var(--font-mono);font-size:8.5px;color:var(--muted-fg);text-overflow:ellipsis;white-space:nowrap">${esc(change.path)}</code>
      </div>
      <div class="code-panel" style="margin-bottom:9px">
        <div class="code-panel-head">${icon('git-branch')}仓库相对本地的变更</div>
        <pre><span class="tok-dim">--- 本地版本</span>
<span class="tok-dim">+++ 仓库版本</span>
- 本地当前：${esc(change.versionLine)}
+ 仓库改动：${esc(change.summary)}
<span class="tok-green">+ 已通过内容审核，可写入本机库</span></pre>
      </div>
      ${
        change.risk === 'scripts'
          ? '<div class="health-card" style="margin-bottom:9px">' + icon('alert') + '<div><code>scripts/</code><p>该技能包含可执行脚本；接受后不会自动分发，仍需在分发时确认目标路径。</p></div></div>'
          : ''
      }
      <label style="display:flex;align-items:flex-start;gap:7px;font-size:10px;line-height:15px;color:var(--fg-2)">
        <input type="checkbox" data-review-trust style="margin-top:2px;accent-color:var(--primary)" />
        <span>我已预览全文，确认内容安全且不含我的私密信息</span>
      </label>
    `;
    openModal({
      title: `预览并接受 — ${change.assetName}`,
      subtitle: instruction ? '接受后只写入本机库，不会自动分发到 Agent' : '仓库内容会原样写入本机库',
      size: 'wide',
      body,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">拒绝</button>
        <button type="button" class="btn btn-primary" data-action="accept-change" data-id="${change.id}" disabled>接受 ${change.kind === 'prompt' ? 'Prompt' : change.kind === 'contract' ? '指令' : '并写入本机'}</button>
      `,
    });
  }

  function openConflictChange(change) {
    state.conflictStrategy = 'remote';
    state.conflictChangeId = change.id;
    const versionText = change.versionLine
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);
    const remoteVersion = versionText[0]?.replace(/^仓库\s*/, '') || '—';
    const localVersion = versionText[1]?.replace(/^本地\s*/, '') || '—';
    const baseVersion = versionText[2]?.replace(/^基线\s*/, '') || '—';
    openModal({
      title: `解决冲突 — ${change.assetName}`,
      subtitle: '仓库与本地都修改了同一个文件；禁止静默覆盖',
      size: 'wide',
      body: `
        <div class="preview-summary" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:9px">
          <div class="summary-card"><span class="num" style="background:var(--muted);color:var(--muted-fg)">${esc(baseVersion)}</span><div><div class="label">基线（上次同步）</div><div class="sub">三方合并的共同起点</div></div></div>
          <div class="summary-card"><span class="num" style="background:var(--info-soft);color:var(--info)">${esc(remoteVersion)}</span><div><div class="label">仓库版本</div><div class="sub">远端文件的新改动</div></div></div>
          <div class="summary-card"><span class="num" style="background:var(--warning-soft);color:var(--warning)">${esc(localVersion)}</span><div><div class="label">本地版本</div><div class="sub">本机库的新改动</div></div></div>
        </div>
        <div class="choice-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:9px">
          ${[
            ['remote', '采用仓库', '丢弃本地改动，仓库成为新基线'],
            ['local', '保留本地', '保留本地内容，合并结果进入待推送'],
            ['manual', '手动合并', '逐段编辑，最安全但耗时'],
          ]
            .map(
              ([value, title, desc]) => `
              <button type="button" class="choice ${state.conflictStrategy === value ? 'active' : ''}" data-action="set-conflict-strategy" data-value="${value}">
                ${icon(value === 'remote' ? 'arrow-down' : value === 'local' ? 'file' : 'pencil')}
                <span><strong>${title}</strong><p>${desc}</p></span>
              </button>
            `,
            )
            .join('')}
        </div>
        <div class="code-panel">
          <div class="code-panel-head">${icon('git-branch')}三方改动对比</div>
          <pre><span class="tok-dim">@@ 基线 ${esc(baseVersion)} → 仓库 ${esc(remoteVersion)} / 本地 ${esc(localVersion)} @@</span>
+ 仓库版本：${esc(change.summary)}
- 本地版本：保留本地对同一文件的修改
<span class="tok-green">+ 手动合并时可以保留双方的有效改动</span>
<span class="tok-dim"># 应用后写入本地库并生成新版本，随后可在「待推送」推回仓库</span></pre>
        </div>
        <p class="hint-text">选择「采用仓库」会丢弃本地改动；选择「保留本地」或「手动合并」会把结果加入待推送。</p>
      `,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">稍后处理</button>
        <button type="button" class="btn btn-primary" data-action="resolve-conflict" data-id="${change.id}">${icon('check')}应用并标记已解决</button>
      `,
    });
  }

  function openSecretChange(change) {
    openModal({
      title: `明文凭据阻断推送 — ${change.assetName}`,
      subtitle: `${change.kind === 'prompt' ? 'Prompt' : change.kind === 'mcp' ? 'MCP' : '资产'} · ${change.path}`,
      size: 'wide',
      body: `
        <div class="health-card error" style="margin-bottom:9px">${icon('alert')}<div><p>检测到正文或 env / headers 中的疑似 Token。提交会把凭据永久写入 Git 历史，任何能读仓库的人都能看到。</p></div></div>
        <div class="code-panel" style="margin-bottom:9px">
          <div class="code-panel-head">${icon('terminal')}检测到的明文片段</div>
          <pre><span class="tok-dim">userPrompt:</span>
  "测试 Token：<span style="color:#ff9696">sk-live-8f3a2c9d4e5b6a71</span>"

<span class="tok-dim"># 将替换为</span>
  "测试 Token：<span class="tok-green">{{api_key}}</span>"</pre>
        </div>
        <ul style="padding-left:18px;color:var(--muted-fg);font-size:10px;line-height:17px">
          <li>正文中的原始 Token 会替换为 <code>{{api_key}}</code> 模板变量，变量定义随文件同步。</li>
          <li>真实值不写入 Prompt / 版本快照或仓库；复制或投影时由你临时填写。</li>
          <li>替换后可正常推送，本次提交仍会记录「曾发现明文」的审计事件。</li>
        </ul>
      `,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
        <button type="button" class="btn btn-primary" data-action="fix-secret" data-id="${change.id}">${icon('lock')}替换为模板变量</button>
      `,
    });
  }

  function openPushModal() {
    const rows = activeChanges().filter(
      (change) => change.direction === 'outgoing' && !change.blocked,
    );
    openModal({
      title: `推送到仓库 — ${rows.length} 项`,
      subtitle: `${D.repo.url} · ${D.repo.branch}`,
      size: 'wide',
      body: `
        <div class="form-grid">
          <div style="display:flex;flex-direction:column;gap:5px">
            ${rows
              .map(
                (change) => `
                <div class="target-row">
                  ${icon(change.kind === 'prompt' ? 'message' : change.kind === 'contract' ? 'file' : change.kind === 'skill' ? 'grid' : 'server')}
                  <div class="info"><strong>${esc(change.assetName)}</strong><span>${esc(change.path)}</span></div>
                  <span class="badge badge-warning badge-tight">待推送</span>
                </div>
              `,
              )
              .join('')}
          </div>
          <div>
            <label class="field-label" for="commit-message">提交信息 *</label>
            <input class="input" id="commit-message" value="chore: sync prompts, instructions, skills and MCP templates" />
          </div>
          <div>
            <span class="field-label">推送方式</span>
            <div class="choice-grid">
              <button type="button" class="choice active">${icon('git-branch')}<span><strong>独立分支 + PR（推荐）</strong><p>可评审、可回滚；不会直接改动主分支</p></span></button>
              <button type="button" class="choice">${icon('arrow-up')}<span><strong>直接推送到当前分支</strong><p>适合个人仓库；失败不会改写远端</p></span></button>
            </div>
          </div>
          <div class="note-strip">${icon('lock')}<span>推送前会再次扫描 Prompt / 指令正文与 MCP env / headers；发现明文凭据会阻断整个提交。</span></div>
        </div>
      `,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
        <button type="button" class="btn btn-primary" data-action="do-push">${icon('arrow-up')}推送 ${rows.length} 项</button>
      `,
    });
  }

  function openDeployCell(assetKind, assetId, agentId) {
    state.deployCell = { assetKind, assetId, agentId };
    const asset =
      assetKind === 'skill'
        ? state.skills.find((item) => item.id === assetId)
        : state.mcps.find((item) => item.id === assetId);
    const agent = D.agents.find((item) => item.id === agentId);
    if (!asset || !agent) return;
    const deployment = D.deployments.find(
      (item) => item.kind === assetKind && item.assetId === assetId && item.agentId === agentId,
    );
    const status = deployment ? deployment.status : 'missing';
    const targetPath = assetKind === 'skill' ? `${agent.skillDir}/${asset.name}/` : agent.mcpFile;
    const preview =
      assetKind === 'mcp'
        ? JSON.stringify(
            {
              mcpServers: {
                [asset.name]: {
                  ...(asset.transport === 'stdio'
                    ? { command: asset.command, args: asset.args }
                    : { url: asset.url, headers: asset.headers }),
                  env: Object.fromEntries(Object.keys(asset.env || {}).map((key) => [key, '[REDACTED]'])),
                },
              },
            },
            null,
            2,
          )
        : '';

    openModal({
      title: `${asset.name} → ${agent.name}`,
      subtitle: `${assetKind === 'skill' ? '技能' : 'MCP'} ${asset.version || ''} · 分发是单向写出，不修改仓库`,
      size: 'wide',
      body: `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          ${statusBadge(status, { synced: '已同步', stale: '过时', drifted: '漂移', missing: '未分发' }[status])}
          <span style="color:var(--muted-fg);font-size:9.5px">${
            deployment
              ? `当前 ${deployment.version} · 部署于 ${deployment.at}`
              : '该 Agent 目录中还没有此资产'
          }</span>
        </div>
        <div class="info-card" style="margin-bottom:8px"><div class="label">目标路径</div><div class="value mono">${esc(targetPath)}</div></div>
        ${
          deployment?.note
            ? `<div class="health-card" style="margin-bottom:8px">${icon('alert')}<div><p>${esc(deployment.note)}</p></div></div>`
            : ''
        }
        <span class="field-label">安装模式</span>
        <div class="choice-grid" style="margin-bottom:8px">
          <button type="button" class="choice active">${icon('link')}<span><strong>symlink（推荐）</strong><p>库内编辑即时生效，多工具共享同一份</p></span></button>
          <button type="button" class="choice">${icon('copy')}<span><strong>copy</strong><p>各 Agent 独立副本，更新后需重新分发</p></span></button>
        </div>
        ${
          preview
            ? `<div class="code-panel"><div class="code-panel-head">${icon('lock')}写入内容预览 · 凭据 [REDACTED]</div><pre>${esc(preview)}</pre></div>`
            : `<div class="note-strip">${icon('folder')}<span>目标目录：<code>${esc(targetPath)}</code></span></div>`
        }
      `,
      footer: `
        <button type="button" class="btn btn-ghost btn-ghost-danger left" data-action="remove-deploy">${icon('trash')}移除分发</button>
        <button type="button" class="btn btn-outline" data-action="close-modal">关闭</button>
        <button type="button" class="btn btn-primary" data-action="sync-deploy-cell">${icon('send')}${deployment ? '重新同步' : '分发到此 Agent'}</button>
      `,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Other modals                                                       */
  /* ------------------------------------------------------------------ */

  function openPlatformPreview(item) {
    openModal({
      title: item.title,
      subtitle: `${item.author} · ${item.category} · 使用 ${num(item.uses)} 次`,
      size: 'wide',
      body: `
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px">
          ${item.tags.map((tag) => `<span class="badge badge-primary badge-tight">#${esc(tag)}</span>`).join('')}
          <span class="badge badge-outline badge-tight">更新于 ${esc(item.updatedLabel)}</span>
        </div>
        <div class="md-card md">${md(item.preview + '\n\n## 输出结构\n- 先给结论与建议\n- 再列证据与风险\n- 最后给出下一步动作')}</div>
      `,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">关闭</button>
        <button type="button" class="btn btn-outline" data-action="copy-platform-prompt" data-id="${item.id}">${icon('copy')}复制</button>
        <button type="button" class="btn btn-primary" data-action="save-platform-prompt" data-id="${item.id}">保存到我的 Prompt</button>
      `,
    });
  }

  function openGlobalPreview() {
    const targets = D.globalTargets.filter((target) => state.selectedGlobalTargets.has(target.id));
    const contracts = state.contracts.filter((contract) => state.selectedGlobalContracts.has(contract.id));
    if (!targets.length || !contracts.length) {
      toast('请先选择指令与全局目录', { tone: 'warning' });
      return;
    }
    const files = targets.map((target) => {
      const body = contracts
        .filter((contract) => contract.targets.some((id) => id.includes('agents') || id === 'claude') || true)
        .map((contract) => `<!-- contract: ${contract.id} · ${contract.title} · v${contract.version} -->\n${contract.body}`)
        .join('\n\n');
      return {
        target,
        path: state.globalPaths[target.id] + (target.pathMode === 'dir' ? '/prompt-keeper.md' : ''),
        body,
      };
    });
    openModal({
      title: '全局目录写入预览',
      subtitle: '只显示即将写入本机 Agent 目录的文件；真实写入前还会检查路径与漂移',
      size: 'wide',
      body: files
        .map(
          (file) => `
          <div class="compiled-file" style="margin-bottom:8px">
            <div class="compiled-head">${icon('file')}<span style="font-size:9px;font-weight:550">${esc(file.target.label)}</span><span class="badge badge-outline badge-tight">${file.target.pathMode === 'file' ? '合并文件' : '独立文件'}</span><code style="margin-left:auto">${esc(file.path)}</code></div>
            <pre>${esc(`<!-- pk:begin · managed by Prompt Keeper -->\n${file.body}\n<!-- pk:end -->`)}</pre>
          </div>
        `,
        )
        .join(''),
      footer: '<button type="button" class="btn btn-outline" data-action="close-modal">关闭</button>',
    });
  }

  function openMcpStoreInstall(item) {
    openModal({
      title: `安装 MCP — ${item.name}`,
      subtitle: '安装前审核配置、启动命令与凭据字段；安装后只写入本机库',
      size: 'wide',
      body: `
        <div class="banner" style="margin-bottom:9px">${icon('shield')}<span>安装不会立即写入任何 Agent 配置；需要额外执行「应用到平台」，并在写入前确认目标路径。</span></div>
        <div class="form-grid">
          <div class="info-grid">
            <div class="info-card"><div class="label">传输方式</div><div class="value">${esc(item.transport)}</div></div>
            <div class="info-card"><div class="label">安装量</div><div class="value tabular">${num(item.downloads)} 次</div></div>
          </div>
          <div>
            <span class="field-label">功能说明</span>
            <p style="color:var(--muted-fg);font-size:10px;line-height:17px">${esc(item.whatItDoes)}</p>
          </div>
          <div>
            <span class="field-label">适用场景</span>
            <div class="var-list">
              ${item.useCases.map((useCase) => `<span class="var-chip" style="font-family:var(--font-sans)">${esc(useCase)}</span>`).join('')}
            </div>
          </div>
          <div>
            <span class="field-label">安装命令</span>
            <div class="code-panel"><div class="code-panel-head">${icon('terminal')}terminal</div><pre>${esc(item.installCommand)}</pre></div>
          </div>
          ${
            item.envDocs.length
              ? `<div>
                  <span class="field-label">凭据字段（安装后填写）</span>
                  <div style="display:flex;flex-direction:column;gap:5px">
                    ${item.envDocs
                      .map(
                        (doc) => `
                        <div class="target-row">
                          ${icon('key')}
                          <div class="info"><strong>${esc(doc.key)}</strong><span>${esc(doc.desc)}</span></div>
                          <span class="badge badge-warning badge-tight">必填</span>
                        </div>
                      `,
                      )
                      .join('')}
                  </div>
                </div>`
              : '<div class="note-strip">' + icon('check') + '<span>该 MCP 不需要额外凭据。</span></div>'
          }
          <div class="note-strip">${icon('lock')}<span>仓库只同步 <code>${'${VAR}'}</code> 占位；真实值用 AES-256-GCM 加密存在本机钥匙串，不进入版本快照。</span></div>
        </div>
      `,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
        <button type="button" class="btn btn-primary" data-action="confirm-install-mcp-store" data-id="${item.id}">${icon('download')}安装到我的库</button>
      `,
    });
  }

  function openExternalMcpImport(agent, name) {
    openModal({
      title: `反向导入 — ${name}`,
      subtitle: `${agent.name} · 从 Agent 配置读取的外部 MCP 条目`,
      size: 'wide',
      body: `
        <div class="form-grid">
          <div class="info-grid">
            <div class="info-card"><div class="label">来源</div><div class="value mono">${esc(agent.mcpFile)}</div></div>
            <div class="info-card"><div class="label">当前归属</div><div class="value">外部安装 · 未纳入我的库</div></div>
          </div>
          <div class="note-strip">${icon('info')}<span>反向导入只读取配置条目并复制到本机库，不会修改原 Agent 文件。导入后可生成版本、参与仓库模板同步，但真实凭据不会随导入复制。</span></div>
          <div>
            <span class="field-label">导入后的配置（脱敏）</span>
            <div class="code-panel"><div class="code-panel-head">${icon('terminal')}mcp / ${esc(name)}</div><pre>${esc(
              JSON.stringify(
                {
                  mcpServers: {
                    [name]: { command: 'npx', args: ['-y', name], env: {} },
                  },
                },
                null,
                2,
              ),
            )}</pre></div>
          </div>
        </div>
      `,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
        <button type="button" class="btn btn-primary" data-action="confirm-import-external-mcp" data-agent="${agent.id}" data-name="${esc(name)}">导入到我的库</button>
      `,
    });
  }

  function openRepoSettings() {
    openModal({
      title: '仓库设置',
      subtitle: 'tony/ai-assets · main',
      size: 'wide',
      body: `
        <div class="form-grid">
          <div class="info-grid">
            <div class="info-card"><div class="label">Provider</div><div class="value">GitHub · 私有仓库</div></div>
            <div class="info-card"><div class="label">认证</div><div class="value">${esc(D.repo.auth)}</div></div>
            <div class="info-card"><div class="label">自动 fetch</div><div class="value">${esc(D.repo.autoFetch)}</div></div>
            <div class="info-card"><div class="label">推送方式</div><div class="value">${esc(D.repo.pushMode)}</div></div>
          </div>
          <div class="info-card"><div class="label">本机克隆路径</div><div class="value mono">${esc(D.repo.localPath)}</div><div class="hint">真实产品为应用托管目录，不写入用户项目仓库。</div></div>
          <div class="note-strip">${icon('shield')}<span>仓库只存储四类资产与模板；真实密钥、全局目录路径与分发状态只保留在本机。</span></div>
        </div>
      `,
      footer: '<button type="button" class="btn btn-primary" data-action="close-modal">完成</button>',
    });
  }

  function openDeployModalForNew(assetId) {
    const agent = D.agents.find((item) => item.id === 'claude');
    openModal({
      title: `分发给 ${agent.name}`,
      subtitle: '选择安装模式；分发是单向写出',
      body: `
        <div class="form-grid">
          <div class="info-card"><div class="label">目标路径</div><div class="value mono">${esc(agent.skillDir)}/${esc(assetId)}/</div></div>
          <div class="choice-grid">
            <button type="button" class="choice active">${icon('link')}<span><strong>symlink（推荐）</strong><p>库内编辑即时生效</p></span></button>
            <button type="button" class="choice">${icon('copy')}<span><strong>copy</strong><p>独立副本，更新后需重新分发</p></span></button>
          </div>
        </div>
      `,
      footer: '<button type="button" class="btn btn-outline" data-action="close-modal">取消</button><button type="button" class="btn btn-primary" data-action="close-modal">确认分发</button>',
    });
  }

  /* ------------------------------------------------------------------ */
  /* Action handling                                                    */
  /* ------------------------------------------------------------------ */

  document.addEventListener('click', (event) => {
    const target = event.target;

    if (
      target instanceof HTMLElement &&
      (target.classList.contains('overlay') || target.classList.contains('drawer-overlay'))
    ) {
      closeOverlay();
      return;
    }

    const el = target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;

    switch (action) {
      case 'navigate':
        navigate(el.dataset.page);
        break;
      case 'theme-toggle':
        state.theme = state.theme === 'light' ? 'dark' : state.theme === 'dark' ? 'system' : 'light';
        applyTheme();
        toast(`主题已切换为${state.theme === 'system' ? '跟随系统' : state.theme === 'dark' ? '暗色' : '亮色'}`, { tone: 'info' });
        break;
      case 'set-theme':
        state.theme = el.dataset.theme;
        applyTheme();
        if (state.page === 'settings') renderWorkspaceOnly();
        toast('外观设置已保存', { tone: 'info' });
        break;
      case 'toggle-folder': {
        const folder = el.dataset.folder;
        if (state.expanded.has(folder)) state.expanded.delete(folder);
        else state.expanded.add(folder);
        renderWorkspaceOnly();
        break;
      }
      case 'close-modal':
        closeOverlay();
        break;
      case 'close-mobile-detail':
        state.mobileDetail = false;
        renderWorkspaceOnly();
        break;

      /* Prompt */
      case 'set-prompt-tab':
        state.promptTab = el.dataset.value;
        state.search = '';
        $('#global-search').value = '';
        renderWorkspaceOnly();
        break;
      case 'set-platform-category':
        state.platformCategory = el.dataset.category;
        renderWorkspaceOnly();
        break;
      case 'select-prompt-folder':
        state.promptFolder = el.dataset.folder;
        ensureExpanded(state.promptFolder);
        state.mobileDetail = false;
        renderWorkspaceOnly();
        break;
      case 'clear-prompt-folder':
        state.promptFolder = '';
        renderWorkspaceOnly();
        break;
      case 'clear-prompt-filters':
        state.search = '';
        $('#global-search').value = '';
        state.favOnly = false;
        state.promptFolder = '';
        state.tagFilters = [];
        renderWorkspaceOnly();
        break;
      case 'toggle-tag': {
        const tag = el.dataset.tag;
        state.tagFilters = state.tagFilters.includes(tag)
          ? state.tagFilters.filter((item) => item !== tag)
          : [...state.tagFilters, tag];
        renderWorkspaceOnly();
        break;
      }
      case 'toggle-fav-filter':
        state.favOnly = !state.favOnly;
        renderWorkspaceOnly();
        break;
      case 'set-prompt-view':
        state.promptView = el.dataset.view;
        localStorage.setItem('pk_hifi_prompt_view', state.promptView);
        renderWorkspaceOnly();
        break;
      case 'select-prompt':
        state.selectedPrompt = id;
        state.selectedContract = state.selectedContract;
        state.mobileDetail = true;
        renderWorkspaceOnly();
        break;
      case 'toggle-prompt-favorite': {
        const prompt = state.prompts.find((item) => item.id === id);
        if (prompt) {
          prompt.favorite = !prompt.favorite;
          renderWorkspaceOnly();
          toast(prompt.favorite ? `已收藏「${prompt.title}」` : '已取消收藏', { tone: 'info' });
        }
        break;
      }
      case 'toggle-prompt-pin': {
        const prompt = state.prompts.find((item) => item.id === id);
        if (prompt) {
          prompt.pinned = !prompt.pinned;
          renderWorkspaceOnly();
          toast(prompt.pinned ? '已置顶' : '已取消置顶', { tone: 'info' });
        }
        break;
      }
      case 'new-prompt':
        openPromptForm(null);
        break;
      case 'edit-prompt': {
        const prompt = state.prompts.find((item) => item.id === id);
        if (prompt) openPromptForm(prompt);
        break;
      }
      case 'copy-prompt': {
        const prompt = state.prompts.find((item) => item.id === id);
        if (!prompt) break;
        if (prompt.variables.length) {
          openVariableForm(prompt);
        } else {
          const text = [prompt.system, prompt.user].filter(Boolean).join('\n\n');
          copyText(text.trim(), `已复制「${prompt.title}」到剪贴板`).then((copied) => {
            if (copied) {
              prompt.usage += 1;
              renderWorkspaceOnly();
            }
          });
        }
        break;
      }
      case 'test-prompt': {
        const prompt = state.prompts.find((item) => item.id === id);
        if (prompt) openPromptTest(prompt);
        break;
      }
      case 'prompt-versions': {
        const prompt = state.prompts.find((item) => item.id === id);
        if (prompt) openPromptVersions(prompt);
        break;
      }
      case 'restore-prompt-version': {
        const prompt = state.prompts.find((item) => item.id === id);
        if (prompt) {
          prompt.version = Number(el.dataset.version);
          closeOverlay();
          renderWorkspaceOnly();
          toast(`已恢复 v${el.dataset.version}，当前内容已另存为新版本`);
        }
        break;
      }
      case 'delete-prompt': {
        const prompt = state.prompts.find((item) => item.id === id);
        if (prompt) {
          openModal({
            title: '删除 Prompt？',
            subtitle: '此操作不可撤销',
            size: 'small',
            body: `<p style="color:var(--muted-fg);font-size:11px;line-height:18px">将删除「<b style="color:var(--fg)">${esc(prompt.title)}</b>」及其全部 ${prompt.versions.length} 个历史版本。${
              prompt.sync === 'local'
                ? ''
                : '<span style="display:block;margin-top:7px;border:1px solid var(--warning-border);border-radius:7px;background:var(--warning-soft);padding:7px 9px;color:var(--warning)">该 Prompt 参与仓库同步。本次只删除本地副本，不会修改仓库文件。</span>'
            }</p>`,
            footer: `
              <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
              <button type="button" class="btn btn-danger" data-action="confirm-delete-prompt" data-id="${prompt.id}">确认删除</button>
            `,
          });
        }
        break;
      }
      case 'confirm-delete-prompt': {
        const prompt = state.prompts.find((item) => item.id === id);
        state.prompts = state.prompts.filter((item) => item.id !== id);
        state.selectedPrompt = state.prompts[0]?.id || null;
        closeOverlay();
        render();
        toast(`已删除「${prompt?.title || 'Prompt'}」`);
        break;
      }
      case 'sync-prompt': {
        const prompt = state.prompts.find((item) => item.id === id);
        if (prompt) {
          openModal({
            title: `同步范围 — ${prompt.title}`,
            subtitle: 'Prompt 可选参与 Git 同步；仅本机时不写入 Agent 目录',
            body: `
              <div class="form-grid">
                <div class="info-grid">
                  <div class="info-card"><div class="label">当前状态</div><div class="value">${statusBadge(prompt.sync, prompt.syncLabel)}</div></div>
                  <div class="info-card"><div class="label">仓库文件</div><div class="value mono">${esc(prompt.repoPath)}</div></div>
                </div>
                <div>
                  <span class="field-label">同步策略</span>
                  <div class="choice-grid">
                    <button type="button" class="choice ${prompt.sync !== 'local' ? 'active' : ''}">${icon('git-branch')}<span><strong>跟随仓库策略</strong><p>写入 prompts/&lt;folder&gt;/&lt;slug&gt;.prompt.md</p></span></button>
                    <button type="button" class="choice ${prompt.sync === 'local' ? 'active' : ''}">${icon('file')}<span><strong>仅本机</strong><p>保留本地，不写入仓库与 Agent 目录</p></span></button>
                  </div>
                </div>
                <div class="note-strip">${icon('shield')}<span>推送前会扫描 Prompt 正文中的高置信度凭据；命中后要求替换为 <code>{{变量}}</code>。</span></div>
              </div>
            `,
            footer: `
              <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
              <button type="button" class="btn btn-primary" data-action="save-prompt-sync">保存同步范围</button>
            `,
          });
        }
        break;
      }
      case 'save-prompt-sync':
        closeOverlay();
        toast('同步范围已保存；变更会进入待推送');
        break;

      case 'preview-platform-prompt': {
        const item = D.platformPrompts.find((entry) => entry.id === id);
        if (item) openPlatformPreview(item);
        break;
      }
      case 'copy-platform-prompt': {
        const item = D.platformPrompts.find((entry) => entry.id === id);
        if (item) copyText(item.description + '\n\n' + item.preview, `已复制平台 Prompt「${item.title}」`);
        break;
      }
      case 'save-platform-prompt': {
        const item = D.platformPrompts.find((entry) => entry.id === id);
        if (item) {
          const newPrompt = {
            id: `p-platform-${Date.now()}`,
            title: item.title,
            description: item.description,
            folder: item.category,
            tags: item.tags,
            favorite: false,
            pinned: false,
            usage: 0,
            version: 1,
            updatedAt: Date.now(),
            updatedLabel: '刚刚',
            system: item.preview,
            user: '{{input}}',
            variables: [{ name: 'input', type: 'textarea', required: true }],
            sync: 'local',
            syncLabel: '仅本机',
            repoPath: '— 保存后默认为仅本机',
            versions: [{ v: 1, note: '保存自平台', at: '刚刚', current: true }],
          };
          state.prompts.unshift(newPrompt);
          state.selectedPrompt = newPrompt.id;
          state.promptTab = 'mine';
          state.search = '';
          $('#global-search').value = '';
          closeOverlay();
          render();
          toast(`已保存「${item.title}」到我的 Prompt（仅本机）`);
        }
        break;
      }

      /* Instructions */
      case 'set-instruction-tab':
        state.instructionTab = el.dataset.value;
        renderWorkspaceOnly();
        break;
      case 'select-contract-folder':
        state.contractFolder = el.dataset.folder;
        ensureExpanded(state.contractFolder);
        state.mobileDetail = false;
        renderWorkspaceOnly();
        break;
      case 'clear-contract-folder':
        state.contractFolder = '';
        renderWorkspaceOnly();
        break;
      case 'clear-contract-filters':
        state.search = '';
        $('#global-search').value = '';
        state.contractFolder = '';
        state.contractScope = 'all';
        renderWorkspaceOnly();
        break;
      case 'select-contract':
        state.selectedContract = id;
        state.mobileDetail = true;
        renderWorkspaceOnly();
        break;
      case 'copy-contract': {
        const contract = state.contracts.find((item) => item.id === id);
        if (contract) copyText(contract.body, `已复制「${contract.title}」正文`);
        break;
      }
      case 'edit-contract': {
        const contract = state.contracts.find((item) => item.id === id);
        if (contract) {
          openModal({
            title: `编辑契约 — ${contract.title}`,
            subtitle: '保存后生成新版本；相关投影会标记为「待更新」',
            size: 'wide',
            body: `
              <form class="form-grid" data-form="edit-contract" id="contract-form">
                <div class="form-row">
                  <div><label class="field-label">标题</label><input class="input" name="title" value="${esc(contract.title)}" /></div>
                  <div><label class="field-label">文件夹</label><input class="input mono" name="folder" value="${esc(contract.folder)}" /></div>
                </div>
                <div><label class="field-label">描述</label><input class="input" name="description" value="${esc(contract.description)}" /></div>
                <div><label class="field-label">契约正文（Markdown）</label><textarea class="textarea" name="body" rows="10" style="font-family:var(--font-mono);font-size:10.5px">${esc(contract.body)}</textarea></div>
              </form>
            `,
            footer: `
              <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
              <button type="submit" form="contract-form" class="btn btn-primary">保存修改</button>
            `,
          });
        }
        break;
      }
      case 'contract-preview':
        state.instructionTab = 'preview';
        closeOverlay();
        renderWorkspaceOnly();
        break;
      case 'contract-versions': {
        const contract = state.contracts.find((item) => item.id === id);
        if (contract) {
          openModal({
            title: `版本历史 — ${contract.title}`,
            subtitle: '恢复历史版本不会覆盖 Agent 目录中的投影',
            body: `
              <div>
                <div class="version-row current"><span class="version-num">v${contract.version}</span><div class="version-main"><strong>当前版本 · ${esc(contract.updatedLabel)}</strong><p>本地最新，已标记「${esc(contract.syncLabel)}」</p></div><span class="badge badge-primary badge-tight">使用中</span></div>
                <div class="version-row"><span class="version-num">v${Math.max(1, contract.version - 1)}</span><div class="version-main"><strong>历史版本 · 初始版本</strong><p>10 天前 · 可恢复</p></div><button type="button" class="btn btn-outline btn-xs" data-action="restore-contract-version">恢复</button></div>
              </div>
            `,
            footer: '<button type="button" class="btn btn-primary" data-action="close-modal">完成</button>',
          });
        }
        break;
      }
      case 'restore-contract-version':
        closeOverlay();
        toast('已恢复历史版本，当前内容已另存为新版本；相关投影标记为待更新');
        break;
      case 'contract-sync': {
        const contract = state.contracts.find((item) => item.id === id);
        if (contract) openContractSync(contract);
        break;
      }
      case 'save-contract-sync':
        closeOverlay();
        toast('同步范围已保存；契约进入待推送');
        break;
      case 'delete-contract': {
        const contract = state.contracts.find((item) => item.id === id);
        if (contract) {
          openModal({
            title: '删除指令契约？',
            subtitle: '不会自动删除已投影的目标文件',
            size: 'small',
            body: `<p style="color:var(--muted-fg);font-size:11px;line-height:18px">将删除「<b style="color:var(--fg)">${esc(contract.title)}</b>」及其全部历史版本。已投影到 ${contract.targets.length} 个目标；删除本地契约不会自动删除 Agent 目录中已写入的文件，需要到「项目投影」逐项移除。</p>`,
            footer: `
              <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
              <button type="button" class="btn btn-danger" data-action="confirm-delete-contract" data-id="${contract.id}">确认删除</button>
            `,
          });
        }
        break;
      }
      case 'confirm-delete-contract':
        state.contracts = state.contracts.filter((item) => item.id !== id);
        state.selectedContract = state.contracts[0]?.id || null;
        closeOverlay();
        render();
        toast('已删除本地契约；目标文件需要逐项移除');
        break;
      case 'new-contract':
        openModal({
          title: '新建 Agent 指令契约',
          subtitle: '一条 canonical 契约，编译到各 Agent 原生格式',
          size: 'wide',
          body: `
            <form class="form-grid" data-form="new-contract" id="new-contract-form">
              <div class="form-row">
                <div><label class="field-label">标题 *</label><input class="input" name="title" required placeholder="例如：前端代码规范" /></div>
                <div><label class="field-label">文件夹</label><input class="input mono" name="folder" placeholder="团队/前端" /></div>
              </div>
              <div><label class="field-label">描述</label><input class="input" name="description" placeholder="一句话说明生效范围与目的" /></div>
              <div class="form-row">
                <div><label class="field-label">范围</label><div class="select"><select name="scope"><option>项目级</option><option>路径级</option></select>${icon('chevron-down')}</div></div>
                <div><label class="field-label">激活方式</label><div class="select"><select name="activation"><option>常驻</option><option>Glob</option><option>模型判断</option><option>手动</option></select>${icon('chevron-down')}</div></div>
              </div>
              <div><label class="field-label">契约正文（Markdown）</label><textarea class="textarea" name="body" rows="8" style="font-family:var(--font-mono);font-size:10.5px" placeholder="# 团队约定&#10;&#10;- 约束一&#10;- 约束二"></textarea></div>
            </form>
          `,
          footer: `
            <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
            <button type="submit" form="new-contract-form" class="btn btn-primary">创建契约</button>
          `,
        });
        break;
      case 'set-preview-path':
        state.previewPath = el.dataset.path;
        renderWorkspaceOnly();
        break;
      case 'projection-action': {
        const status = el.dataset.status;
        if (status === 'drifted') {
          toast('已显式覆盖 Agent 侧手工修改；该操作可回滚', { tone: 'warning' });
        } else if (status === 'remove') {
          toast('已移除投影；本地库与仓库不受影响', { tone: 'info' });
        } else {
          toast('已重新投影，目标文件与契约一致');
        }
        break;
      }
      case 'reproject-all':
        toast('投影状态已刷新：3 条待更新 · 2 条漂移', { tone: 'info' });
        break;
      case 'toggle-global-target': {
        if (state.selectedGlobalTargets.has(id)) state.selectedGlobalTargets.delete(id);
        else state.selectedGlobalTargets.add(id);
        renderWorkspaceOnly();
        break;
      }
      case 'reset-global-path': {
        const target = D.globalTargets.find((item) => item.id === id);
        if (target) {
          state.globalPaths[id] = target.defaultPath;
          renderWorkspaceOnly();
          toast(`已恢复 ${target.label} 的默认路径`);
        }
        break;
      }
      case 'toggle-global-contract': {
        if (state.selectedGlobalContracts.has(id)) state.selectedGlobalContracts.delete(id);
        else state.selectedGlobalContracts.add(id);
        renderWorkspaceOnly();
        break;
      }
      case 'toggle-all-global-contracts': {
        const all = state.contracts.every((contract) => state.selectedGlobalContracts.has(contract.id));
        state.selectedGlobalContracts = new Set(all ? [] : state.contracts.map((contract) => contract.id));
        renderWorkspaceOnly();
        break;
      }
      case 'global-preview':
        openGlobalPreview();
        break;
      case 'global-project':
        closeOverlay();
        toast(
          `已投影 ${state.selectedGlobalContracts.size} 条指令到 ${state.selectedGlobalTargets.size} 个全局目录（模拟写入）`,
        );
        break;
      case 'global-projection-action':
        toast(
          el.dataset.status === 'drifted'
            ? '已显式覆盖全局目录中的手工修改，可回滚'
            : el.dataset.status === 'remove'
              ? '已移除全局投影；本地库与仓库不受影响'
              : '已重新投影到全局目录',
          { tone: el.dataset.status === 'drifted' ? 'warning' : 'success' },
        );
        break;

      /* Skills */
      case 'set-skill-tab':
        state.skillTab = el.dataset.value;
        state.search = '';
        $('#global-search').value = '';
        renderWorkspaceOnly();
        break;
      case 'select-skill-folder':
        state.skillFolder = el.dataset.folder;
        ensureExpanded(state.skillFolder);
        renderWorkspaceOnly();
        break;
      case 'clear-skill-folder':
        state.skillFolder = '';
        renderWorkspaceOnly();
        break;
      case 'clear-skill-filters':
        state.search = '';
        $('#global-search').value = '';
        state.skillFolder = '';
        renderWorkspaceOnly();
        break;
      case 'open-skill':
        openSkillModal(id);
        break;
      case 'set-skill-modal-tab':
        state.skillModalTab = el.dataset.value;
        renderSkillModal();
        break;
      case 'install-skill-platform': {
        const skill = state.skills.find((item) => item.id === el.dataset.skill);
        if (skill) {
          skill.installs[el.dataset.platform] = 'symlink';
          renderSkillModal();
          renderWorkspaceOnly();
          toast(`已通过 symlink 安装到 ${SKILL_PLATFORMS.find((item) => item.id === el.dataset.platform)?.name}`);
        }
        break;
      }
      case 'remove-skill-platform': {
        const skill = state.skills.find((item) => item.id === el.dataset.skill);
        if (skill) {
          delete skill.installs[el.dataset.platform];
          renderSkillModal();
          renderWorkspaceOnly();
          toast('已从平台移除该技能', { tone: 'info' });
        }
        break;
      }
      case 'toast-skill-edit':
        toast('编辑会生成新版本并进入待推送', { tone: 'info' });
        break;
      case 'toast-skill-delete':
        toast('原型演示：删除需在真实产品中二次确认', { tone: 'warning' });
        break;
      case 'toast-skill-versions':
        toast('版本历史：v1.2.0（当前）· 1.1.0 · 1.0.0', { tone: 'info' });
        break;
      case 'set-store-source':
        state.storeSource = el.dataset.value;
        renderWorkspaceOnly();
        break;
      case 'set-store-category':
        state.storeCategory = el.dataset.category;
        renderWorkspaceOnly();
        break;
      case 'open-install-wizard':
        openInstallWizard(id);
        break;
      case 'wizard-next':
        if (state.wizard) {
          state.wizard.step = 2;
          renderWizard();
        }
        break;
      case 'wizard-back':
        if (state.wizard) {
          state.wizard.step = 1;
          renderWizard();
        }
        break;
      case 'wizard-toggle-platform': {
        if (!state.wizard) break;
        const platform = el.dataset.id;
        const platforms = state.wizard.platforms;
        state.wizard.platforms = platforms.includes(platform)
          ? platforms.filter((item) => item !== platform)
          : [...platforms, platform];
        renderWizard();
        break;
      }
      case 'wizard-mode':
        if (state.wizard) {
          state.wizard.mode = el.dataset.value;
          renderWizard();
        }
        break;
      case 'wizard-install':
        if (state.wizard && !state.wizard.installing) {
          state.wizard.installing = true;
          renderWizard();
          setTimeout(() => {
            if (state.wizard) {
              state.wizard.installing = false;
              state.wizard.step = 3;
              renderWizard();
            }
          }, 750);
        }
        break;
      case 'wizard-finish': {
        const wizard = state.wizard;
        if (!wizard) break;
        const item = wizard.item;
        const newSkill = {
          id: `s-store-${Date.now()}`,
          name: item.name,
          emoji: item.emoji,
          description: item.description,
          author: item.author,
          version: item.version,
          source: item.source,
          category: item.category,
          folder: item.category,
          tags: [item.category],
          installs: Object.fromEntries(wizard.platforms.map((platform) => [platform, wizard.mode])),
          updatedLabel: '刚刚',
          pending: true,
          repoPath: `skills/${item.category}/${item.name}/SKILL.md`,
          instructions: item.instructions,
        };
        state.skills.unshift(newSkill);
        state.wizard = null;
        closeOverlay();
        state.skillTab = 'mine';
        state.selectedSkill = newSkill.id;
        render();
        toast(`「${item.name}」已安装并分发到 ${wizard.platforms.length} 个平台`);
        break;
      }

      /* MCP */
      case 'select-mcp':
        state.selectedMcp = id;
        state.mobileDetail = true;
        renderWorkspaceOnly();
        break;
      case 'select-mcp-folder':
        state.mcpFolder = el.dataset.folder;
        ensureExpanded(state.mcpFolder);
        renderWorkspaceOnly();
        break;
      case 'toggle-mcp-fav-filter':
        state.mcpFav = !state.mcpFav;
        renderWorkspaceOnly();
        break;
      case 'toggle-mcp': {
        const server = state.mcps.find((item) => item.id === id);
        if (server) {
          server.enabled = !server.enabled;
          renderWorkspaceOnly();
          toast(`${server.name} 已${server.enabled ? '启用' : '停用'}`, { tone: server.enabled ? 'success' : 'warning' });
        }
        break;
      }
      case 'toggle-mcp-favorite': {
        const server = state.mcps.find((item) => item.id === id);
        if (server) {
          server.favorite = !server.favorite;
          renderWorkspaceOnly();
        }
        break;
      }
      case 'set-mcp-detail-tab':
        state.mcpTab = el.dataset.value;
        renderWorkspaceOnly();
        break;
      case 'copy-mcp-config': {
        const server = state.mcps.find((item) => item.id === id);
        if (server) copyText(mcpConfig(server), `已复制「${server.name}」脱敏配置`);
        break;
      }
      case 'edit-mcp':
        toast('原型演示：表单 / JSON 双模式编辑，保存即生成版本并进入待推送', { tone: 'info' });
        break;
      case 'mcp-versions':
        toast('版本历史：v2（当前）· v1 · 恢复不会自动改写 Agent 配置', { tone: 'info' });
        break;
      case 'delete-mcp':
        toast('原型演示：删除会清理配置、版本与凭据记录，但不移除 Agent 侧条目', { tone: 'warning' });
        break;
      case 'new-mcp':
        toast('新建 MCP：支持商店安装、粘贴 JSON、从 Agent 反向导入', { tone: 'info' });
        break;
      case 'install-mcp-store': {
        const item = D.mcpStore.find((entry) => entry.id === id);
        if (item) openMcpStoreInstall(item);
        break;
      }
      case 'confirm-install-mcp-store': {
        const item = D.mcpStore.find((entry) => entry.id === id);
        if (item) {
          const newMcp = {
            id: `m-store-${Date.now()}`,
            name: item.name,
            description: item.description,
            transport: item.transport,
            command: 'npx',
            args: ['-y', `@mcp/${item.name}`],
            env: Object.fromEntries(item.envDocs.map((doc) => [doc.key, ''])),
            enabled: true,
            favorite: false,
            folder: '商店/MCP',
            tags: ['商店'],
            source: 'market',
            installs: {},
            notes: '',
            health: item.envDocs.map((doc) => ({
              level: 'warning',
              field: `env.${doc.key}`,
              message: '必填环境变量为空，分发到 Agent 后服务会启动失败。',
            })),
            version: 1,
            updatedLabel: '刚刚',
            repoPath: `mcp/商店/MCP/${item.name}.json`,
            config: {
              transport: item.transport,
              command: 'npx',
              args: ['-y', `@mcp/${item.name}`],
              env: Object.fromEntries(item.envDocs.map((doc) => [doc.key, '[REDACTED]'])),
            },
          };
          state.mcps.unshift(newMcp);
          state.selectedMcp = newMcp.id;
          state.mcpSection = 'mine';
          state.mcpTab = 'config';
          closeOverlay();
          render();
          toast(`已安装「${item.name}」到我的 MCP；请填写 ${item.envDocs.length || 0} 个凭据字段`, {
            tone: item.envDocs.length ? 'warning' : 'success',
          });
        }
        break;
      }
      case 'import-external-mcp': {
        const agent = D.agents.find((entry) => entry.id === el.dataset.agent);
        if (agent) openExternalMcpImport(agent, el.dataset.name);
        break;
      }
      case 'confirm-import-external-mcp': {
        const agent = D.agents.find((entry) => entry.id === el.dataset.agent);
        const name = el.dataset.name;
        if (agent && name) {
          const imported = {
            id: `m-import-${Date.now()}`,
            name,
            description: `从 ${agent.name} 配置文件反向导入的外部 MCP 条目。`,
            transport: 'stdio',
            command: 'npx',
            args: ['-y', name],
            env: {},
            enabled: true,
            favorite: false,
            folder: `导入/${agent.name}`,
            tags: ['导入'],
            source: 'import',
            installs: { [agent.id]: true },
            notes: '从 Agent 配置反向导入；请核对启动命令与凭据。',
            health: [
              {
                level: 'warning',
                field: 'command',
                message: '导入条目缺少可验证的启动命令，请在编辑中确认。',
              },
            ],
            version: 1,
            updatedLabel: '刚刚',
            repoPath: `mcp/导入/${agent.name}/${name}.json`,
            config: { transport: 'stdio', command: 'npx', args: ['-y', name], env: {} },
          };
          state.mcps.unshift(imported);
          state.selectedMcp = imported.id;
          state.mcpSection = 'mine';
          closeOverlay();
          render();
          toast(`已从 ${agent.name} 反向导入「${name}」到我的库`);
        }
        break;
      }
      case 'open-agent-mcp-config':
        toast('原型演示：打开并校验 Agent MCP 配置文件，写入前会保留原文件权限', { tone: 'info' });
        break;
      case 'deploy-mcp': {
        const server = state.mcps.find((item) => item.id === id);
        if (server && server.enabled) openMcpDeploy(server);
        break;
      }
      case 'toggle-deploy-target': {
        if (state.deploySelected.has(id)) state.deploySelected.delete(id);
        else state.deploySelected.add(id);
        renderMcpDeployModal();
        break;
      }
      case 'apply-mcp-deploy': {
        const server = state.mcps.find((item) => item.id === state.deployModal);
        if (server) {
          state.deploySelected.forEach((targetId) => {
            server.installs[targetId] = true;
          });
          closeOverlay();
          renderWorkspaceOnly();
          toast(`已把 ${server.name} 应用到 ${state.deploySelected.size} 个平台（模拟写入）`);
        }
        break;
      }
      case 'set-mcp-section':
        state.mcpSection = el.dataset.value;
        state.search = '';
        $('#global-search').value = '';
        renderWorkspaceOnly();
        break;

      /* Sync */
      case 'set-sync-tab':
        state.syncTab = el.dataset.value;
        renderWorkspaceOnly();
        break;
      case 'set-changes-tab':
        state.changesTab = el.dataset.value;
        state.changesKind = 'all';
        renderWorkspaceOnly();
        break;
      case 'set-changes-kind':
        state.changesKind = el.dataset.value;
        renderWorkspaceOnly();
        break;
      case 'sync-open-changes':
        state.syncTab = 'changes';
        state.changesTab = 'incoming';
        renderWorkspaceOnly();
        break;
      case 'sync-open-deploy':
        state.syncTab = 'deploy';
        renderWorkspaceOnly();
        break;
      case 'sync-open-history':
        state.syncTab = 'history';
        renderWorkspaceOnly();
        break;
      case 'sync-fetch':
        toast('fetch 完成：远端有 3 个提交待确认', { tone: 'info' });
        break;
      case 'sync-push':
        openPushModal();
        break;
      case 'sync-settings':
        openRepoSettings();
        break;
      case 'redetect-agents':
        toast('检测完成：发现 6 个本机 Agent；未安装的工具不会写入', { tone: 'info' });
        break;
      case 'review-change': {
        const change = findChange(id);
        if (change) openReviewChange(change);
        break;
      }
      case 'accept-change': {
        const change = findChange(id);
        if (change) {
          state.resolvedChanges.add(id);
          closeOverlay();
          renderWorkspaceOnly();
          toast(`已接受 ${change.assetName}，本机库已生成新版本`);
        }
        break;
      }
      case 'accept-low-risk':
        toast('已接受低风险变更并生成版本；Prompt 与指令仍需逐条预览', { tone: 'info' });
        break;
      case 'push-change': {
        const change = findChange(id);
        if (change) openPushModal();
        break;
      }
      case 'conflict-change': {
        const change = findChange(id);
        if (change) openConflictChange(change);
        break;
      }
      case 'secret-change': {
        const change = findChange(id);
        if (change) openSecretChange(change);
        break;
      }
      case 'fix-secret': {
        state.resolvedChanges.add(id);
        closeOverlay();
        renderWorkspaceOnly();
        toast('已替换为 {{api_key}} 变量；真实值未落盘', { tone: 'warning' });
        break;
      }
      case 'set-conflict-strategy':
        state.conflictStrategy = el.dataset.value;
        openConflictStrategyRefresh();
        break;
      case 'resolve-conflict': {
        state.resolvedChanges.add(id);
        closeOverlay();
        renderWorkspaceOnly();
        toast('冲突已解决，合并结果已加入待推送');
        break;
      }
      case 'do-push':
        closeOverlay();
        toast('已推送变更到独立分支并创建 PR #24（原型模拟）');
        break;
      case 'set-deploy-kind':
        state.deployKind = el.dataset.value;
        renderWorkspaceOnly();
        break;
      case 'open-deploy-cell':
        openDeployCell(el.dataset.assetKind, el.dataset.assetId, el.dataset.agentId);
        break;
      case 'sync-deploy-cell':
        closeOverlay();
        toast('已重新同步该资产到目标 Agent');
        break;
      case 'remove-deploy':
        closeOverlay();
        toast('已移除分发；本地库与仓库不受影响', { tone: 'info' });
        break;
      case 'sync-all-stale':
        toast('已重新分发 3 项过时资产；漂移项未自动覆盖', { tone: 'warning' });
        break;
      case 'reset-demo':
        openModal({
          title: '重置演示数据？',
          subtitle: '将清除本地偏好并恢复初始状态',
          size: 'small',
          body: '<p style="color:var(--muted-fg);font-size:11px;line-height:18px">仅清除浏览器中的主题与视图偏好，然后重新加载页面。原型数据本身不会被修改。</p>',
          footer: `
            <button type="button" class="btn btn-outline" data-action="close-modal">取消</button>
            <button type="button" class="btn btn-danger" data-action="confirm-reset-demo">重置并刷新</button>
          `,
        });
        break;
      case 'confirm-reset-demo':
        localStorage.removeItem('pk_hifi_theme');
        localStorage.removeItem('pk_hifi_prompt_view');
        location.reload();
        break;
      case 'toast-info':
        toast(el.dataset.message || '原型演示', { tone: 'info' });
        break;
      default:
        break;
    }
  });

  function openConflictStrategyRefresh() {
    const strategy = state.conflictStrategy;
    const body = $('#overlay-root .modal-body');
    if (!body) return;
    $$('[data-action="set-conflict-strategy"]', body).forEach((button) => {
      button.classList.toggle('active', button.dataset.value === strategy);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Form / input / change handlers                                     */
  /* ------------------------------------------------------------------ */

  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();
    const formData = new FormData(form);
    const values = Object.fromEntries(formData.entries());

    if (form.dataset.form === 'prompt') {
      const title = String(values.title || '').trim();
      if (!title) {
        toast('标题必填', { tone: 'warning' });
        return;
      }
      const tags = String(values.tags || '')
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean);
      const existing = values.id ? state.prompts.find((item) => item.id === values.id) : null;
      if (existing) {
        existing.title = title;
        existing.description = String(values.description || '').trim();
        existing.folder = String(values.folder || '').trim() || null;
        existing.system = String(values.system || '').trim();
        existing.user = String(values.user || '').trim();
        existing.tags = tags;
        const previousVars = new Map(existing.variables.map((variable) => [variable.name, variable]));
        existing.variables = [
          ...new Set([...`${existing.system} ${existing.user}`.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((match) => match[1])),
        ].map((name) => previousVars.get(name) || { name, type: 'text', required: true });
        existing.version += 1;
        existing.updatedAt = Date.now();
        existing.updatedLabel = '刚刚';
        existing.sync = existing.sync === 'local' ? 'local' : 'pending';
        existing.syncLabel = existing.sync === 'local' ? '仅本机' : '待推送';
        existing.versions.unshift({ v: existing.version, note: '本地编辑', at: '刚刚', current: true });
        state.selectedPrompt = existing.id;
        closeOverlay();
        render();
        toast(`已保存「${title}」，生成本地版本 v${existing.version}`);
      } else {
        const newPrompt = {
          id: `p-${Date.now()}`,
          title,
          description: String(values.description || '').trim(),
          folder: String(values.folder || '').trim() || null,
          tags,
          favorite: false,
          pinned: false,
          usage: 0,
          version: 1,
          updatedAt: Date.now(),
          updatedLabel: '刚刚',
          system: String(values.system || '').trim(),
          user: String(values.user || '').trim(),
          variables: [
            ...new Set(
              [...`${values.system || ''} ${values.user || ''}`.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map(
                (match) => match[1],
              ),
            ),
          ].map((name) => ({ name, type: 'text', required: true })),
          sync: 'local',
          syncLabel: '仅本机',
          repoPath: '— 新建后默认为仅本机',
          versions: [{ v: 1, note: '新建', at: '刚刚', current: true }],
        };
        state.prompts.unshift(newPrompt);
        state.selectedPrompt = newPrompt.id;
        state.promptTab = 'mine';
        closeOverlay();
        render();
        toast(`已创建「${title}」；默认为仅本机`);
      }
      return;
    }

    if (form.dataset.form === 'copy-variables') {
      const target = state.prompts.find((item) => item.id === state.modalPromptId) || null;
      if (target) {
        const rendered = [replaceTemplate(target.system, values), replaceTemplate(target.user, values)]
          .filter(Boolean)
          .join('\n\n');
        copyText(rendered, `已复制「${target.title}」到剪贴板，用量 +1`).then((copied) => {
          if (copied) {
            target.usage += 1;
            renderWorkspaceOnly();
          }
        });
        closeOverlay();
      }
      return;
    }

    if (form.dataset.form === 'test-prompt') {
      const target = state.prompts.find((item) => item.id === state.modalPromptId);
      const area = $('#test-result-area');
      if (!target || !area) return;
      area.innerHTML = `
        <div class="test-result">
          <div class="test-result-head">${icon('flask')}正在运行 · ${esc(values.model || '模型')}<span class="badge badge-info badge-tight">模拟</span></div>
          <div class="test-result-body" style="display:flex;align-items:center;gap:8px;color:var(--muted-fg);font-size:10px"><span class="spinner"></span>渲染 Prompt 并等待模型响应…</div>
        </div>
      `;
      setTimeout(() => {
        if (!document.contains(area)) return;
        area.innerHTML = `
          <div class="test-result">
            <div class="test-result-head">${icon('check')}测试完成 · ${esc(values.model || '模型')}<span class="badge badge-success badge-tight">耗时 1.8s</span></div>
            <div class="test-result-body md">
              ${md(
                `## 模拟输出\n\n已完成对模板的渲染，并命中 ${target.variables.length} 个变量。\n\n| 维度 | 评分 | 主要发现 |\n| --- | --- | --- |\n| 正确性 | 8/10 | 逻辑完整，边界条件需补充 |\n| 可读性 | 9/10 | 命名清晰，函数长度合理 |\n| 性能 | 7/10 | 避免在循环内重复计算 |\n| 安全 | 8/10 | 外部输入需继续校验 |\n\n**总评：可以合并，建议补充边界测试。**`,
              )}
            </div>
          </div>
        `;
      }, 900);
      return;
    }

    if (form.dataset.form === 'edit-contract') {
      const contract = state.contracts.find((item) => item.id === state.selectedContract);
      if (contract) {
        contract.title = String(values.title || contract.title).trim();
        contract.description = String(values.description || '').trim();
        contract.folder = String(values.folder || '').trim();
        contract.body = String(values.body || '').trim();
        contract.version += 1;
        contract.updatedLabel = '刚刚';
        contract.sync = 'pending';
        contract.syncLabel = '待推送';
        closeOverlay();
        render();
        toast(`已保存「${contract.title}」，生成 v${contract.version}`);
      }
      return;
    }

    if (form.dataset.form === 'new-contract') {
      const title = String(values.title || '').trim();
      if (!title) {
        toast('标题必填', { tone: 'warning' });
        return;
      }
      const contract = {
        id: `c-${Date.now()}`,
        title,
        description: String(values.description || '').trim(),
        folder: String(values.folder || '').trim() || '未分类',
        scope: String(values.scope || '项目级'),
        scopeDesc: '在项目根目录生效',
        activation: String(values.activation || '常驻'),
        activationDesc: '每次会话始终进入上下文',
        priority: 50,
        targets: ['agents-md', 'claude'],
        tags: [],
        version: 1,
        updatedLabel: '刚刚',
        updatedAt: Date.now(),
        sync: 'local',
        syncLabel: '仅本机',
        repoPath: '— 新建后默认为仅本机',
        imports: [],
        globalStatus: '尚未投影',
        body: String(values.body || '').trim() || '# 新契约\n\n- 在这里写约束。',
        globalProjections: '尚未投影',
      };
      state.contracts.unshift(contract);
      state.selectedContract = contract.id;
      state.instructionTab = 'library';
      closeOverlay();
      render();
      toast(`已创建契约「${title}」；默认为仅本机`);
    }
  });

  document.addEventListener('change', (event) => {
    const el = event.target.closest('[data-change]');
    if (!el) return;
    const action = el.dataset.change;

    if (action === 'prompt-sort') {
      state.promptSort = el.value;
      renderWorkspaceOnly();
    } else if (action === 'contract-scope') {
      state.contractScope = el.value;
      renderWorkspaceOnly();
    } else if (action === 'preview-target') {
      state.previewTarget = el.value;
      renderWorkspaceOnly();
    } else if (action === 'preview-path') {
      state.previewPath = el.value.trim() || 'src/components/PromptDetail.tsx';
      renderWorkspaceOnly();
    } else if (action === 'global-path') {
      const target = D.globalTargets.find((item) => item.id === el.dataset.id);
      const value = el.value.trim();
      if (!value || (!value.startsWith('~') && !value.startsWith('/'))) {
        toast('全局路径必须是以 ~ 或 / 开头的绝对路径', { tone: 'warning' });
        el.value = state.globalPaths[el.dataset.id];
        return;
      }
      state.globalPaths[el.dataset.id] = value;
      toast(`已更新 ${target?.label || '全局目录'} 路径；相关投影标记为待更新`, { tone: 'info' });
    } else if (action === 'mcp-notes') {
      const server = state.mcps.find((item) => item.id === el.dataset.id);
      if (server) {
        server.notes = el.value;
        toast('个人备注已保存（不产生版本）', { tone: 'info' });
      }
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.id === 'global-search') {
      state.search = event.target.value;
      renderWorkspaceOnly();
    }
  });

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-review-trust]')) {
      const button = $('#overlay-root [data-action="accept-change"]');
      if (button) button.disabled = !event.target.checked;
    }
  });

  /* ------------------------------------------------------------------ */
  /* Keyboard                                                           */
  /* ------------------------------------------------------------------ */

  document.addEventListener('keydown', (event) => {
    const typing =
      event.target instanceof HTMLElement &&
      (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) ||
        event.target.isContentEditable);

    if (event.key === 'Escape') {
      if ($('#overlay-root').children.length) {
        closeOverlay();
        return;
      }
      if (state.mobileDetail) {
        state.mobileDetail = false;
        renderWorkspaceOnly();
        return;
      }
      if (document.activeElement === $('#global-search') && state.search) {
        state.search = '';
        $('#global-search').value = '';
        renderWorkspaceOnly();
      }
      return;
    }

    if (event.key === 'Tab' && $('#overlay-root').children.length) {
      const focusables = $$(
        '#overlay-root button:not([disabled]), #overlay-root input:not([type="hidden"]):not([disabled]), #overlay-root textarea:not([disabled]), #overlay-root select:not([disabled]), #overlay-root [tabindex]:not([tabindex="-1"])',
      ).filter((el) => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }

    if (typing) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === '/') {
      event.preventDefault();
      $('#global-search').focus();
      $('#global-search').select();
      return;
    }

    if (event.key === 'n' || event.key === 'N') {
      if (state.page === 'prompts' && state.promptTab === 'mine') {
        event.preventDefault();
        openPromptForm(null);
      } else if (state.page === 'instructions') {
        event.preventDefault();
        $('#workspace [data-action="new-contract"]')?.click();
      }
    }

    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[role="button"][data-action]')) {
      event.preventDefault();
      event.target.click();
    }
  });

  /* ------------------------------------------------------------------ */
  /* Boot                                                               */
  /* ------------------------------------------------------------------ */

  $('#theme-toggle').dataset.action = 'theme-toggle';

  $('#repo-pill').addEventListener('click', () => navigate('sync'));

  window.addEventListener('popstate', () => {
    const page = location.hash.slice(1);
    if (PAGES[page]) {
      state.page = page;
      state.search = '';
      render();
    }
  });

  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  if (systemTheme.addEventListener) {
    systemTheme.addEventListener('change', () => {
      if (state.theme === 'system') applyTheme();
    });
  }

  // Expand first-level folders for every workspace once.
  [
    [state.prompts, (item) => item.folder],
    [state.contracts, (item) => item.folder],
    [state.skills, (item) => item.folder],
    [state.mcps, (item) => item.folder],
  ].forEach(([items, getFolder]) => {
    items.forEach((item) => {
      const folder = getFolder(item);
      if (folder) state.expanded.add(folder.split('/')[0]);
    });
  });

  render();
})();
