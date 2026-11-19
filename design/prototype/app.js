(() => {
  'use strict';

  const D = window.PK_DATA;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const PAGES = {
    prompts: { title: 'Prompts', subtitle: 'Local asset library · Optional Git sync', placeholder: 'Search Prompt titles, content, tags…' },
    instructions: { title: 'Agent Instructions', subtitle: 'Repository contracts · Project projection · Global dispatch', placeholder: 'Search contract titles, content, tags…' },
    skills: { title: 'Skills', subtitle: 'SKILL.md · Multi-platform dispatch', placeholder: 'Search skill names, descriptions, folders…' },
    mcp: { title: 'MCP', subtitle: 'Service templates · Secrets stay local', placeholder: 'Search MCP servers, folders…' },
    sync: { title: 'Sync Center', subtitle: 'Pull · Push · Conflict · Dispatch', placeholder: 'Search changes, history events…' },
    settings: { title: 'Settings', subtitle: 'Appearance · Sync policy · Data', placeholder: 'Search settings…' },
  };

  const NAV = [
    { id: 'prompts', label: 'Prompts', icon: 'message' },
    { id: 'instructions', label: 'Agent Instructions', icon: 'file' },
    { id: 'skills', label: 'Skills', icon: 'grid' },
    { id: 'mcp', label: 'MCP', icon: 'zap' },
    { id: 'sync', label: 'Sync', icon: 'git-branch' },
    { id: 'settings', label: 'Settings', icon: 'sliders' },
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
    synced: { label: 'Synced', badge: 'success', icon: 'check' },
    pending: { label: 'Pending push', badge: 'warning', icon: 'arrow-up' },
    incoming: { label: 'Pending pull', badge: 'info', icon: 'arrow-down' },
    conflict: { label: 'Conflict', badge: 'danger', icon: 'alert' },
    blocked: { label: 'Secrets blocked', badge: 'danger', icon: 'lock' },
    local: { label: 'Local only', badge: 'neutral', icon: 'file' },
    stale: { label: 'Stale', badge: 'warning', icon: 'refresh' },
    drifted: { label: 'Drifted', badge: 'danger', icon: 'alert' },
    missing: { label: 'Not projected', badge: 'neutral', icon: 'circle-check' },
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
    platformCategory: 'All',

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
    storeCategory: 'All',
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
    return Number(value).toLocaleString('en-US');
  }

  function folderLabel(folder) {
    return folder || 'Uncategorized';
  }

  function folderMatches(folder, selected) {
    if (!selected) return true;
    if (selected === '__unfiled__') return !folder;
    return !!folder && (folder === selected || folder.startsWith(selected + '/'));
  }

  function repoFolderPath(prefix, folder) {
    return `${prefix}/${folder || 'Uncategorized'}`;
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
        [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en')),
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
    return [...new Set(prompts.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b, 'en'));
  }

  function toast(message, options = {}) {
    const tone = options.tone || 'success';
    const title = options.title || { success: 'Done', warning: 'Heads up', danger: 'Blocked', info: 'Info' }[tone];
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
      toast(successMessage || 'Copied to clipboard');
    } else {
      toast('Copy failed. Check browser clipboard permission.', { tone: 'danger' });
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
      const next = state.theme === 'light' ? 'Dark' : state.theme === 'dark' ? 'System' : 'Light';
      button.title = `Current: ${state.theme === 'system' ? 'System' : state.theme === 'dark' ? 'Dark' : 'Light'} · Switch to ${next}`;
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
                aria-label="${open ? 'Collapse' : 'Expand'} ${esc(node.name)}">
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
            <span class="tree-name">All</span>
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
              <span class="tree-name">Uncategorized</span>
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
      if (state.promptSort === 'title') return a.title.localeCompare(b.title, 'en');
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
      return a.folder.localeCompare(b.folder, 'en');
    });
  }

  function renderPrompts() {
    const listSubnav = `
      <div class="subnav">
        ${tabsHtml(
          [
            { value: 'mine', label: 'My Prompts', count: state.prompts.length },
            { value: 'platform', label: 'Platform Discovery' },
          ],
          state.promptTab,
          'set-prompt-tab',
        )}
        <div class="subnav-right">
          ${
            state.promptTab === 'mine'
              ? `<span class="badge badge-info badge-tight">Optional Git sync</span>
                 <span>${state.prompts.filter((p) => p.sync === 'local').length} local only · not written to Agent directories</span>`
              : `<span class="badge badge-info badge-tight">Platform source</span><span>Search, copy, or save locally as needed</span>`
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
          <aside class="folders-pane" aria-label="Prompt folders">
            <div class="pane-head">${icon('folder')}Prompt folders</div>
            ${renderTree(state.prompts, (p) => p.folder, state.promptFolder, 'select-prompt-folder')}
            <div class="tree-foot">${icon('git-branch')}Folders map 1:1 to repository directories</div>
          </aside>

          <div class="list-pane">
            <div class="list-toolbar">
              <div class="toolbar-row">
                <div class="select">
                  <select data-change="prompt-sort" aria-label="Sort order">
                    <option value="updated" ${state.promptSort === 'updated' ? 'selected' : ''}>Last updated</option>
                    <option value="title" ${state.promptSort === 'title' ? 'selected' : ''}>Title</option>
                    <option value="usage" ${state.promptSort === 'usage' ? 'selected' : ''}>Usage count</option>
                  </select>
                  ${icon('chevron-down')}
                </div>
                <button type="button" class="toggle-square ${state.favOnly ? 'active' : ''}"
                  data-action="toggle-fav-filter" aria-pressed="${state.favOnly}" title="Favorites only" aria-label="Favorites only">
                  ${icon('star', 'icon-sm')}
                </button>
                <div class="segmented" role="group" aria-label="View switcher">
                  <button type="button" data-action="set-prompt-view" data-view="card"
                    class="${state.promptView === 'card' ? 'active' : ''}" title="Card view" aria-label="Card view" aria-pressed="${state.promptView === 'card'}">
                    ${icon('grid', 'icon-sm')}
                  </button>
                  <button type="button" data-action="set-prompt-view" data-view="table"
                    class="${state.promptView === 'table' ? 'active' : ''}" title="Table view" aria-label="Table view" aria-pressed="${state.promptView === 'table'}">
                    ${icon('sliders', 'icon-sm')}
                  </button>
                </div>
              </div>
              <div class="tag-scroll" role="group" aria-label="Tag filter">
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
                    : '<span class="empty-hint">No tags</span>'
                }
              </div>
            </div>

            ${
              state.promptFolder
                ? `<div class="active-filter">${icon('folder')}<strong>${esc(folderLabel(state.promptFolder === '__unfiled__' ? null : state.promptFolder))}</strong>
                    <button type="button" data-action="clear-prompt-folder">Back to all</button></div>`
                : ''
            }

            <div class="list-scroll">
              ${renderPromptList(prompts, selected, hasFilter)}
            </div>

            <div class="list-foot">
              <span class="tabular">${prompts.length} / ${state.prompts.length} items</span>
              ${hasFilter ? '<button type="button" class="link" data-action="clear-prompt-filters">Clear filters</button>' : ''}
              <button type="button" class="btn btn-outline btn-sm" data-action="new-prompt" title="New Prompt (shortcut N)">
                ${icon('plus', 'icon-sm')}New
              </button>
            </div>
          </div>

          <section class="detail-pane ${state.mobileDetail ? 'mobile-open' : ''}" id="detail-pane" aria-label="Prompt details">
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
            title: 'No matching results',
            description: 'Your search, tags, favorites, or folder filter may be too narrow',
            action:
              '<button type="button" class="btn btn-outline btn-sm" data-action="clear-prompt-filters">Clear all filters</button>',
          })
        : emptyState({
            iconName: 'message',
            title: 'No Prompts yet',
            description: 'Create your first Prompt and define template variables with {{variable_name}}',
            action:
              '<button type="button" class="btn btn-primary btn-sm" data-action="new-prompt">New Prompt</button>',
          });
    }

    if (state.promptView === 'table') {
      return `
        <table class="prompt-table">
          <thead><tr><th>Title</th><th style="width:88px">Folder</th><th style="width:64px">Version</th><th style="width:52px">Updated</th></tr></thead>
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
          <span class="path">prompts/${esc(group.folder || 'Uncategorized')}</span>
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
                      <div class="card-desc">${esc(prompt.description || '(No description)')}</div>
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
                    <span class="usage">Used ${prompt.usage} · v${prompt.version}</span>
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
          <button type="button" class="mobile-back" data-action="close-mobile-detail" aria-label="Back to list">${icon('chevron-left', 'icon-lg')}</button>
          <div class="detail-title-main">
            <div class="detail-eyebrow">${icon('message')}Prompt · ${esc(prompt.folder || 'Uncategorized')}</div>
            <h2 class="detail-title">${esc(prompt.title)}${prompt.pinned ? icon('pin', 'pin') : ''}</h2>
            <p class="detail-desc">${esc(prompt.description || '(No description)')}</p>
          </div>
          <div class="detail-actions">
            <button type="button" class="btn btn-ghost btn-icon" data-action="toggle-prompt-favorite" data-id="${prompt.id}"
              title="${prompt.favorite ? 'Remove from favorites' : 'Favorite'}" aria-label="${prompt.favorite ? 'Remove from favorites' : 'Favorite'}" aria-pressed="${prompt.favorite}">
              ${icon('star', prompt.favorite ? 'star-fill' : '')}
            </button>
            <button type="button" class="btn btn-ghost btn-icon" data-action="toggle-prompt-pin" data-id="${prompt.id}"
              title="${prompt.pinned ? 'Unpin' : 'Pin'}" aria-label="${prompt.pinned ? 'Unpin' : 'Pin'}" aria-pressed="${prompt.pinned}">
              ${icon('pin', prompt.pinned ? 'pin-on' : '')}
            </button>
            <span class="divider"></span>
            <button type="button" class="btn btn-ghost btn-icon btn-ghost-danger" data-action="delete-prompt" data-id="${prompt.id}"
              title="Delete" aria-label="Delete Prompt">${icon('trash')}</button>
          </div>
        </div>
        <div class="detail-chips">
          <span class="badge badge-neutral badge-tight">${icon('folder')}${esc(folderLabel(prompt.folder))}</span>
          ${prompt.tags.map((tag) => `<span class="badge badge-primary badge-tight">#${esc(tag)}</span>`).join('')}
          <span class="badge badge-outline badge-tight tabular">v${prompt.version}</span>
          <span class="badge badge-outline badge-tight tabular">Used ${prompt.usage}×</span>
          ${statusBadge(prompt.sync, prompt.syncLabel)}
          <span class="detail-updated tabular">Updated ${esc(prompt.updatedLabel)}</span>
        </div>
        <div class="repo-path">
          ${icon('git-branch')}<span>Repository file</span>
          <code>${esc(prompt.repoPath)}</code>
        </div>
        <div class="detail-buttons">
          <button type="button" class="btn btn-primary" data-action="copy-prompt" data-id="${prompt.id}">${icon('copy')}Copy Prompt</button>
          <button type="button" class="btn btn-outline" data-action="test-prompt" data-id="${prompt.id}">${icon('flask')}AI test</button>
          <button type="button" class="btn btn-outline" data-action="edit-prompt" data-id="${prompt.id}">${icon('pencil')}Edit</button>
          <button type="button" class="btn btn-outline" data-action="sync-prompt" data-id="${prompt.id}">${icon('git-branch')}Sync</button>
          <button type="button" class="btn btn-outline" data-action="prompt-versions" data-id="${prompt.id}">${icon('history')}Versions</button>
        </div>
      </div>

      <div class="detail-body">
        ${
          prompt.system
            ? `<section>
                <div class="section-head">System Prompt</div>
                <div class="md-block">
                  <div class="md-card md">${md(prompt.system)}</div>
                  <button type="button" class="inline-edit" data-action="edit-prompt" data-id="${prompt.id}">${icon('pencil', 'icon-xs')}Edit</button>
                </div>
              </section>`
            : ''
        }
        <section>
          <div class="section-head">User Prompt</div>
          <div class="md-block">
            <div class="md-card md">${md(prompt.user)}</div>
            <button type="button" class="inline-edit" data-action="edit-prompt" data-id="${prompt.id}">${icon('pencil', 'icon-xs')}Edit</button>
          </div>
        </section>
        ${
          prompt.variables.length
            ? `<section>
                <div class="section-head">Template variables <span class="badge badge-outline badge-tight">${prompt.variables.length}</span></div>
                <div class="var-list">
                  ${prompt.variables
                    .map(
                      (variable) => `<span class="var-chip">{{${esc(variable.name)}}}${
                        variable.type !== 'text' ? `<em>${esc(variable.type)}</em>` : ''
                      }</span>`,
                    )
                    .join('')}
                </div>
                <p class="hint-text">Copying or testing opens a form for values; values are remembered for 30 days and never written to the repo.</p>
              </section>`
            : ''
        }
        <div class="note-strip">
          ${icon('shield')}
          <span>Prompt content enters the AI context. High-confidence credentials are scanned before push; versions containing plaintext tokens are blocked and must use <code>{{variable}}</code> instead.</span>
        </div>
      </div>
    `;
  }

  function renderPromptDetailEmpty(hasPrompts) {
    return emptyState({
      iconName: hasPrompts ? 'search' : 'message',
      title: hasPrompts ? 'No Prompt to display' : 'Select a Prompt on the left',
      description: hasPrompts ? 'Adjust search or filters and try again' : 'Create one to see System / User content and variables',
      action: hasPrompts
        ? '<button type="button" class="btn btn-outline btn-sm" data-action="clear-prompt-filters">Clear filters</button>'
        : '<button type="button" class="btn btn-primary btn-sm" data-action="new-prompt">New Prompt</button>',
    });
  }

  function renderPlatformPrompts() {
    const query = state.search.trim().toLowerCase();
    const categories = ['All', ...new Set(D.platformPrompts.map((p) => p.category))];
    const items = D.platformPrompts.filter((item) => {
      if (state.platformCategory !== 'All' && item.category !== state.platformCategory) return false;
      if (query && ![item.title, item.description, item.tags.join(' ')].join(' ').toLowerCase().includes(query)) return false;
      return true;
    });

    return `
      <div class="store-toolbar">
        <div class="skills-head" style="margin:0">
          ${icon('layers')}<span>Platform picks · <strong>${items.length}</strong> items</span>
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
                        <div class="skill-sub">${esc(item.author)} · used ${num(item.uses)}×</div>
                      </div>
                      <span class="badge badge-primary badge-tight">${esc(item.category)}</span>
                    </div>
                    <p class="skill-desc">${esc(item.description)}</p>
                  </button>
                  <div class="skill-foot">
                    <span class="skill-folder">${icon('clock', 'icon-xs')}<span>${esc(item.updatedLabel)}</span></span>
                    <div class="right">
                      <button type="button" class="btn btn-outline btn-xs" data-action="copy-platform-prompt" data-id="${item.id}">${icon('copy', 'icon-xs')}Copy</button>
                      <button type="button" class="btn btn-soft btn-xs" data-action="save-platform-prompt" data-id="${item.id}">Save</button>
                    </div>
                  </div>
                </article>
              `,
                )
                .join('')}
            </div>`
          : emptyState({
              iconName: 'search',
              title: 'No matching platform Prompts',
              description: 'Try another category or keyword',
              action: '<button type="button" class="btn btn-outline btn-sm" data-action="set-platform-category" data-category="All">All categories</button>',
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
            { value: 'library', label: 'Contract library', count: state.contracts.length },
            { value: 'preview', label: 'Resolution preview' },
            { value: 'projections', label: 'Project projections', count: attention },
            { value: 'global', label: 'Global dispatch', count: 2 },
          ],
          state.instructionTab,
          'set-instruction-tab',
        )}
        <div class="subnav-right">
          <span class="badge badge-info badge-tight">Optional Git sync</span>
          <span>1 local only · projections confirmed separately</span>
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
        <aside class="folders-pane" aria-label="Instruction folders">
          <div class="pane-head">${icon('folder')}Instruction folders</div>
          ${renderTree(state.contracts, (c) => c.folder, state.contractFolder, 'select-contract-folder')}
          <div class="tree-foot">${icon('git-branch')}Repository contracts and project projections are managed separately</div>
        </aside>

        <div class="list-pane">
          <div class="list-toolbar">
            <div class="toolbar-row">
              <div class="select" style="flex:1">
                <select data-change="contract-scope" aria-label="Filter by scope">
                  <option value="all" ${state.contractScope === 'all' ? 'selected' : ''}>All scopes</option>
                  <option value="Project" ${state.contractScope === 'Project' ? 'selected' : ''}>Project</option>
                  <option value="Path" ${state.contractScope === 'Path' ? 'selected' : ''}>Path</option>
                </select>
                ${icon('chevron-down')}
              </div>
              <span class="badge badge-outline badge-tight tabular">${contracts.length} items</span>
            </div>
          </div>

          ${
            state.contractFolder
              ? `<div class="active-filter">${icon('folder')}<strong>${esc(
                  folderLabel(state.contractFolder === '__unfiled__' ? null : state.contractFolder),
                )}</strong><button type="button" data-action="clear-contract-folder">Back to all</button></div>`
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
                                <span class="badge badge-${contract.scope === 'Project' ? 'primary' : 'info'}">${esc(contract.scope)}</span>
                                <span class="badge badge-outline">Priority ${contract.priority}</span>
                                ${statusBadge(contract.sync, contract.syncLabel)}
                              </div>
                            </div>
                            <div class="card-meta" style="margin-top:6px">
                              <span class="card-time" style="margin:0">Projection targets: ${contract.targets.length}</span>
                              <span class="usage">Repository contract</span>
                            </div>
                          </button>
                        `;
                      })
                      .join('')}
                  </div>`
                : emptyState({
                    iconName: 'search',
                    title: hasFilter ? 'No matching contracts' : 'No Agent Instructions yet',
                    description: hasFilter ? 'Search, folder, or scope filter may be too narrow' : 'Create a canonical contract, then compile it to each Agent\'s native format',
                    action: hasFilter
                      ? '<button type="button" class="btn btn-outline btn-sm" data-action="clear-contract-filters">Clear filters</button>'
                      : '<button type="button" class="btn btn-primary btn-sm" data-action="new-contract">New contract</button>',
                  })
            }
          </div>

          <div class="list-foot">
            <span class="tabular">${contracts.length} / ${state.contracts.length} items</span>
            ${hasFilter ? '<button type="button" class="link" data-action="clear-contract-filters">Clear filters</button>' : ''}
            <button type="button" class="btn btn-outline btn-sm" data-action="new-contract" title="New contract (shortcut N)">
              ${icon('plus', 'icon-sm')}New
            </button>
          </div>
        </div>

        <section class="detail-pane ${state.mobileDetail ? 'mobile-open' : ''}" aria-label="Contract details">
          ${
            selected
              ? renderContractDetail(selected)
              : emptyState({
                  iconName: 'file',
                  title: 'Select an instruction contract on the left',
                  description: 'See scope, activation, target projections, and contract body',
                })
          }
        </section>
      </div>
    `;
  }

  function renderContractDetail(contract) {
    const targets = contract.targets.map((targetId) => projectTarget(contract, targetId)).filter(Boolean);
    const scopeBadge = contract.scope === 'Project' ? 'primary' : 'info';

    return `
      <div class="detail-header">
        <div class="detail-title-row">
          <button type="button" class="mobile-back" data-action="close-mobile-detail" aria-label="Back to list">${icon('chevron-left', 'icon-lg')}</button>
          <div class="detail-title-main">
            <div class="detail-eyebrow">${icon('file')}Agent Instructions · ${esc(contract.folder)}</div>
            <h2 class="detail-title">${esc(contract.title)}
              <span class="badge badge-outline badge-tight tabular">v${contract.version}</span>
              ${statusBadge(contract.sync, contract.syncLabel)}
            </h2>
            <p class="detail-desc">${esc(contract.description)}</p>
          </div>
          <div class="detail-actions">
            <span class="detail-updated">Updated ${esc(contract.updatedLabel)}</span>
            <span class="divider"></span>
            <button type="button" class="btn btn-ghost btn-icon btn-ghost-danger" data-action="delete-contract" data-id="${contract.id}"
              title="Delete" aria-label="Delete contract">${icon('trash')}</button>
          </div>
        </div>
        <div class="detail-chips">
          <span class="badge badge-neutral badge-tight">${icon('folder')}${esc(folderLabel(contract.folder))}</span>
          <span class="badge badge-${scopeBadge} badge-tight">${esc(contract.scope)}${contract.scope === 'Path' ? ' · src/' : ''}</span>
          <span class="badge badge-${contract.activation === 'Always on' ? 'primary' : 'info'} badge-tight">${icon('file')}${esc(contract.activation)}</span>
          <span class="badge badge-outline badge-tight tabular">Priority ${contract.priority}</span>
          ${contract.tags.map((tag) => `<span class="badge badge-primary badge-tight">#${esc(tag)}</span>`).join('')}
        </div>
        <div class="repo-path">${icon('git-branch')}<span>Repository file</span><code>${esc(contract.repoPath)}</code></div>
        <div class="detail-buttons">
          <button type="button" class="btn btn-primary" data-action="copy-contract" data-id="${contract.id}">${icon('copy')}Copy body</button>
          <button type="button" class="btn btn-outline" data-action="edit-contract" data-id="${contract.id}">${icon('pencil')}Edit</button>
          <button type="button" class="btn btn-outline" data-action="contract-preview" data-id="${contract.id}">${icon('eye')}Resolution preview</button>
          <button type="button" class="btn btn-outline" data-action="contract-versions" data-id="${contract.id}">${icon('history')}Versions</button>
          <button type="button" class="btn btn-outline" data-action="contract-sync" data-id="${contract.id}">${icon('git-branch')}Sync</button>
        </div>
      </div>

      <div class="detail-body">
        <section class="info-grid">
          <div class="info-card"><div class="label">Scope</div><div class="value">${esc(contract.scopeDesc)}</div></div>
          <div class="info-card"><div class="label">Activation</div><div class="value">${esc(contract.activationDesc)}</div></div>
          <div class="info-card"><div class="label">Repository file</div><div class="value mono">${esc(contract.repoPath)}</div><div class="hint">Frontmatter stores folder / scope / activation / targets; the body is the spec itself</div></div>
          <div class="info-card"><div class="label">Global directory projection</div><div class="value">${esc(contract.globalStatus)}</div><div class="hint">Select multiple instructions and tools in Global dispatch; paths can be overridden</div></div>
          <div class="info-card"><div class="label">Claude @import</div><div class="value mono">${contract.imports.length ? contract.imports.map((item) => '@' + item).join('\n') : 'Not configured'}</div><div class="hint">Only supported for the CLAUDE.md target; other targets ignore import lines</div></div>
          <div class="info-card"><div class="label">Sync status</div><div class="value">${statusBadge(contract.sync, contract.syncLabel)}</div><div class="hint">Pull, restore, and manual merges must all be previewed item by item</div></div>
        </section>

        <section>
          <div class="section-head">Targets and projection status <span class="badge badge-outline badge-tight">Targets: ${targets.length}</span></div>
          <div class="target-grid">
            ${targets
              .map(
                (target) => `
                <div class="target-card">
                  <div class="target-top"><strong>${esc(target.label)}</strong>${statusBadge(target.status)}</div>
                  <div class="target-agent">${esc(target.agentName)}</div>
                  <code>${esc(target.path)}</code>
                  <div class="target-foot">
                    <span>${target.merge === 'single-file' ? 'Merged into one file' : 'Separate file'}</span>
                    ${target.status === 'stale' ? '<span class="warn">· Local updated, awaiting re-projection</span>' : ''}
                    ${target.status === 'drifted' ? '<span class="warn">· Modified manually on the Agent side</span>' : ''}
                  </div>
                </div>
              `,
              )
              .join('')}
          </div>
        </section>

        <section>
          <div class="section-head">Contract body <span class="badge badge-outline badge-tight">May enter context every session</span></div>
          <div class="md-card md">${md(contract.body)}</div>
        </section>

        <div class="note-strip">
          ${icon('shield')}
          <span>Instructions are read automatically by agents. Pull, restore, and manual merges must be previewed item by item; high-confidence credentials in the body are scanned before push. Deleting a local contract does not delete already projected target files.</span>
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
          skipped.push({ contract, reason: 'Target does not include this contract; not written to this file' });
        }
        return;
      }
      if (contract.activation === 'Always on') {
        included.push({ contract, reason: 'Always-on instruction, merged by priority' });
      } else if (contract.activation === 'Glob') {
        if (!globCompatible) {
          skipped.push({ contract, reason: `Target ${target.label} does not support Glob activation; skipped during projection` });
        } else if (/^src\//.test(path)) {
          included.push({ contract, reason: `Path ${path} matches src/**/*.{ts,tsx}` });
        } else {
          skipped.push({ contract, reason: `Path ${path} does not match src/**/*.{ts,tsx}` });
        }
      } else if (contract.activation === 'Model decision') {
        skipped.push({ contract, reason: 'The agent decides from the description whether to reference it; not part of always-on context' });
      } else {
        skipped.push({ contract, reason: 'Manual reference; not part of always-on context' });
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
          <span>This is a static simulation: it computes what the current path would actually read, using each target tool's known discovery paths, activation rules, and merge rules, without invoking any tool CLI. Priority and context budget are approximations; the tool's actual behavior wins.</span>
        </div>

        <section class="preview-filter">
          <div class="field">
            <label class="field-label">Target format</label>
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
            <label class="field-label">Current file path</label>
            <input class="input mono" value="${esc(state.previewPath)}" data-change="preview-path" aria-label="Current file path" />
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
          <span class="badge badge-outline badge-tight">${target.merge === 'single-file' ? 'Merged into one file' : 'Separate file'}</span>
          <span>${esc(target.agentName)}; merged with nearest directory taking priority.</span>
        </div>

        <div class="preview-summary" style="margin-top:12px">
          <div class="summary-card">
            <span class="num" style="background:var(--primary-soft);color:var(--primary)">${included.length}</span>
            <div><div class="label">Always-on contracts matched</div><div class="sub">Merged in priority order</div></div>
          </div>
          <div class="summary-card">
            <span class="num" style="background:var(--info-soft);color:var(--info)">${(bytes / 1024).toFixed(1)} KB</span>
            <div><div class="label">Total body / budget</div><div class="sub">${(maxBytes / 1024).toFixed(0)} KB context budget</div></div>
          </div>
          <div class="summary-card">
            <span class="num" style="background:var(--warning-soft);color:var(--warning)">${skipped.length}</span>
            <div><div class="label">Not in always-on context</div><div class="sub">Model decision / Manual / Incompatible</div></div>
          </div>
        </div>

        <div class="preview-grid" style="margin-top:12px">
          <section class="panel" style="align-self:start">
            <div class="panel-head">
              <h3>${icon('layers')}Merged in resolution order</h3>
              <span class="badge badge-outline badge-tight">${target.merge === 'single-file' ? 'Single-file merge' : 'One file per contract'}</span>
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
                  : '<p style="padding:20px;text-align:center;color:var(--muted-fg);font-size:10px">No always-on contracts match the current path.</p>'
              }
            </div>
            ${
              skipped.length
                ? `<div class="skipped">
                    <h4>Excluded from always-on context (${skipped.length})</h4>
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
              <h3>${icon('file')}Compiled target files</h3>
              <span class="badge badge-outline badge-tight">Files: ${compiledFiles.length}</span>
              <span class="sub" style="margin-left:auto">Generated markers enable drift detection; manual edits are never silently overwritten</span>
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
                    '<p class="hint-text">The real product writes frontmatter or a managed block in the target format; manual edits are flagged as drift and never overwritten by bulk sync.</p>'
                  : '<p style="padding:28px;text-align:center;color:var(--muted-fg);font-size:10px">No files need to be written for the current path.</p>'
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
        <span>Project projections write into the <b>project root</b> and are confirmed separately from Global dispatch, which writes into <b>user-level directories</b>. Single-file targets merge multiple contracts; manually modified target files are flagged as drift and can never be bulk-overwritten.</span>
      </div>

      <div class="preview-summary" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:12px">
        <div class="summary-card"><span class="num" style="background:var(--success-soft);color:var(--success)">${counts.synced}</span><div><div class="label">Synced</div><div class="sub">Target files match the contract</div></div></div>
        <div class="summary-card"><span class="num" style="background:var(--warning-soft);color:var(--warning)">${counts.stale}</span><div><div class="label">Stale</div><div class="sub">Contract updated, awaiting re-projection</div></div></div>
        <div class="summary-card"><span class="num" style="background:var(--danger-soft);color:var(--danger)">${counts.drifted}</span><div><div class="label">Drifted</div><div class="sub">Edited manually on the Agent side</div></div></div>
        <div class="summary-card"><span class="num" style="background:var(--muted);color:var(--muted-fg)">${counts.missing}</span><div><div class="label">Not projected</div><div class="sub">Target file not generated yet</div></div></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>${icon('send')}Project projection records</h3>
          <span class="badge badge-outline badge-tight">${rows.length} items</span>
          <span class="sub">Overwriting drifted items requires individual confirmation</span>
          <button type="button" class="btn btn-outline btn-sm" style="margin-left:auto" data-action="reproject-all">${icon('refresh', 'icon-sm')}Refresh projection status</button>
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
                  <p>${esc(contract.activation)} · Priority ${contract.priority} · ${esc(target.agentName)}</p>
                  <code class="projection-path">${esc(target.path)}</code>
                </div>
                <div class="projection-actions">
                  ${
                    target.status === 'drifted'
                      ? '<button type="button" class="btn btn-danger btn-xs" data-action="projection-action" data-status="drifted">Overwrite</button>'
                      : `<button type="button" class="btn btn-outline btn-xs" data-action="projection-action" data-status="${target.status}">${
                          target.status === 'synced' ? 'Re-project' : 'Project'
                        }</button>`
                  }
                  <button type="button" class="btn btn-ghost btn-xs btn-ghost-danger" data-action="projection-action" data-status="remove">Remove</button>
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
        <span>Global dispatch is a <b>one-way write from the local library into Agent global directories on this machine</b>. It does not go through Git and never writes back to the repo. Select multiple instructions and tools to project them in one pass; each tool's global directory can be changed to the real path on your machine.</span>
      </div>

      <section style="margin-bottom:12px">
        <div class="panel-head" style="padding:0 0 7px;border:0">
          <h3>${icon('server')}Global directories (editable)</h3>
          <span class="badge badge-outline badge-tight">${targets.length} agents</span>
          <span class="sub">After a path change, related projections are marked Stale</span>
        </div>
        <div class="global-grid">
          ${targets
            .map((target) => {
              const selected = state.selectedGlobalTargets.has(target.id);
              return `
                <div class="global-card ${selected ? 'selected' : ''}">
                  <div class="global-card-top">
                    <button type="button" class="checkbox ${selected ? 'checked' : ''}" data-action="toggle-global-target" data-id="${target.id}"
                      role="checkbox" aria-checked="${selected}" aria-label="Select ${esc(target.label)}">${selected ? icon('check') : ''}</button>
                    <strong>${esc(target.label)}</strong>
                    <span class="badge badge-${target.detected ? 'success' : 'outline'} badge-tight">${target.detected ? 'Detected' : 'Not detected'}</span>
                  </div>
                  <div class="global-sub">${esc(target.agentName)} · ${target.pathMode === 'file' ? 'Single file' : 'Separate files'} · Projected ${target.projected}</div>
                  <div class="global-path">
                    <input class="input" style="height:27px;font-family:var(--font-mono);font-size:9px"
                      value="${esc(state.globalPaths[target.id])}" data-change="global-path" data-id="${target.id}" aria-label="${esc(target.label)} path" />
                    <button type="button" class="btn btn-ghost btn-xs" data-action="reset-global-path" data-id="${target.id}"
                      ${state.globalPaths[target.id] === target.defaultPath ? 'disabled' : ''} title="Restore default path">Default</button>
                  </div>
                  <p class="global-note">${esc(target.pathMode === 'file' ? 'Multiple contracts are merged into a managed block.' : 'Each contract gets its own file.')}</p>
                </div>
              `;
            })
            .join('')}
        </div>
      </section>

      <section class="panel" style="margin-bottom:10px">
        <div class="panel-head">
          <h3>${icon('file')}Select instructions to sync</h3>
          <span class="badge badge-outline badge-tight">${state.contracts.length} available</span>
          <button type="button" class="btn btn-outline btn-sm" style="margin-left:auto" data-action="toggle-all-global-contracts">
            ${allSelected ? 'Deselect all' : 'Select all'}
          </button>
        </div>
        <div class="select-list">
          ${state.contracts
            .map((contract) => {
              const active = state.selectedGlobalContracts.has(contract.id);
              return `
                <div class="select-row ${active ? 'active' : ''}" data-action="toggle-global-contract" data-id="${contract.id}" role="button" tabindex="0">
                  <button type="button" class="checkbox ${active ? 'checked' : ''}" role="checkbox" aria-checked="${active}" aria-label="Select ${esc(contract.title)}">${active ? icon('check') : ''}</button>
                  <div class="select-main">
                    <strong>${esc(contract.title)}</strong>
                    <p>${esc(contract.description)}</p>
                    <div style="display:flex;gap:4px;margin-top:3px">
                      <span class="badge badge-neutral badge-tight">${icon('folder')}${esc(folderLabel(contract.folder))}</span>
                      <span class="badge badge-${contract.activation === 'Always on' ? 'primary' : 'info'} badge-tight">${esc(contract.activation)}</span>
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
        <span class="summary">Instructions: <strong>${selectedContracts.length}</strong> · Global directories: <strong>${selectedTargets.length}</strong></span>
        <span class="badge badge-warning badge-tight">1 combination drifted; bulk actions will not overwrite</span>
        <div class="right">
          <button type="button" class="btn btn-outline btn-sm" data-action="global-preview">${icon('eye', 'icon-sm')}Preview writes</button>
          <button type="button" class="btn btn-primary btn-sm" data-action="global-project" ${selectedContracts.length && selectedTargets.length ? '' : 'disabled'}>
            ${icon('send', 'icon-sm')}Project selected
          </button>
        </div>
      </div>

      <section class="panel">
        <div class="panel-head">
          <h3>${icon('layers')}Global projection records</h3>
          <span class="badge badge-outline badge-tight">${D.globalProjections.length} records</span>
          <span class="sub">Drifted items can only be overwritten one at a time; removal only affects local files</span>
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
                  <p>${esc(projection.at)} · ${esc(projection.note || 'Global directory matches the local library')}</p>
                  <code class="projection-path">${esc(projection.path)}</code>
                </div>
                <div class="projection-actions">
                  <button type="button" class="btn btn-outline btn-xs" data-action="global-projection-action" data-status="${projection.status}">
                    ${projection.status === 'drifted' ? 'Overwrite' : 'Re-project'}
                  </button>
                  <button type="button" class="btn btn-ghost btn-xs btn-ghost-danger" data-action="global-projection-action" data-status="remove">Remove</button>
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
        return fa === fb ? a.name.localeCompare(b.name) : fa.localeCompare(fb, 'en');
      });
  }

  function sourceBadge(source) {
    const map = {
      official: ['Official picks', 'primary'],
      community: ['Community', 'info'],
      import: ['Imported', 'neutral'],
      scan: ['Local scan', 'warning'],
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
            { value: 'mine', label: 'My Skills', count: state.skills.length },
            { value: 'store', label: 'Skill Store' },
          ],
          state.skillTab,
          'set-skill-tab',
        )}
        <div class="subnav-right">
          <span class="badge badge-info badge-tight">Optional Git sync</span>
          <span>One directory per skill · skills/&lt;folder&gt;/&lt;name&gt;/</span>
        </div>
      </div>
    `;

    if (state.skillTab === 'store') {
      const categories = ['All', ...new Set(D.storeSkills.map((skill) => skill.category))];
      const list = D.storeSkills.filter((skill) => {
        if (state.storeSource !== 'all' && skill.source !== state.storeSource) return false;
        if (state.storeCategory !== 'All' && skill.category !== state.storeCategory) return false;
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
                  ['all', 'All'],
                  ['official', 'Official picks'],
                  ['community', 'Community'],
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
                              <div class="skill-sub tabular">${esc(skill.author)} · ${num(skill.downloads)} downloads</div>
                            </div>
                            <span class="badge badge-${skill.source === 'official' ? 'primary' : 'info'} badge-tight">${skill.source === 'official' ? 'Official' : 'Community'}</span>
                          </div>
                          <p class="skill-desc">${esc(skill.description)}</p>
                          <div class="skill-foot">
                            ${
                              installed
                                ? '<span class="badge badge-success badge-tight">' + icon('check', 'icon-xs') + 'In My Skills</span>'
                                : `<button type="button" class="btn btn-outline btn-xs" data-action="open-install-wizard" data-id="${skill.id}">${icon('download', 'icon-xs')}Install</button>`
                            }
                            <span class="badge badge-neutral badge-tight" style="margin-left:auto">${esc(skill.category)}</span>
                          </div>
                        </article>
                      `;
                      })
                      .join('')}
                  </div>`
                : emptyState({ iconName: 'search', title: 'No matching skills', description: 'Try another keyword or source filter' })
            }
          </div></div>
        </div>
      `;
    }

    const hasFilter = !!state.search.trim() || !!state.skillFolder;
    return `
      <div class="page">${subnav}
        <div class="workspace-body">
          <aside class="folders-pane" aria-label="Skill folders">
            <div class="pane-head">${icon('folder')}Skill folders</div>
            ${renderTree(state.skills, (s) => s.folder, state.skillFolder, 'select-skill-folder')}
            <div class="tree-foot">${icon('git-branch')}One directory per skill; scripts sync with the skill</div>
          </aside>
          <div style="min-width:0;flex:1;display:flex;flex-direction:column">
            <div style="min-height:0;flex:1;overflow-y:auto;padding:14px 16px 18px">
              <div class="skills-head">
                ${icon('grid')}<span>Total <strong>${skills.length}</strong> skills</span>
                ${
                  state.skillFolder
                    ? `<span class="badge badge-neutral badge-tight">${icon('folder')}${esc(folderLabel(state.skillFolder === '__unfiled__' ? null : state.skillFolder))}</span>
                       <button type="button" class="btn btn-ghost btn-xs" data-action="clear-skill-folder">Back to all</button>`
                    : ''
                }
                <span class="right">${icon('layers')}Folders are repository directories · installed skills can be edited and become pending push</span>
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
                                ${installed ? `<span class="badge badge-success badge-tight">${icon('check', 'icon-xs')}Platforms: ${installed}</span>` : '<span class="badge badge-outline badge-tight">Not dispatched</span>'}
                                ${external ? `<span class="badge badge-warning badge-tight">External ${external}</span>` : ''}
                                ${skill.pending ? '<span class="badge badge-warning badge-tight">Pending push</span>' : ''}
                                <button type="button" class="skill-edit" data-action="open-skill" data-id="${skill.id}" title="View / edit" aria-label="Edit ${esc(skill.name)}">${icon('pencil', 'icon-xs')}</button>
                              </div>
                            </div>
                          </article>
                        `;
                        })
                        .join('')}
                    </div>`
                  : emptyState({
                      iconName: 'grid',
                      title: hasFilter ? 'No matching skills' : 'No skills yet',
                      description: hasFilter ? 'Try another keyword or folder' : 'Install from the Skill Store, or import from a local scan',
                      action: hasFilter
                        ? '<button type="button" class="btn btn-outline btn-sm" data-action="clear-skill-filters">Clear filters</button>'
                        : '<button type="button" class="btn btn-primary btn-sm" data-action="set-skill-tab" data-value="store">Go to Skill Store</button>',
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
            { value: 'mine', label: 'My Library', count: state.mcps.length },
            { value: 'agents', label: 'Agent MCP' },
            { value: 'store', label: 'MCP Store', count: D.mcpStore.length },
          ],
          state.mcpSection,
          'set-mcp-section',
        )}
        <div class="subnav-right">
          <span class="badge badge-info badge-tight">Secrets stay local</span>
          <span>One JSON per server · Plaintext credentials never enter Git</span>
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
          <aside class="folders-pane" aria-label="MCP folders">
            <div class="pane-head">${icon('folder')}MCP folders</div>
            ${renderTree(state.mcps, (m) => m.folder, state.mcpFolder, 'select-mcp-folder')}
            <div class="tree-foot">${icon('lock')}Only placeholders sync for env / headers; secrets stay in the keychain</div>
          </aside>

          <div class="list-pane" style="width:370px">
            <div class="list-toolbar">
              <div class="toolbar-row">
                <button type="button" class="toggle-square ${state.mcpFav ? 'active' : ''}" data-action="toggle-mcp-fav-filter"
                  aria-pressed="${state.mcpFav}" title="Favorites only" aria-label="Favorites only">${icon('star', 'icon-sm')}</button>
                <span class="badge badge-outline badge-tight tabular">${servers.length} / ${state.mcps.length} servers</span>
                <button type="button" class="btn btn-outline btn-sm" style="margin-left:auto" data-action="new-mcp">
                  ${icon('plus', 'icon-sm')}New
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
                                  data-action="toggle-mcp" data-id="${server.id}" aria-label="${server.enabled ? 'Disable' : 'Enable'} ${esc(server.name)}"></button>
                              </span>
                            </div>
                            <p>${esc(server.description)}</p>
                            <div class="mcp-row-meta">
                              <span class="folder">${icon('folder', 'icon-xs')}<span>${esc(folderLabel(server.folder))}</span></span>
                              ${distributed ? `<span class="badge badge-success badge-tight">Dispatched ${distributed}</span>` : ''}
                              ${!server.enabled ? '<span class="badge badge-warning badge-tight">Disabled</span>' : ''}
                              <span class="time">${esc(server.updatedLabel)}</span>
                            </div>
                          </div>
                        `;
                      })
                      .join('')
                  : `<p style="padding:34px 14px;text-align:center;color:var(--muted-fg);font-size:10px">No matching servers</p>`
              }
            </div>
          </div>

          <section class="detail-pane ${state.mobileDetail ? 'mobile-open' : ''}" aria-label="MCP details">
            ${selected ? renderMcpDetail(selected) : emptyState({ iconName: 'server', title: 'Select an MCP server on the left', description: 'See redacted config, health check, and dispatch status' })}
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
        <span>These are the MCP config files each Agent reads, including entries written by this app and externally installed entries. Reverse import brings external entries into My Library, where they gain versions and Git template sync.</span>
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
                  <span class="badge badge-success badge-tight" style="margin-left:auto">Managed: ${managed.length}</span>
                </div>
                <div class="panel-body" style="display:flex;flex-direction:column;gap:5px">
                  ${
                    managed.length
                      ? managed
                          .map(
                            (server) => `
                            <div class="target-row" style="padding:6px 8px">
                              ${icon('server')}
                              <div class="info"><strong>${esc(server.name)}</strong><span>${server.transport} · written by Prompt Keeper</span></div>
                              <span class="badge badge-${server.enabled ? 'success' : 'warning'} badge-tight">${server.enabled ? 'Enabled' : 'Disabled'}</span>
                            </div>
                          `,
                          )
                          .join('')
                      : '<p class="hint-text" style="margin:0">No MCP entries managed by this app yet.</p>'
                  }
                  ${external
                    .map(
                      (entry) => `
                      <div class="target-row" style="padding:6px 8px;border-style:dashed">
                        ${icon('server')}
                        <div class="info"><strong>${esc(entry.name)}</strong><span>${esc(entry.hint)}</span></div>
                        <button type="button" class="btn btn-outline btn-xs" data-action="import-external-mcp" data-agent="${agent.id}" data-name="${esc(entry.name)}">Reverse import</button>
                      </div>
                    `,
                    )
                    .join('')}
                </div>
                <div class="panel-foot">
                  <span class="sub" style="font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(agent.mcpFile)}</span>
                  <button type="button" class="btn btn-ghost btn-xs" style="margin-left:auto" data-action="open-agent-mcp-config" data-agent="${agent.id}">Open config</button>
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
        <span>Installing an MCP from the store first shows the full config and credential fields. Installation only writes to the local library; you fill in real tokens, which are stored encrypted. The repo still syncs only the <code>${'${VAR}'}</code> placeholder.</span>
      </div>
      <div class="store-toolbar">
        <div class="skills-head" style="margin:0">${icon('server')}<span>MCP Store · <strong>${list.length}</strong> servers</span></div>
        <div class="store-cats"><span class="chip active">All</span></div>
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
                        <div class="skill-sub tabular">Store · ${num(item.downloads)} installs</div>
                      </div>
                      <span class="badge badge-info badge-tight">${item.transport}</span>
                    </div>
                    <p class="skill-desc">${esc(item.description)}</p>
                    <div class="skill-foot">
                      <span class="skill-folder">${icon('key', 'icon-xs')}<span>${item.envDocs.length ? `Credential fields: ${item.envDocs.length}` : 'No credentials needed'}</span></span>
                      <div class="right">
                        <button type="button" class="btn btn-outline btn-xs" data-action="install-mcp-store" data-id="${item.id}">${icon('download', 'icon-xs')}Install</button>
                      </div>
                    </div>
                  </article>
                `,
                )
                .join('')}
            </div>`
          : emptyState({ iconName: 'search', title: 'No matching MCP servers', description: 'Try another keyword' })
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
                  ? `<span class="badge badge-danger badge-tight">${icon('alert', 'icon-xs')}${errorCount} errors · ${issues.length - errorCount} warnings</span>`
                  : issues.length
                    ? `<span class="badge badge-warning badge-tight">${icon('alert', 'icon-xs')}${issues.length} warnings</span>`
                    : `<span class="badge badge-success badge-tight">${icon('check', 'icon-xs')}All checks passed</span>`
              }
              <span style="color:var(--muted-fg);font-size:9.5px">Checks: command exists / valid URL / required env / credential format</span>
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
            ${!issues.length ? '<p class="hint-text">No static issues found. The real product also probes commands on PATH and tests remote URL connectivity.</p>' : ''}
          </div>
        `
        : state.mcpTab === 'deploy'
          ? `
            <div style="display:flex;flex-direction:column;gap:6px">
              <p class="hint-text" style="margin:0 0 3px">Current status of this server in each platform config file. The real product uses a SHA-256 entry digest to detect external modifications and two-way conflicts.</p>
              ${D.mcpTargets
                .map(
                  (target) => `
                  <div class="target-row">
                    ${icon('file')}
                    <div class="info"><strong>${esc(target.name)}</strong><span>${esc(target.file)}</span></div>
                    ${
                      server.installs[target.id]
                        ? '<span class="badge badge-success badge-tight">Written · managed by this app</span>'
                        : '<span class="badge badge-outline badge-tight">Not created</span>'
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
                <button type="button" class="btn btn-outline btn-sm" data-action="copy-mcp-config" data-id="${server.id}">${icon('copy', 'icon-sm')}Copy config</button>
                <button type="button" class="btn btn-outline btn-sm" data-action="edit-mcp" data-id="${server.id}">${icon('pencil', 'icon-sm')}JSON / form editing</button>
              </div>
              <div class="code-panel">
                <div class="code-panel-head">${icon('terminal')}${esc(server.repoPath)}</div>
                <pre>${esc(mcpConfig(server))}</pre>
              </div>
              <div class="note-strip">
                ${icon('shield')}
                <span>Credential fields (KEY / TOKEN / SECRET / PASSWORD / Authorization) are encrypted with AES-256-GCM in local SQLite, with the master key in the system keychain. The UI always shows <code>[REDACTED]</code>; unchanged redacted values keep their original value on edit.</span>
              </div>
              <div>
                <label class="field-label" for="mcp-notes">Personal notes (no version created)</label>
                <textarea class="textarea" id="mcp-notes" rows="2" data-change="mcp-notes" data-id="${server.id}" placeholder="Note token rotation dates and usage caveats…">${esc(server.notes || '')}</textarea>
              </div>
            </div>
          `;

    return `
      <div class="detail-header">
        <div class="detail-title-row">
          <button type="button" class="mobile-back" data-action="close-mobile-detail" aria-label="Back to list">${icon('chevron-left', 'icon-lg')}</button>
          <div class="detail-title-main">
            <div class="detail-eyebrow">${icon('server')}MCP Server · ${esc(server.folder)}</div>
            <h2 class="detail-title">${esc(server.name)}
              <span class="badge badge-${server.transport === 'stdio' ? 'neutral' : 'info'} badge-tight">${server.transport}</span>
              ${hasError ? `<span class="badge badge-danger badge-tight">${icon('alert', 'icon-xs')}Health ${issues.length}</span>` : ''}
            </h2>
            <p class="detail-desc">${esc(server.description)}</p>
          </div>
          <div class="detail-actions">
            <button type="button" class="btn btn-ghost btn-icon" data-action="toggle-mcp-favorite" data-id="${server.id}"
              title="${server.favorite ? 'Remove from favorites' : 'Favorite'}" aria-label="${server.favorite ? 'Remove from favorites' : 'Favorite'}" aria-pressed="${server.favorite}">
              ${icon('star', server.favorite ? 'star-fill' : '')}
            </button>
            <span class="divider"></span>
            <button type="button" class="btn btn-ghost btn-icon btn-ghost-danger" data-action="delete-mcp" data-id="${server.id}"
              title="Delete" aria-label="Delete MCP">${icon('trash')}</button>
          </div>
        </div>
        <div class="detail-chips">
          <span class="badge badge-neutral badge-tight">${icon('folder')}${esc(folderLabel(server.folder))}</span>
          <span class="badge badge-${server.source === 'manual' ? 'outline' : server.source === 'market' ? 'primary' : 'warning'} badge-tight">${
            server.source === 'manual' ? 'Manual' : server.source === 'market' ? 'From store' : 'Imported'
          }</span>
          ${server.tags.map((tag) => `<span class="badge badge-primary badge-tight">#${esc(tag)}</span>`).join('')}
          <span class="badge badge-${server.enabled ? 'success' : 'warning'} badge-tight">${server.enabled ? 'Enabled' : 'Disabled'}</span>
          <span class="detail-updated">Updated ${esc(server.updatedLabel)}</span>
        </div>
        <div class="repo-path">${icon('git-branch')}<span>Repository file</span><code>${esc(server.repoPath)}</code></div>
        <div class="detail-buttons">
          <button type="button" class="btn btn-primary" data-action="deploy-mcp" data-id="${server.id}" ${server.enabled ? '' : 'disabled title="Disabled servers cannot be dispatched"'}>
            ${icon('send')}Apply to platforms
          </button>
          <button type="button" class="btn btn-outline" data-action="edit-mcp" data-id="${server.id}">${icon('pencil')}Edit</button>
          <button type="button" class="btn btn-outline" data-action="mcp-versions" data-id="${server.id}">${icon('history')}Versions (${server.version})</button>
        </div>
      </div>

      <div class="mcp-tabs">
        ${[
          ['config', 'Config (redacted)'],
          ['health', `Health (${issues.length})`],
          ['deploy', `Dispatch (${managed}/${D.mcpTargets.length})`],
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
            { value: 'overview', label: 'Overview' },
            { value: 'changes', label: 'Changes', count: counts.incoming + counts.outgoing + counts.conflict },
            { value: 'deploy', label: 'Dispatch', count: 5 },
            { value: 'history', label: 'History' },
          ],
          state.syncTab,
          'set-sync-tab',
        )}
        <div class="subnav-right">
          ${icon('git-branch')}
          <span class="mono" style="font-size:9.5px">${D.repo.url} · ${D.repo.branch}</span>
          <span class="badge badge-success badge-tight">Connected</span>
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
              <p>Connected · Last fetch ${esc(repo.lastFetch)} · Last merge ${esc(repo.lastSync)} · ${esc(repo.auth)}</p>
              <div class="sync-hero-path">${esc(repo.localPath)}</div>
            </div>
            <div class="sync-hero-actions">
              <button type="button" class="btn btn-outline btn-sm" data-action="sync-fetch">${icon('refresh', 'icon-sm')}Fetch now</button>
              <button type="button" class="btn btn-outline btn-sm" data-action="sync-push">${icon('arrow-up', 'icon-sm')}Push…</button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="sync-settings">${icon('sliders', 'icon-sm')}Settings</button>
            </div>
          </div>
          <div class="sync-hero-meta">
            <span class="badge badge-info badge-tight">${icon('arrow-up', 'icon-xs')}Ahead of remote ${repo.ahead}</span>
            <span class="badge badge-warning badge-tight">${icon('arrow-down', 'icon-xs')}Behind remote ${repo.behind}</span>
            <span>${esc(repo.pushMode)} · ${esc(repo.autoFetch)}</span>
          </div>
        </section>

        <section class="policy-grid">
          <article class="policy-card">
            <div class="policy-top"><span class="policy-icon">${icon('grid')}</span><strong>Skills</strong><span class="badge badge-primary badge-tight">Two-way sync</span></div>
            <p>Writes skills/&lt;folder&gt;/&lt;skill&gt;/SKILL.md by folder; scripts travel both ways with the repo — review after pull, then dispatch.</p>
            <div class="policy-foot">2 pending pull · 1 pending push</div>
          </article>
          <article class="policy-card">
            <div class="policy-top"><span class="policy-icon">${icon('server')}</span><strong>MCP</strong><span class="badge badge-info badge-tight">Templates two-way · Secrets local</span></div>
            <p>Writes mcp/&lt;folder&gt;/&lt;name&gt;.json by folder; the repo stores only the ${'${VAR}'} placeholder, while real tokens stay in the local keychain.</p>
            <div class="policy-foot">1 item blocked by security policy</div>
          </article>
          <article class="policy-card">
            <div class="policy-top"><span class="policy-icon">${icon('message')}</span><strong>Prompts</strong><span class="badge badge-primary badge-tight">Per-Prompt opt-in</span></div>
            <p>Frontmatter holds metadata and variable definitions; content is split into System / User. Private Prompts can be set to local only individually.</p>
            <div class="policy-foot">5 pending · 1 local only</div>
          </article>
          <article class="policy-card">
            <div class="policy-top"><span class="policy-icon">${icon('file')}</span><strong>Agent Instructions</strong><span class="badge badge-primary badge-tight">Per-contract opt-in</span></div>
            <p>The repo stores canonical .contract.md files; project projection and local global-directory dispatch are confirmed separately, and global paths can be overridden individually.</p>
            <div class="policy-foot">4 pending · 2 blocked · 1 local only</div>
          </article>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>${icon('folder')}Repository structure = platform folders</h3>
            <span class="badge badge-outline badge-tight">Browsable without the app</span>
          </div>
          <div class="panel-body">
            <div class="terminal">
              <div class="terminal-head">
                <span class="terminal-dot red"></span><span class="terminal-dot amber"></span><span class="terminal-dot green"></span>
                <span style="margin-left:5px">tony/ai-assets</span>
                <span>main · tree</span>
              </div>
              <pre><span class="tok-folder">prompts/</span><span class="tok-file">engineering/code-quality/review.prompt.md</span>
<span class="tok-folder">instructions/</span><span class="tok-file">team/frontend/frontend.contract.md</span>
<span class="tok-folder">skills/</span><span class="tok-file">dev-workflow/git/commit-helper/SKILL.md</span>
<span class="tok-folder">mcp/</span><span class="tok-file">development/github/github.json</span>

<span class="tok-dim"># Leaf level holds one file per asset</span>
<span class="tok-green">Prompt</span>  one .prompt.md each
<span class="tok-green">Instruction</span>  one .contract.md each
<span class="tok-green">Skill</span>   one directory per skill
<span class="tok-green">MCP</span>     one .json per server</pre>
            </div>
          </div>
        </section>

        <button type="button" class="blocked-alert" data-action="sync-open-changes">
          ${icon('lock')}
          <span>
            <strong>${counts.blocked} assets contain plaintext credentials; push is blocked</strong>
            <p>Go to Changes to fix plaintext in Prompt / instruction bodies or MCP env / headers. Real values never enter the repo.</p>
          </span>
          ${icon('chevron-right')}
        </button>

        <section class="stat-grid">
          <button type="button" class="stat-card" data-action="sync-open-changes">
            <div class="stat-top"><span class="stat-value info">${counts.incoming}</span><span class="label">Pending pull</span>${icon('chevron-right', 'icon-xs chev')}</div>
            <div class="stat-hint">Includes 1 Prompt · 2 instructions · Confirm before merging</div>
          </button>
          <button type="button" class="stat-card" data-action="sync-open-changes">
            <div class="stat-top"><span class="stat-value warning">${counts.outgoing}</span><span class="label">Pending push</span>${icon('chevron-right', 'icon-xs chev')}</div>
            <div class="stat-hint">${counts.blocked} blocked · Local changes awaiting commit</div>
          </button>
          <button type="button" class="stat-card" data-action="sync-open-changes">
            <div class="stat-top"><span class="stat-value danger">${counts.conflict}</span><span class="label">Conflict</span>${icon('chevron-right', 'icon-xs chev')}</div>
            <div class="stat-hint">Both sides changed; no silent overwrite</div>
          </button>
          <button type="button" class="stat-card" data-action="sync-open-deploy">
            <div class="stat-top"><span class="stat-value primary">5</span><span class="label">Dispatch pending</span>${icon('chevron-right', 'icon-xs chev')}</div>
            <div class="stat-hint">3 stale · 2 drifted</div>
          </button>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>${icon('grid')}Local agents</h3>
            <span class="badge badge-success badge-tight">Detected ${detected.length}</span>
            <span class="sub">Dispatch only to installed tools to avoid empty directories</span>
            <button type="button" class="btn btn-ghost btn-sm" style="margin-left:auto" data-action="redetect-agents">${icon('refresh', 'icon-sm')}Re-detect</button>
            <button type="button" class="btn btn-outline btn-sm" data-action="sync-open-deploy">Manage dispatch${icon('chevron-right', 'icon-sm')}</button>
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
                    <span class="badge badge-${index === 1 || index === 3 ? 'warning' : 'success'} badge-tight">${index === 1 || index === 3 ? '1 pending' : 'Healthy'}</span>
                  </div>
                `)
                .join('')}
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>${icon('history')}Recent sync</h3>
            <button type="button" class="btn btn-ghost btn-sm" style="margin-left:auto" data-action="sync-open-history">All history${icon('chevron-right', 'icon-sm')}</button>
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
          <span>The repo and local library use a three-way merge: <b>remote (repo)</b>, <b>local (this machine's library)</b>, and <b>base (last sync)</b>. Changes on one side advance automatically; if both sides changed, it becomes a Conflict and is never silently overwritten.</span>
        </div>

        <div class="filter-bar">
          ${tabsHtml(
            [
              { value: 'incoming', label: 'Pending pull', count: counts.incoming },
              { value: 'outgoing', label: 'Pending push', count: counts.outgoing },
              { value: 'conflict', label: 'Conflict', count: counts.conflict },
            ],
            state.changesTab,
            'set-changes-tab',
          )}
          <div class="filter-pills">
            ${[
              ['all', 'All'],
              ['prompt', 'Prompt'],
              ['contract', 'Instruction'],
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
                ? 'Prompts and Agent Instructions must be previewed in full and accepted one by one'
                : state.changesTab === 'outgoing'
                  ? 'Bodies and MCP env / headers are scanned again before push'
                  : 'Choose the repo version, keep local, or merge manually before writing'
            }
          </span>
          <div style="margin-left:auto;display:flex;gap:5px">
            ${
              state.changesTab === 'incoming'
                ? '<button type="button" class="btn btn-primary btn-sm" data-action="accept-low-risk">Accept low-risk changes</button>'
                : state.changesTab === 'outgoing'
                  ? '<button type="button" class="btn btn-primary btn-sm" data-action="sync-push">Push selected…</button>'
                  : '<button type="button" class="btn btn-outline btn-sm" data-action="sync-open-history">View history</button>'
            }
          </div>
        </div>

        ${
          filtered.length
            ? `<div class="change-list">${filtered.map((change) => renderChangeRow(change)).join('')}</div>`
            : `<div class="panel"><div class="empty" style="min-height:240px">
                <span class="empty-icon">${icon(state.changesTab === 'conflict' ? 'check' : state.changesTab === 'incoming' ? 'arrow-down' : 'arrow-up')}</span>
                <strong>${state.changesTab === 'incoming' ? 'No incoming changes' : state.changesTab === 'outgoing' ? 'No outgoing local changes' : 'No conflicts'}</strong>
                <p>${state.changesTab === 'conflict' ? 'Everything is in sync; the next time both sides change the same file it will show up here.' : 'New remote differences appear here after a fetch.'}</p>
              </div></div>`
        }
      </div>
    `;
  }

  function renderChangeRow(change) {
    const assetIcon = { prompt: 'message', contract: 'file', skill: 'grid', mcp: 'server' }[change.kind];
    const assetLabel = { prompt: 'Prompt', contract: 'Instruction', skill: 'Skill', mcp: 'MCP' }[change.kind];
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
              change.direction === 'incoming' ? 'Pending pull' : change.direction === 'outgoing' ? 'Pending push' : 'Conflict'
            }</span>
            <span class="badge badge-outline badge-tight">${esc(change.changeLabel)}</span>
            ${change.risk !== 'none' ? `<span class="badge badge-${change.risk === 'secrets' ? 'danger' : 'warning'} badge-tight">${icon(change.risk === 'secrets' ? 'lock' : 'alert', 'icon-xs')}${esc(change.riskLabel)}</span>` : ''}
            ${change.blocked ? '<span class="badge badge-danger badge-tight">Push blocked</span>' : ''}
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
                  ${change.kind === 'prompt' || change.kind === 'contract' || change.risk !== 'none' ? 'Preview and accept' : 'Accept'}
                  ${icon('chevron-right', 'icon-sm')}
                </button>`
              : change.direction === 'outgoing'
                ? change.blocked
                  ? `<button type="button" class="btn btn-danger btn-sm" data-action="secret-change" data-id="${change.id}">${icon('lock', 'icon-sm')}Fix secrets</button>`
                  : `<button type="button" class="btn btn-outline btn-sm" data-action="push-change" data-id="${change.id}">${icon('arrow-up', 'icon-sm')}Push</button>`
                : `<button type="button" class="btn btn-danger btn-sm" data-action="conflict-change" data-id="${change.id}">${icon('alert', 'icon-sm')}Resolve conflict</button>`
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
          <span>The dispatch layer is <b>write-only</b>: local library → each Agent's default directory; it never writes back to the repo. Files edited manually inside an Agent are marked <b>Drifted</b>, are never overwritten by bulk sync, and require individual confirmation.</span>
        </div>

        <div class="filter-bar">
          <div class="filter-pills">
            ${[
              ['all', 'All'],
              ['skill', 'Skills'],
              ['mcp', 'MCP'],
            ]
              .map(
                ([value, label]) => `<button type="button" class="${state.deployKind === value ? 'active' : ''}"
                  data-action="set-deploy-kind" data-value="${value}">${label}</button>`,
              )
              .join('')}
          </div>
          <span style="color:var(--muted-fg);font-size:9.5px">Detected ${agents.length} agents · 3 stale · 2 drifted</span>
          <div style="margin-left:auto;display:flex;gap:5px">
            <button type="button" class="btn btn-outline btn-sm" data-action="redetect-agents">${icon('refresh', 'icon-sm')}Re-detect</button>
            <button type="button" class="btn btn-primary btn-sm" data-action="sync-all-stale">${icon('refresh', 'icon-sm')}Sync all stale (3)</button>
          </div>
        </div>

        <div class="matrix-wrap">
          <table class="matrix">
            <thead><tr><th>Asset</th>${agents.map((agent) => `<th>${esc(agent.name)}<span class="path">${esc(agent.skillDir || agent.mcpFile)}</span></th>`).join('')}</tr></thead>
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
                        if (!supported) return '<td><span style="color:var(--muted-fg-2);font-size:9px">Unsupported</span></td>';
                        const status = deploymentStatus(asset, agent.id);
                        const label = { synced: 'Synced', stale: 'Stale', drifted: 'Drifted', missing: 'Not dispatched' }[status];
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

        <p class="hint-text">Published as symlinks by default, so library edits take effect immediately; falls back to copy with per-item notices when the file system does not support symlinks. Dispatch paths follow each tool's convention; disabled MCP servers cannot be dispatched.</p>
      </div>
    `;
  }

  function renderSyncHistory() {
    return `
      <div style="display:flex;flex-direction:column;gap:11px">
        <div class="banner">
          ${icon('history')}
          <span>Every fetch, pull, push, conflict, and dispatch leaves an auditable record. The real product writes events to local SQLite, retaining the version and target path of every write.</span>
        </div>
        <div class="panel">
          <div class="panel-head">
            <h3>${icon('history')}Sync history</h3>
            <span class="badge badge-outline badge-tight">${D.syncEvents.length} events</span>
            <span class="sub">Last 7 days</span>
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
      ['appearance', 'Appearance'],
      ['sync-policy', 'Sync policy'],
      ['repo-layout', 'Repository layout'],
      ['global-dirs', 'Agent global directories'],
      ['data', 'Data'],
      ['about', 'About'],
    ];
    const themes = [
      ['light', 'Light', 'Always use the light theme', 'sun'],
      ['dark', 'Dark', 'Always use the dark theme', 'moon'],
      ['system', 'System', 'Follow the OS appearance', 'monitor'],
    ];

    return `
      <div class="content-scroll" style="height:100%">
        <div class="settings-layout">
          <aside class="settings-nav">
            <div class="label">Settings</div>
            ${sections.map(([id, label]) => `<a href="#settings-${id}">${label}</a>`).join('')}
          </aside>
          <div class="settings-stack">
            <section class="settings-section" id="settings-appearance">
              <div class="settings-head">
                <span class="settings-icon">${icon('sun')}</span>
                <div><h2>Appearance</h2><p>The theme applies immediately and is saved on this machine.</p></div>
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
                <div><h2>Sync policy</h2><p>The Git repository handles cross-machine / cross-team sharing; this machine handles review, projection, and dispatch to each Agent. Prompts and Agent Instructions follow the repo policy by default, but each one can be set to local only.</p></div>
              </div>
              <div class="settings-body">
                <dl class="kv-list">
                  <div class="kv-row"><dt>Skills</dt><dd class="primary">Two-way sync · Directories mapped by folder</dd></div>
                  <div class="kv-row"><dt>MCP</dt><dd class="info">One file per server · Secrets stored locally only</dd></div>
                  <div class="kv-row"><dt>Prompts</dt><dd class="info">Mapped by folder · Can be local only</dd></div>
                  <div class="kv-row"><dt>Agent Instructions</dt><dd class="info">Repo folders + project projection + global directory projection</dd></div>
                </dl>
                <p class="settings-note">Repository connection, pull / push, conflict resolution, and Skill / MCP dispatch all happen in the Sync workspace; Agent Instruction projection and drift are handled in the Agent Instructions workspace. The prototype never touches real Git or the file system.</p>
              </div>
            </section>

            <section class="settings-section" id="settings-repo-layout">
              <div class="settings-head">
                <span class="settings-icon">${icon('folder')}</span>
                <div><h2>Repository layout</h2><p>Folders in the app are repository directories; subfolders can nest further, and each directory keeps one file per asset.</p></div>
              </div>
              <div class="settings-body">
                <div class="terminal">
                  <div class="terminal-head"><span class="terminal-dot red"></span><span class="terminal-dot amber"></span><span class="terminal-dot green"></span><span style="margin-left:5px">repository layout</span><span>v0.5</span></div>
                  <pre><span class="tok-folder">prompts/</span><span class="tok-file">&lt;category&gt;/&lt;subcategory&gt;/&lt;slug&gt;.prompt.md</span>
<span class="tok-folder">instructions/</span><span class="tok-file">&lt;category&gt;/&lt;subcategory&gt;/&lt;slug&gt;.contract.md</span>
<span class="tok-folder">skills/</span><span class="tok-file">&lt;category&gt;/&lt;skill-name&gt;/SKILL.md</span>
<span class="tok-folder">mcp/</span><span class="tok-file">&lt;category&gt;/&lt;server-name&gt;.json</span></pre>
                </div>
              </div>
            </section>

            <section class="settings-section" id="settings-global-dirs">
              <div class="settings-head">
                <span class="settings-icon">${icon('send')}</span>
                <div><h2>Agent global directories</h2><p>Agent Instructions can be projected separately into user-level directories of local Agents; paths can be changed individually in Agent Instructions → Global dispatch.</p></div>
              </div>
              <div class="settings-body">
                ${D.globalTargets
                  .map(
                    (target) => `
                    <div class="global-dir-row">
                      <strong>${esc(target.agentName)}</strong>
                      <span class="badge badge-neutral badge-tight">${target.pathMode === 'file' ? 'Single file' : 'Separate files'}</span>
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
                <div><h2>Data</h2><p>High-fidelity prototype data lives in browser memory; theme and view preferences are stored in localStorage (keys pk_hifi_theme / pk_hifi_prompt_view).</p></div>
              </div>
              <div class="settings-body">
                <button type="button" class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger-border)" data-action="reset-demo">
                  ${icon('refresh', 'icon-sm')}Reset demo data
                </button>
              </div>
            </section>

            <section class="settings-section" id="settings-about">
              <div class="settings-head">
                <span class="settings-icon">${icon('sparkles')}</span>
                <div><h2>About</h2><p>Prompt Keeper high-fidelity prototype v0.5.0</p></div>
              </div>
              <div class="settings-body">
                <p style="color:var(--muted-fg);font-size:10px;line-height:17px">Builds on the Prompt / Skill / MCP management domain of PromptHub (AGPL-3.0) v0.6.2, adding two-way Git repository sync, a multi-Agent dispatch layer, and Agent Instruction contracts; v0.5 unifies the four asset types under "folders are repository directories" and adds overridable local global-directory dispatch for Agent Instructions.</p>
                <p style="color:var(--muted-fg-2);font-size:9px;line-height:15px;margin-top:6px">This prototype has no real backend; Git operations, projections, dispatch, and AI responses are all simulated. Interaction design follows docs/interaction-design.md.</p>
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
            <button type="button" class="modal-close" data-action="${closeAction}" aria-label="Close">${icon('x', 'icon-sm')}</button>
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
            <button type="button" class="modal-close" data-action="close-modal" aria-label="Close">${icon('x', 'icon-sm')}</button>
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
            <label class="field-label" for="prompt-title">Title *</label>
            <input class="input" id="prompt-title" name="title" value="${esc(model.title)}" placeholder="e.g. Code review assistant" required />
          </div>
          <div>
            <label class="field-label" for="prompt-folder">Folder</label>
            <input class="input mono" id="prompt-folder" name="folder" value="${esc(model.folder || '')}" placeholder="engineering/frontend" list="prompt-folders" />
            <datalist id="prompt-folders">${[...new Set(state.prompts.map((item) => item.folder).filter(Boolean))]
              .map((folder) => `<option value="${esc(folder)}"></option>`)
              .join('')}</datalist>
          </div>
        </div>
        <div>
          <label class="field-label" for="prompt-description">Description</label>
          <input class="input" id="prompt-description" name="description" value="${esc(model.description)}" placeholder="One sentence on purpose and output" />
        </div>
        <div>
          <label class="field-label" for="prompt-system">System Prompt</label>
          <textarea class="textarea" id="prompt-system" name="system" rows="4" placeholder="Define role, constraints, and output format…">${esc(model.system)}</textarea>
        </div>
        <div>
          <label class="field-label" for="prompt-user">User Prompt</label>
          <textarea class="textarea" id="prompt-user" name="user" rows="4" placeholder="Define template variables with {{variable_name}}…">${esc(model.user)}</textarea>
        </div>
        <div>
          <label class="field-label" for="prompt-tags">Tags (comma-separated)</label>
          <input class="input" id="prompt-tags" name="tags" value="${esc(model.tags.join(', '))}" placeholder="Engineering, Code Review" />
        </div>
        <p class="hint-text">Folders map 1:1 to repository directories; saving creates a new version and marks it pending push. Bodies with plaintext credentials are blocked before push.</p>
      </form>
    `;
    openModal({
      title: editing ? 'Edit Prompt' : 'New Prompt',
      subtitle: editing ? 'Saving creates a new version and marks it pending push in the list' : 'Define template variables with {{variable_name}}; folders are repository directories',
      size: 'wide',
      body,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button type="submit" form="prompt-form" class="btn btn-primary">${icon('check')}${editing ? 'Save changes' : 'Create Prompt'}</button>
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
            <textarea class="textarea" id="${id}" name="${esc(variable.name)}" rows="3" placeholder="${esc(variable.label || 'Enter a value')}"></textarea></div>`;
        }
        if (variable.type === 'select') {
          return `<div><label class="field-label" for="${id}">{{${esc(variable.name)}}}</label>
            <div class="select"><select id="${id}" name="${esc(variable.name)}">${(variable.options || [])
              .map((option) => `<option value="${esc(option)}">${esc(option)}</option>`)
              .join('')}</select>${icon('chevron-down')}</div></div>`;
        }
        return `<div><label class="field-label" for="${id}">{{${esc(variable.name)}}}${variable.required ? ' *' : ''}</label>
          <input class="input" id="${id}" name="${esc(variable.name)}" value="${esc(variable.example || '')}" placeholder="e.g. ${esc(variable.example || 'Enter a value')}" /></div>`;
      })
      .join('');

    openModal({
      title: `Copy "${prompt.title}"`,
      subtitle: 'Fill in template variables; values are used temporarily on this machine and never written to the repo',
      body: `<form class="form-grid" data-form="copy-variables" id="copy-form">${fields}</form>`,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button type="submit" form="copy-form" class="btn btn-primary">${icon('copy')}Copy to clipboard</button>
      `,
    });
  }

  function openPromptVersions(prompt) {
    openModal({
      title: `Version history — ${prompt.title}`,
      subtitle: 'Restoring a historical version saves the current content as a new version, so changes are never lost silently',
      body: `
        <div>
          ${prompt.versions
            .map(
              (version) => `
              <div class="version-row ${version.current ? 'current' : ''}">
                <span class="version-num">v${version.v}</span>
                <div class="version-main">
                  <strong>${version.current ? 'Current version' : 'Historical version'} · ${esc(version.note)}</strong>
                  <p>${esc(version.at)} · ${version.current ? 'Edited locally' : 'Restorable'}</p>
                </div>
                ${version.current ? '<span class="badge badge-primary badge-tight">In use</span>' : `<button type="button" class="btn btn-outline btn-xs" data-action="restore-prompt-version" data-id="${prompt.id}" data-version="${version.v}">Restore</button>`}
              </div>
            `,
            )
            .join('')}
        </div>
      `,
      footer: '<button type="button" class="btn btn-primary" data-action="close-modal">Done</button>',
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
            <textarea class="textarea" id="${id}" name="${esc(variable.name)}" rows="3" placeholder="${esc(variable.label || 'Enter test content')}">function sum(items) { return items.reduce((a, b) => a + b, 0) }</textarea></div>`;
        }
        if (variable.type === 'select') {
          return `<div class="test-field"><label for="${id}">{{${esc(variable.name)}}}<code>select</code></label>
            <div class="select"><select id="${id}" name="${esc(variable.name)}">${(variable.options || [])
              .map((option) => `<option>${esc(option)}</option>`)
              .join('')}</select>${icon('chevron-down')}</div></div>`;
        }
        return `<div class="test-field"><label for="${id}">{{${esc(variable.name)}}}<code>text</code></label>
          <input class="input" id="${id}" name="${esc(variable.name)}" value="${esc(variable.example || '')}" placeholder="Enter a test value" /></div>`;
      })
      .join('');

    openDrawer({
      title: `AI test · ${prompt.title}`,
      subtitle: 'Simulated run: renders the template with your values; no real model is called',
      body: `
        <form data-form="test-prompt" id="test-form">
          <div class="test-controls">
            <div class="test-field">
              <label>Test model</label>
              <div class="select"><select name="model"><option>GPT-5.2</option><option>Claude Sonnet 4.5</option><option>GLM-5.3 Flash</option><option>DeepSeek V4</option></select>${icon('chevron-down')}</div>
            </div>
            ${fields || '<p class="hint-text">This Prompt has no template variables; the full content will be used for the test.</p>'}
            <button type="submit" class="btn btn-primary" style="margin-top:2px">${icon('play', 'icon-sm')}Run test</button>
          </div>
        </form>
        <div id="test-result-area">
          <div class="note-strip" style="margin-top:12px">${icon('flask')}<span>Simulated output, latency, and matched variables appear here after running. The real product sends the rendered Prompt to the selected model.</span></div>
        </div>
      `,
      footer: '<button type="button" class="btn btn-outline" data-action="close-modal">Close</button>',
    });
  }

  /* ------------------------------------------------------------------ */
  /* Contract modals                                                    */
  /* ------------------------------------------------------------------ */

  function openContractSync(contract) {
    openModal({
      title: `Sync scope — ${contract.title}`,
      subtitle: 'Capability boundary between the repository contract and the local library',
      body: `
        <div class="form-grid">
          <div class="info-grid">
            <div class="info-card"><div class="label">Current status</div><div class="value">${statusBadge(contract.sync, contract.syncLabel)}</div></div>
            <div class="info-card"><div class="label">Repository file</div><div class="value mono">${esc(contract.repoPath)}</div></div>
          </div>
          <div>
            <span class="field-label">Sync policy</span>
            <div class="choice-grid">
              <button type="button" class="choice active">
                ${icon('git-branch')}
                <span><strong>Follow repo policy</strong><p>Two-way sync from the instructions/ directory; credentials are scanned before push.</p></span>
              </button>
              <button type="button" class="choice">
                ${icon('file')}
                <span><strong>Local only</strong><p>Keep in the local library without writing to the repo; project projection and global dispatch still work.</p></span>
              </button>
            </div>
          </div>
          <div class="note-strip">${icon('shield')}<span>Contract body enters the Agent context. Pull, restore, and manual merges must be previewed item by item; high-confidence credentials are scanned before push.</span></div>
        </div>
      `,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="save-contract-sync">Save sync scope</button>
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
              ? `<span class="badge badge-success badge-tight">Installed · ${mode}</span>
                 <button type="button" class="btn btn-ghost btn-xs btn-ghost-danger" data-action="remove-skill-platform" data-skill="${skill.id}" data-platform="${platform.id}">Remove</button>`
              : mode === 'external'
                ? '<span class="badge badge-warning badge-tight">External install</span>'
                : `<span class="badge badge-outline badge-tight">Not installed</span>
                   <button type="button" class="btn btn-outline btn-xs" data-action="install-skill-platform" data-skill="${skill.id}" data-platform="${platform.id}">Install</button>`
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
             <p class="hint-text" style="margin:0 0 3px">In symlink mode, multiple tools share one file and edits apply immediately; in copy mode each platform keeps its own copy.</p>
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
          <span class="badge badge-outline badge-tight">${installed}/${SKILL_PLATFORMS.length} platforms</span>
          <code style="margin-left:auto;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:4px;background:var(--muted);padding:2px 6px;font-family:var(--font-mono);font-size:8.5px;color:var(--muted-fg)">${esc(skill.repoPath)}</code>
        </div>
        <div class="filter-pills" style="margin-bottom:9px">
          <button type="button" class="${state.skillModalTab === 'content' ? 'active' : ''}" data-action="set-skill-modal-tab" data-value="content">Content (SKILL.md)</button>
          <button type="button" class="${state.skillModalTab === 'platforms' ? 'active' : ''}" data-action="set-skill-modal-tab" data-value="platforms">Platforms (${installed}/${SKILL_PLATFORMS.length})</button>
        </div>
        <div class="md-card" style="padding:12px 14px">${content}</div>
      `,
      footer: `
        <span class="left" style="margin-right:auto;color:var(--muted-fg-2);font-size:9px">Installed 3 days ago · Saving edits marks it pending push</span>
        <button type="button" class="btn btn-outline btn-sm" data-action="toast-skill-edit">${icon('pencil', 'icon-sm')}Edit</button>
        <button type="button" class="btn btn-ghost btn-sm btn-ghost-danger" data-action="toast-skill-delete">${icon('trash', 'icon-sm')}Delete</button>
        <button type="button" class="btn btn-outline btn-sm" data-action="toast-skill-versions">${icon('history', 'icon-sm')}Versions</button>
        <button type="button" class="btn btn-primary btn-sm" data-action="close-modal">Done</button>
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
        ${['Review content', 'Choose platforms', 'Result']
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
        <div class="banner" style="margin-bottom:9px">${icon('shield')}<span>Review before installing: the following content will be written verbatim into the target platform directories.</span></div>
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-bottom:8px">
          <span class="badge badge-neutral badge-tight">v${esc(item.version)}</span>
          <span class="badge badge-outline badge-tight">Files: ${item.files.length}</span>
          <span class="badge badge-outline badge-tight">Total ${totalSize} KB</span>
        </div>
        <div class="panel" style="margin-bottom:9px">
          ${item.files
            .map((file) => `<div class="target-row" style="border:0;border-bottom:1px solid var(--border);border-radius:0"><span style="font-family:var(--font-mono);font-size:9px">${esc(file.path)}</span><span style="margin-left:auto;color:var(--muted-fg);font-size:9px">${esc(file.size)}</span></div>`)
            .join('')}
        </div>
        <div class="md-card md" style="max-height:230px;overflow:auto">${md(item.instructions)}</div>
      `;
      footer = `
        <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="wizard-next">Looks good, continue${icon('chevron-right', 'icon-sm')}</button>
      `;
    } else if (step === 2) {
      body = `
        ${steps}
        <div class="form-grid">
          <div>
            <span class="field-label">Target platforms (multi-select)</span>
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
            <span class="field-label">Install mode</span>
            <div class="choice-grid">
              ${[
                ['symlink', 'symlink (recommended)', 'Library edits apply immediately; multiple tools share one file'],
                ['copy', 'copy', 'Independent copy per platform; re-dispatch after updates'],
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
          <div class="note-strip">${icon('info')}<span>Platforms selected: ${wizard.platforms.length}; installation writes into each platform's skill directory. The real product falls back to copy when symlinks are unsupported.</span></div>
        </div>
      `;
      footer = `
        <button type="button" class="btn btn-outline" data-action="wizard-back">Back to review</button>
        <button type="button" class="btn btn-primary" data-action="wizard-install" ${wizard.platforms.length && !wizard.installing ? '' : 'disabled'}>
          ${wizard.installing ? '<span class="spinner"></span>Installing…' : `Confirm install (${wizard.platforms.length})`}
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
                return `<div class="target-row"><span class="badge badge-success badge-tight">${icon('check', 'icon-xs')}</span><div class="info"><strong>${esc(platform.name)}</strong><span>${esc(platform.dir)}/${esc(item.name)}/</span></div><span class="badge badge-success badge-tight">Written via ${wizard.mode} written</span></div>`;
              },
            )
            .join('')}
        </div>
        <p class="hint-text">After installation the skill appears in My Skills; saving edits creates a version and marks it pending push.</p>
      `;
      footer = '<button type="button" class="btn btn-primary" data-action="wizard-finish">Done</button>';
    }

    $('#overlay-root').innerHTML = modalShell({
      title: `Install review — ${item.name}`,
      subtitle: `Step ${step} · ${['Review skill content', 'Choose target platforms', 'Result'][step - 1]}`,
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
      title: `Dispatch to Agent platforms — ${server.name}`,
      subtitle: 'The app rewrites each platform\'s MCP config file per its conventions; writes are simulated and never touch real files',
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
                    <button type="button" class="checkbox ${selected ? 'checked' : ''}" data-action="toggle-deploy-target" data-id="${target.id}" role="checkbox" aria-checked="${selected}" aria-label="Select ${esc(target.name)}">${selected ? icon('check') : ''}</button>
                    <div class="info"><strong>${esc(target.name)}</strong><span>${esc(target.file)}</span></div>
                    ${managed ? '<span class="badge badge-success badge-tight">Managed by this app</span>' : '<span class="badge badge-outline badge-tight">Not created</span>'}
                    <span class="badge badge-neutral badge-tight">${target.format}</span>
                  </div>
                `;
              },
            )
            .join('')}
        </div>
        <div style="margin-top:10px">
          <div style="display:flex;align-items:center;gap:5px;margin-bottom:4px">
            <span class="field-label" style="margin:0">Write preview · ${esc(previewTarget.file)}</span>
            <span class="badge badge-outline badge-tight">${previewTarget.format}</span>
          </div>
          <div class="code-panel"><div class="code-panel-head">${icon('lock')}Credentials [REDACTED]</div><pre>${esc(JSON.stringify(payload, null, 2))}</pre></div>
        </div>
      `,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="apply-mcp-deploy" ${state.deploySelected.size ? '' : 'disabled'}>
          ${icon('send')}Apply to selected (${state.deploySelected.size})
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
      // Prompts must be previewed individually
    }
    const instruction = change.kind === 'prompt' || change.kind === 'contract';
    const body = `
      <div class="banner" style="margin-bottom:9px">
        ${icon(instruction ? 'eye' : 'shield')}
        <span>${
          instruction
            ? `<b>${change.kind === 'prompt' ? 'Prompt' : 'Agent Instructions'} must be previewed one by one</b>: it affects future AI output or every session. Accepting only writes to the local library; nothing is dispatched automatically.`
            : 'Repository content is written verbatim into the local library; scripts inside skills may be executed, so read everything first.'
        }</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-bottom:8px">
        <span class="badge badge-neutral badge-tight">${change.kind === 'prompt' ? 'Prompt' : change.kind === 'contract' ? 'Instruction' : change.kind === 'skill' ? 'Skill' : 'MCP'}</span>
        <span class="badge badge-outline badge-tight">${esc(change.versionLine)}</span>
        <span class="badge badge-outline badge-tight">1 file</span>
        <code style="overflow:hidden;max-width:100%;border-radius:4px;background:var(--muted);padding:2px 5px;font-family:var(--font-mono);font-size:8.5px;color:var(--muted-fg);text-overflow:ellipsis;white-space:nowrap">${esc(change.path)}</code>
      </div>
      <div class="code-panel" style="margin-bottom:9px">
        <div class="code-panel-head">${icon('git-branch')}Changes in the repo relative to local</div>
        <pre><span class="tok-dim">--- Local version</span>
<span class="tok-dim">+++ Repository version</span>
- Local now: ${esc(change.versionLine)}
+ Repo change: ${esc(change.summary)}
<span class="tok-green">+ Reviewed, safe to write to the local library</span></pre>
      </div>
      ${
        change.risk === 'scripts'
          ? '<div class="health-card" style="margin-bottom:9px">' + icon('alert') + '<div><code>scripts/</code><p>This skill contains executable scripts. Accepting does not dispatch it; you still confirm the target path when dispatching.</p></div></div>'
          : ''
      }
      <label style="display:flex;align-items:flex-start;gap:7px;font-size:10px;line-height:15px;color:var(--fg-2)">
        <input type="checkbox" data-review-trust style="margin-top:2px;accent-color:var(--primary)" />
        <span>I have previewed the full content and confirm it is safe and contains no private information of mine</span>
      </label>
    `;
    openModal({
      title: `Preview and accept — ${change.assetName}`,
      subtitle: instruction ? 'Accepting only writes to the local library; nothing is dispatched to Agents automatically' : 'Repository content is written verbatim into the local library',
      size: 'wide',
      body,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">Reject</button>
        <button type="button" class="btn btn-primary" data-action="accept-change" data-id="${change.id}" disabled>Accept ${change.kind === 'prompt' ? 'Prompt' : change.kind === 'contract' ? 'Instruction' : 'and write locally'}</button>
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
    const remoteVersion = versionText[0]?.replace(/^Repo\s*/, '') || '—';
    const localVersion = versionText[1]?.replace(/^Local\s*/, '') || '—';
    const baseVersion = versionText[2]?.replace(/^Base\s*/, '') || '—';
    openModal({
      title: `Resolve conflict — ${change.assetName}`,
      subtitle: 'Both the repo and local changed the same file; silent overwrite is never allowed',
      size: 'wide',
      body: `
        <div class="preview-summary" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:9px">
          <div class="summary-card"><span class="num" style="background:var(--muted);color:var(--muted-fg)">${esc(baseVersion)}</span><div><div class="label">Base (last sync)</div><div class="sub">Common starting point of the three-way merge</div></div></div>
          <div class="summary-card"><span class="num" style="background:var(--info-soft);color:var(--info)">${esc(remoteVersion)}</span><div><div class="label">Repository version</div><div class="sub">New changes in the remote file</div></div></div>
          <div class="summary-card"><span class="num" style="background:var(--warning-soft);color:var(--warning)">${esc(localVersion)}</span><div><div class="label">Local version</div><div class="sub">New changes in the local library</div></div></div>
        </div>
        <div class="choice-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:9px">
          ${[
            ['remote', 'Use repository', 'Discard local changes; the repo becomes the new base'],
            ['local', 'Keep local', 'Keep local content; the merged result becomes pending push'],
            ['manual', 'Merge manually', 'Edit section by section; safest but slowest'],
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
          <div class="code-panel-head">${icon('git-branch')}Three-way diff</div>
          <pre><span class="tok-dim">@@ Base ${esc(baseVersion)} → Repo ${esc(remoteVersion)} / Local ${esc(localVersion)} @@</span>
+ Repository version: ${esc(change.summary)}
- Local version: keep the local edits to the same file
<span class="tok-green">+ A manual merge can keep valid changes from both sides</span>
<span class="tok-dim"># After applying, it writes to the local library as a new version; you can push it back from Pending push</span></pre>
        </div>
        <p class="hint-text">Choosing Use repository discards local changes; Keep local or Merge manually adds the result to Pending push.</p>
      `,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">Later</button>
        <button type="button" class="btn btn-primary" data-action="resolve-conflict" data-id="${change.id}">${icon('check')}Apply and mark resolved</button>
      `,
    });
  }

  function openSecretChange(change) {
    openModal({
      title: `Plaintext credentials block push — ${change.assetName}`,
      subtitle: `${change.kind === 'prompt' ? 'Prompt' : change.kind === 'mcp' ? 'MCP' : 'Asset'} · ${change.path}`,
      size: 'wide',
      body: `
        <div class="health-card error" style="margin-bottom:9px">${icon('alert')}<div><p>A likely token was found in the body or env / headers. Committing would write the credential permanently into Git history, visible to anyone who can read the repo.</p></div></div>
        <div class="code-panel" style="margin-bottom:9px">
          <div class="code-panel-head">${icon('terminal')}Detected plaintext snippet</div>
          <pre><span class="tok-dim">userPrompt:</span>
  "Test token: <span style="color:#ff9696">sk-live-8f3a2c9d4e5b6a71</span>"

<span class="tok-dim"># Will be replaced with</span>
  "Test token: <span class="tok-green">{{api_key}}</span>"</pre>
        </div>
        <ul style="padding-left:18px;color:var(--muted-fg);font-size:10px;line-height:17px">
          <li>The raw token in the body is replaced with the <code>{{api_key}}</code> template variable; its definition syncs with the file.</li>
          <li>The real value is never written to the Prompt, version snapshots, or the repo; you fill it in temporarily when copying or projecting.</li>
          <li>After replacement, push works normally; this commit still records an audit event that plaintext was found.</li>
        </ul>
      `,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="fix-secret" data-id="${change.id}">${icon('lock')}Replace with template variable</button>
      `,
    });
  }

  function openPushModal() {
    const rows = activeChanges().filter(
      (change) => change.direction === 'outgoing' && !change.blocked,
    );
    openModal({
      title: `Push to repository — ${rows.length} items`,
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
                  <span class="badge badge-warning badge-tight">Pending push</span>
                </div>
              `,
              )
              .join('')}
          </div>
          <div>
            <label class="field-label" for="commit-message">Commit message *</label>
            <input class="input" id="commit-message" value="chore: sync prompts, instructions, skills and MCP templates" />
          </div>
          <div>
            <span class="field-label">Push mode</span>
            <div class="choice-grid">
              <button type="button" class="choice active">${icon('git-branch')}<span><strong>Dedicated branch + PR (recommended)</strong><p>Reviewable and revertible; never touches the main branch directly</p></span></button>
              <button type="button" class="choice">${icon('arrow-up')}<span><strong>Push directly to the current branch</strong><p>Fine for personal repos; a failure never rewrites the remote</p></span></button>
            </div>
          </div>
          <div class="note-strip">${icon('lock')}<span>Bodies of Prompts / instructions and MCP env / headers are scanned again before push; any plaintext credential blocks the entire commit.</span></div>
        </div>
      `,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="do-push">${icon('arrow-up')}Push ${rows.length} items</button>
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
      subtitle: `${assetKind === 'skill' ? 'Skill' : 'MCP'} ${asset.version || ''} · Dispatch is write-only and never modifies the repo`,
      size: 'wide',
      body: `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          ${statusBadge(status, { synced: 'Synced', stale: 'Stale', drifted: 'Drifted', missing: 'Not dispatched' }[status])}
          <span style="color:var(--muted-fg);font-size:9.5px">${
            deployment
              ? `Currently ${deployment.version} · deployed ${deployment.at}`
              : 'This asset is not in the Agent directory yet'
          }</span>
        </div>
        <div class="info-card" style="margin-bottom:8px"><div class="label">Target path</div><div class="value mono">${esc(targetPath)}</div></div>
        ${
          deployment?.note
            ? `<div class="health-card" style="margin-bottom:8px">${icon('alert')}<div><p>${esc(deployment.note)}</p></div></div>`
            : ''
        }
        <span class="field-label">Install mode</span>
        <div class="choice-grid" style="margin-bottom:8px">
          <button type="button" class="choice active">${icon('link')}<span><strong>symlink (recommended)</strong><p>Library edits apply immediately; multiple tools share one file</p></span></button>
          <button type="button" class="choice">${icon('copy')}<span><strong>copy</strong><p>Independent copy per Agent; re-dispatch after updates</p></span></button>
        </div>
        ${
          preview
            ? `<div class="code-panel"><div class="code-panel-head">${icon('lock')}Write preview · credentials [REDACTED]</div><pre>${esc(preview)}</pre></div>`
            : `<div class="note-strip">${icon('folder')}<span>Target directory: <code>${esc(targetPath)}</code></span></div>`
        }
      `,
      footer: `
        <button type="button" class="btn btn-ghost btn-ghost-danger left" data-action="remove-deploy">${icon('trash')}Remove dispatch</button>
        <button type="button" class="btn btn-outline" data-action="close-modal">Close</button>
        <button type="button" class="btn btn-primary" data-action="sync-deploy-cell">${icon('send')}${deployment ? 'Re-sync' : 'Dispatch to this Agent'}</button>
      `,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Other modals                                                       */
  /* ------------------------------------------------------------------ */

  function openPlatformPreview(item) {
    openModal({
      title: item.title,
      subtitle: `${item.author} · ${item.category} · used ${num(item.uses)}×`,
      size: 'wide',
      body: `
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px">
          ${item.tags.map((tag) => `<span class="badge badge-primary badge-tight">#${esc(tag)}</span>`).join('')}
          <span class="badge badge-outline badge-tight">Updated ${esc(item.updatedLabel)}</span>
        </div>
        <div class="md-card md">${md(item.preview + '\n\n## Output structure\n- Lead with conclusions and recommendations\n- Then list evidence and risks\n- Finish with next actions')}</div>
      `,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">Close</button>
        <button type="button" class="btn btn-outline" data-action="copy-platform-prompt" data-id="${item.id}">${icon('copy')}Copy</button>
        <button type="button" class="btn btn-primary" data-action="save-platform-prompt" data-id="${item.id}">Save to My Prompts</button>
      `,
    });
  }

  function openGlobalPreview() {
    const targets = D.globalTargets.filter((target) => state.selectedGlobalTargets.has(target.id));
    const contracts = state.contracts.filter((contract) => state.selectedGlobalContracts.has(contract.id));
    if (!targets.length || !contracts.length) {
      toast('Select instructions and global directories first', { tone: 'warning' });
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
      title: 'Global directory write preview',
      subtitle: 'Shows only the files about to be written into local Agent directories; real writes also check paths and drift',
      size: 'wide',
      body: files
        .map(
          (file) => `
          <div class="compiled-file" style="margin-bottom:8px">
            <div class="compiled-head">${icon('file')}<span style="font-size:9px;font-weight:550">${esc(file.target.label)}</span><span class="badge badge-outline badge-tight">${file.target.pathMode === 'file' ? 'Merged file' : 'Separate file'}</span><code style="margin-left:auto">${esc(file.path)}</code></div>
            <pre>${esc(`<!-- pk:begin · managed by Prompt Keeper -->\n${file.body}\n<!-- pk:end -->`)}</pre>
          </div>
        `,
        )
        .join(''),
      footer: '<button type="button" class="btn btn-outline" data-action="close-modal">Close</button>',
    });
  }

  function openMcpStoreInstall(item) {
    openModal({
      title: `Install MCP — ${item.name}`,
      subtitle: 'Review config, launch command, and credential fields before installing; installation only writes to the local library',
      size: 'wide',
      body: `
        <div class="banner" style="margin-bottom:9px">${icon('shield')}<span>Installing does not write any Agent config immediately; you must additionally run Apply to platforms and confirm the target path before writing.</span></div>
        <div class="form-grid">
          <div class="info-grid">
            <div class="info-card"><div class="label">Transport</div><div class="value">${esc(item.transport)}</div></div>
            <div class="info-card"><div class="label">Installs</div><div class="value tabular">${num(item.downloads)} times</div></div>
          </div>
          <div>
            <span class="field-label">What it does</span>
            <p style="color:var(--muted-fg);font-size:10px;line-height:17px">${esc(item.whatItDoes)}</p>
          </div>
          <div>
            <span class="field-label">Use cases</span>
            <div class="var-list">
              ${item.useCases.map((useCase) => `<span class="var-chip" style="font-family:var(--font-sans)">${esc(useCase)}</span>`).join('')}
            </div>
          </div>
          <div>
            <span class="field-label">Install command</span>
            <div class="code-panel"><div class="code-panel-head">${icon('terminal')}terminal</div><pre>${esc(item.installCommand)}</pre></div>
          </div>
          ${
            item.envDocs.length
              ? `<div>
                  <span class="field-label">Credential fields (fill in after install)</span>
                  <div style="display:flex;flex-direction:column;gap:5px">
                    ${item.envDocs
                      .map(
                        (doc) => `
                        <div class="target-row">
                          ${icon('key')}
                          <div class="info"><strong>${esc(doc.key)}</strong><span>${esc(doc.desc)}</span></div>
                          <span class="badge badge-warning badge-tight">Required</span>
                        </div>
                      `,
                      )
                      .join('')}
                  </div>
                </div>`
              : '<div class="note-strip">' + icon('check') + '<span>This MCP needs no additional credentials.</span></div>'
          }
          <div class="note-strip">${icon('lock')}<span>The repo syncs only the <code>${'${VAR}'}</code> placeholder; real values are stored with AES-256-GCM encryption in the local keychain and never enter version snapshots.</span></div>
        </div>
      `,
      footer: `
        <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="confirm-install-mcp-store" data-id="${item.id}">${icon('download')}Install to My Library</button>
      `,
    });
  }

  function openExternalMcpImport(agent, name) {
    openModal({
      title: `Reverse import — ${name}`,
      subtitle: `${agent.name} · External MCP entry read from the Agent config`,
      size: 'wide',
      body: `
        <div class="form-grid">
          <div class="info-grid">
            <div class="info-card"><div class="label">Source</div><div class="value mono">${esc(agent.mcpFile)}</div></div>
            <div class="info-card"><div class="label">Ownership</div><div class="value">External install · not in My Library</div></div>
          </div>
          <div class="note-strip">${icon('info')}<span>Reverse import only reads the config entry and copies it into the local library; the original Agent file is untouched. After import it gains versions and repository template sync, but real credentials are never copied.</span></div>
          <div>
            <span class="field-label">Config after import (redacted)</span>
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
        <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="confirm-import-external-mcp" data-agent="${agent.id}" data-name="${esc(name)}">Import to My Library</button>
      `,
    });
  }

  function openRepoSettings() {
    openModal({
      title: 'Repository settings',
      subtitle: 'tony/ai-assets · main',
      size: 'wide',
      body: `
        <div class="form-grid">
          <div class="info-grid">
            <div class="info-card"><div class="label">Provider</div><div class="value">GitHub · Private repo</div></div>
            <div class="info-card"><div class="label">Authentication</div><div class="value">${esc(D.repo.auth)}</div></div>
            <div class="info-card"><div class="label">Auto fetch</div><div class="value">${esc(D.repo.autoFetch)}</div></div>
            <div class="info-card"><div class="label">Push mode</div><div class="value">${esc(D.repo.pushMode)}</div></div>
          </div>
          <div class="info-card"><div class="label">Local clone path</div><div class="value mono">${esc(D.repo.localPath)}</div><div class="hint">The real product uses an app-managed directory, not the user's project repo.</div></div>
          <div class="note-strip">${icon('shield')}<span>The repo stores only the four asset types and templates; real secrets, global directory paths, and dispatch state stay on this machine.</span></div>
        </div>
      `,
      footer: '<button type="button" class="btn btn-primary" data-action="close-modal">Done</button>',
    });
  }

  function openDeployModalForNew(assetId) {
    const agent = D.agents.find((item) => item.id === 'claude');
    openModal({
      title: `Dispatch to ${agent.name}`,
      subtitle: 'Choose an install mode; dispatch is write-only',
      body: `
        <div class="form-grid">
          <div class="info-card"><div class="label">Target path</div><div class="value mono">${esc(agent.skillDir)}/${esc(assetId)}/</div></div>
          <div class="choice-grid">
            <button type="button" class="choice active">${icon('link')}<span><strong>symlink (recommended)</strong><p>Library edits apply immediately</p></span></button>
            <button type="button" class="choice">${icon('copy')}<span><strong>copy</strong><p>Independent copy; re-dispatch after updates</p></span></button>
          </div>
        </div>
      `,
      footer: '<button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button><button type="button" class="btn btn-primary" data-action="close-modal">Confirm dispatch</button>',
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
        toast(`Theme switched to ${state.theme === 'system' ? 'System' : state.theme === 'dark' ? 'Dark' : 'Light'}`, { tone: 'info' });
        break;
      case 'set-theme':
        state.theme = el.dataset.theme;
        applyTheme();
        if (state.page === 'settings') renderWorkspaceOnly();
        toast('Appearance settings saved', { tone: 'info' });
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
          toast(prompt.favorite ? `Added "${prompt.title}"` : 'Removed from favorites', { tone: 'info' });
        }
        break;
      }
      case 'toggle-prompt-pin': {
        const prompt = state.prompts.find((item) => item.id === id);
        if (prompt) {
          prompt.pinned = !prompt.pinned;
          renderWorkspaceOnly();
          toast(prompt.pinned ? 'Pinned' : 'Unpinned', { tone: 'info' });
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
          copyText(text.trim(), `Copied "${prompt.title}" to clipboard`).then((copied) => {
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
          toast(`Restored v${el.dataset.version}; current content saved as a new version`);
        }
        break;
      }
      case 'delete-prompt': {
        const prompt = state.prompts.find((item) => item.id === id);
        if (prompt) {
          openModal({
            title: 'Delete Prompt?',
            subtitle: 'This cannot be undone',
            size: 'small',
            body: `<p style="color:var(--muted-fg);font-size:11px;line-height:18px">This deletes "<b style="color:var(--fg)">${esc(prompt.title)}</b>" and all its historical versions.${
              prompt.sync === 'local'
                ? ''
                : '<span style="display:block;margin-top:7px;border:1px solid var(--warning-border);border-radius:7px;background:var(--warning-soft);padding:7px 9px;color:var(--warning)">This Prompt participates in repository sync. Only the local copy is deleted; repository files are untouched.</span>'
            }</p>`,
            footer: `
              <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
              <button type="button" class="btn btn-danger" data-action="confirm-delete-prompt" data-id="${prompt.id}">Delete</button>
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
        toast(`Deleted "${prompt?.title || 'Prompt'}"`);
        break;
      }
      case 'sync-prompt': {
        const prompt = state.prompts.find((item) => item.id === id);
        if (prompt) {
          openModal({
            title: `Sync scope — ${prompt.title}`,
            subtitle: 'Prompts can opt into Git sync; local-only Prompts are not written to Agent directories',
            body: `
              <div class="form-grid">
                <div class="info-grid">
                  <div class="info-card"><div class="label">Current status</div><div class="value">${statusBadge(prompt.sync, prompt.syncLabel)}</div></div>
                  <div class="info-card"><div class="label">Repository file</div><div class="value mono">${esc(prompt.repoPath)}</div></div>
                </div>
                <div>
                  <span class="field-label">Sync policy</span>
                  <div class="choice-grid">
                    <button type="button" class="choice ${prompt.sync !== 'local' ? 'active' : ''}">${icon('git-branch')}<span><strong>Follow repo policy</strong><p>Writes to prompts/&lt;folder&gt;/&lt;slug&gt;.prompt.md</p></span></button>
                    <button type="button" class="choice ${prompt.sync === 'local' ? 'active' : ''}">${icon('file')}<span><strong>Local only</strong><p>Keep local; never written to the repo or Agent directories</p></span></button>
                  </div>
                </div>
                <div class="note-strip">${icon('shield')}<span>High-confidence credentials in the Prompt body are scanned before push; matches must be replaced with <code>{{variable}}</code>.</span></div>
              </div>
            `,
            footer: `
              <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
              <button type="button" class="btn btn-primary" data-action="save-prompt-sync">Save sync scope</button>
            `,
          });
        }
        break;
      }
      case 'save-prompt-sync':
        closeOverlay();
        toast('Sync scope saved; changes become pending push');
        break;

      case 'preview-platform-prompt': {
        const item = D.platformPrompts.find((entry) => entry.id === id);
        if (item) openPlatformPreview(item);
        break;
      }
      case 'copy-platform-prompt': {
        const item = D.platformPrompts.find((entry) => entry.id === id);
        if (item) copyText(item.description + '\n\n' + item.preview, `Copied platform Prompt "${item.title}"`);
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
            updatedLabel: 'Just now',
            system: item.preview,
            user: '{{input}}',
            variables: [{ name: 'input', type: 'textarea', required: true }],
            sync: 'local',
            syncLabel: 'Local only',
            repoPath: '— Local only by default after saving',
            versions: [{ v: 1, note: 'Saved from platform', at: 'Just now', current: true }],
          };
          state.prompts.unshift(newPrompt);
          state.selectedPrompt = newPrompt.id;
          state.promptTab = 'mine';
          state.search = '';
          $('#global-search').value = '';
          closeOverlay();
          render();
          toast(`Saved "${item.title}" to My Prompts (local only)`);
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
        if (contract) copyText(contract.body, `Copied "${contract.title}" body`);
        break;
      }
      case 'edit-contract': {
        const contract = state.contracts.find((item) => item.id === id);
        if (contract) {
          openModal({
            title: `Edit contract — ${contract.title}`,
            subtitle: 'Saving creates a new version; related projections are marked Stale',
            size: 'wide',
            body: `
              <form class="form-grid" data-form="edit-contract" id="contract-form">
                <div class="form-row">
                  <div><label class="field-label">Title</label><input class="input" name="title" value="${esc(contract.title)}" /></div>
                  <div><label class="field-label">Folder</label><input class="input mono" name="folder" value="${esc(contract.folder)}" /></div>
                </div>
                <div><label class="field-label">Description</label><input class="input" name="description" value="${esc(contract.description)}" /></div>
                <div><label class="field-label">Contract body (Markdown)</label><textarea class="textarea" name="body" rows="10" style="font-family:var(--font-mono);font-size:10.5px">${esc(contract.body)}</textarea></div>
              </form>
            `,
            footer: `
              <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
              <button type="submit" form="contract-form" class="btn btn-primary">Save changes</button>
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
            title: `Version history — ${contract.title}`,
            subtitle: 'Restoring a historical version never overwrites projections in Agent directories',
            body: `
              <div>
                <div class="version-row current"><span class="version-num">v${contract.version}</span><div class="version-main"><strong>Current version · ${esc(contract.updatedLabel)}</strong><p>Latest locally, marked "${esc(contract.syncLabel)}"</p></div><span class="badge badge-primary badge-tight">In use</span></div>
                <div class="version-row"><span class="version-num">v${Math.max(1, contract.version - 1)}</span><div class="version-main"><strong>Historical version · initial</strong><p>10 days ago · restorable</p></div><button type="button" class="btn btn-outline btn-xs" data-action="restore-contract-version">Restore</button></div>
              </div>
            `,
            footer: '<button type="button" class="btn btn-primary" data-action="close-modal">Done</button>',
          });
        }
        break;
      }
      case 'restore-contract-version':
        closeOverlay();
        toast('Historical version restored; current content saved as a new version; related projections marked Stale');
        break;
      case 'contract-sync': {
        const contract = state.contracts.find((item) => item.id === id);
        if (contract) openContractSync(contract);
        break;
      }
      case 'save-contract-sync':
        closeOverlay();
        toast('Sync scope saved; contract is pending push');
        break;
      case 'delete-contract': {
        const contract = state.contracts.find((item) => item.id === id);
        if (contract) {
          openModal({
            title: 'Delete instruction contract?',
            subtitle: 'Projected target files are not deleted automatically',
            size: 'small',
            body: `<p style="color:var(--muted-fg);font-size:11px;line-height:18px">This deletes "<b style="color:var(--fg)">${esc(contract.title)}</b>" and all historical versions. Projected to ${contract.targets.length} target(s); deleting the local contract does not delete files already written to Agent directories — remove them individually under Project projections.</p>`,
            footer: `
              <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
              <button type="button" class="btn btn-danger" data-action="confirm-delete-contract" data-id="${contract.id}">Delete</button>
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
        toast('Local contract deleted; target files must be removed individually');
        break;
      case 'new-contract':
        openModal({
          title: 'New Agent instruction contract',
          subtitle: 'One canonical contract, compiled to each Agent\'s native format',
          size: 'wide',
          body: `
            <form class="form-grid" data-form="new-contract" id="new-contract-form">
              <div class="form-row">
                <div><label class="field-label">Title *</label><input class="input" name="title" required placeholder="e.g. Frontend code standards" /></div>
                <div><label class="field-label">Folder</label><input class="input mono" name="folder" placeholder="team/frontend" /></div>
              </div>
              <div><label class="field-label">Description</label><input class="input" name="description" placeholder="One sentence on scope and purpose" /></div>
              <div class="form-row">
                <div><label class="field-label">Scope</label><div class="select"><select name="scope"><option>Project</option><option>Path</option></select>${icon('chevron-down')}</div></div>
                <div><label class="field-label">Activation</label><div class="select"><select name="activation"><option>Always on</option><option>Glob</option><option>Model decision</option><option>Manual</option></select>${icon('chevron-down')}</div></div>
              </div>
              <div><label class="field-label">Contract body (Markdown)</label><textarea class="textarea" name="body" rows="8" style="font-family:var(--font-mono);font-size:10.5px" placeholder="# Team conventions&#10;&#10;- Rule one&#10;- Rule two"></textarea></div>
            </form>
          `,
          footer: `
            <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
            <button type="submit" form="new-contract-form" class="btn btn-primary">Create contract</button>
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
          toast('Explicitly overwrote manual Agent-side changes; this can be rolled back', { tone: 'warning' });
        } else if (status === 'remove') {
          toast('Projection removed; the local library and repo are unaffected', { tone: 'info' });
        } else {
          toast('Re-projected; target files match the contract');
        }
        break;
      }
      case 'reproject-all':
        toast('Projection status refreshed: 3 stale · 2 drifted', { tone: 'info' });
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
          toast(`Restored the default path for ${target.label}`);
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
          `Projected instructions: ${state.selectedGlobalContracts.size} · global directories: ${state.selectedGlobalTargets.size} (simulated write)`,
        );
        break;
      case 'global-projection-action':
        toast(
          el.dataset.status === 'drifted'
            ? 'Explicitly overwrote manual changes in the global directory; this can be rolled back'
            : el.dataset.status === 'remove'
              ? 'Global projection removed; the local library and repo are unaffected'
              : 'Re-projected to the global directory',
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
          toast(`Installed via symlink to ${SKILL_PLATFORMS.find((item) => item.id === el.dataset.platform)?.name}`);
        }
        break;
      }
      case 'remove-skill-platform': {
        const skill = state.skills.find((item) => item.id === el.dataset.skill);
        if (skill) {
          delete skill.installs[el.dataset.platform];
          renderSkillModal();
          renderWorkspaceOnly();
          toast('Removed the skill from the platform', { tone: 'info' });
        }
        break;
      }
      case 'toast-skill-edit':
        toast('Editing creates a new version and marks it pending push', { tone: 'info' });
        break;
      case 'toast-skill-delete':
        toast('Prototype demo: deletion requires a second confirmation in the real product', { tone: 'warning' });
        break;
      case 'toast-skill-versions':
        toast('Version history: v1.2.0 (current) · 1.1.0 · 1.0.0', { tone: 'info' });
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
          updatedLabel: 'Just now',
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
        toast(`"${item.name}" installed and dispatched to ${wizard.platforms.length} platform(s)`);
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
          toast(`${server.name} ${server.enabled ? 'enabled' : 'disabled'}`, { tone: server.enabled ? 'success' : 'warning' });
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
        if (server) copyText(mcpConfig(server), `Copied "${server.name}" redacted config`);
        break;
      }
      case 'edit-mcp':
        toast('Prototype demo: form / JSON dual-mode editing; saving creates a version and marks it pending push', { tone: 'info' });
        break;
      case 'mcp-versions':
        toast('Version history: v2 (current) · v1 · restoring never rewrites Agent config', { tone: 'info' });
        break;
      case 'delete-mcp':
        toast('Prototype demo: deletion clears config, versions, and credential records but leaves Agent-side entries in place', { tone: 'warning' });
        break;
      case 'new-mcp':
        toast('New MCP: install from the store, paste JSON, or reverse-import from an Agent', { tone: 'info' });
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
            folder: 'store/mcp',
            tags: ['Store'],
            source: 'market',
            installs: {},
            notes: '',
            health: item.envDocs.map((doc) => ({
              level: 'warning',
              field: `env.${doc.key}`,
              message: 'Required environment variable is empty; the service will fail to start after dispatch to an Agent.',
            })),
            version: 1,
            updatedLabel: 'Just now',
            repoPath: `mcp/store/mcp/${item.name}.json`,
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
          toast(`Installed "${item.name}" to My MCP; fill in the credential fields before use`, {
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
            description: `From ${agent.name} config file (reverse-imported external MCP entry).`,
            transport: 'stdio',
            command: 'npx',
            args: ['-y', name],
            env: {},
            enabled: true,
            favorite: false,
            folder: `Imported/${agent.name}`,
            tags: ['Imported'],
            source: 'import',
            installs: { [agent.id]: true },
            notes: 'Reverse-imported from the Agent config; verify the launch command and credentials.',
            health: [
              {
                level: 'warning',
                field: 'command',
                message: 'Imported entry has no verifiable launch command; confirm it when editing.',
              },
            ],
            version: 1,
            updatedLabel: 'Just now',
            repoPath: `mcp/Imported/${agent.name}/${name}.json`,
            config: { transport: 'stdio', command: 'npx', args: ['-y', name], env: {} },
          };
          state.mcps.unshift(imported);
          state.selectedMcp = imported.id;
          state.mcpSection = 'mine';
          closeOverlay();
          render();
          toast(`Reverse-imported "${name}" into My Library`);
        }
        break;
      }
      case 'open-agent-mcp-config':
        toast('Prototype demo: opens and validates the Agent MCP config file, preserving the original file permissions before writing', { tone: 'info' });
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
          toast(`Applied ${server.name} to ${state.deploySelected.size} platforms (simulated write)`);
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
        toast('Fetch complete: 3 remote commits pending review', { tone: 'info' });
        break;
      case 'sync-push':
        openPushModal();
        break;
      case 'sync-settings':
        openRepoSettings();
        break;
      case 'redetect-agents':
        toast('Detection complete: 6 local Agents found; uninstalled tools are never written', { tone: 'info' });
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
          toast(`Accepted ${change.assetName}; a new version was created in the local library`);
        }
        break;
      }
      case 'accept-low-risk':
        toast('Low-risk changes accepted and versioned; Prompts and instructions still require individual preview', { tone: 'info' });
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
        toast('Replaced with the {{api_key}} variable; the real value was never persisted', { tone: 'warning' });
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
        toast('Conflict resolved; the merge result is now pending push');
        break;
      }
      case 'do-push':
        closeOverlay();
        toast('Pushed changes to a dedicated branch and opened PR #24 (simulated)');
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
        toast('Re-synced the asset to the target Agent');
        break;
      case 'remove-deploy':
        closeOverlay();
        toast('Dispatch removed; the local library and repo are unaffected', { tone: 'info' });
        break;
      case 'sync-all-stale':
        toast('Re-dispatched 3 stale assets; drifted items were not overwritten', { tone: 'warning' });
        break;
      case 'reset-demo':
        openModal({
          title: 'Reset demo data?',
          subtitle: 'Clears local preferences and restores the initial state',
          size: 'small',
          body: '<p style="color:var(--muted-fg);font-size:11px;line-height:18px">Only the theme and view preferences in the browser are cleared, then the page reloads. The prototype data itself is not modified.</p>',
          footer: `
            <button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button>
            <button type="button" class="btn btn-danger" data-action="confirm-reset-demo">Reset and reload</button>
          `,
        });
        break;
      case 'confirm-reset-demo':
        localStorage.removeItem('pk_hifi_theme');
        localStorage.removeItem('pk_hifi_prompt_view');
        location.reload();
        break;
      case 'toast-info':
        toast(el.dataset.message || 'Prototype demo', { tone: 'info' });
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
        toast('Title is required', { tone: 'warning' });
        return;
      }
      const tags = String(values.tags || '')
        .split(/,/)
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
        existing.updatedLabel = 'Just now';
        existing.sync = existing.sync === 'local' ? 'local' : 'pending';
        existing.syncLabel = existing.sync === 'local' ? 'Local only' : 'Pending push';
        existing.versions.unshift({ v: existing.version, note: 'Local edit', at: 'Just now', current: true });
        state.selectedPrompt = existing.id;
        closeOverlay();
        render();
        toast(`Saved "${title}", local version v${existing.version}`);
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
          updatedLabel: 'Just now',
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
          syncLabel: 'Local only',
          repoPath: '— Local only by default after creation',
          versions: [{ v: 1, note: 'New', at: 'Just now', current: true }],
        };
        state.prompts.unshift(newPrompt);
        state.selectedPrompt = newPrompt.id;
        state.promptTab = 'mine';
        closeOverlay();
        render();
        toast(`Created "${title}"; local only by default`);
      }
      return;
    }

    if (form.dataset.form === 'copy-variables') {
      const target = state.prompts.find((item) => item.id === state.modalPromptId) || null;
      if (target) {
        const rendered = [replaceTemplate(target.system, values), replaceTemplate(target.user, values)]
          .filter(Boolean)
          .join('\n\n');
        copyText(rendered, `Copied "${target.title}" to clipboard; usage +1`).then((copied) => {
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
          <div class="test-result-head">${icon('flask')}Running · ${esc(values.model || 'Model')}<span class="badge badge-info badge-tight">Simulated</span></div>
          <div class="test-result-body" style="display:flex;align-items:center;gap:8px;color:var(--muted-fg);font-size:10px"><span class="spinner"></span>Rendering Prompt and waiting for model response…</div>
        </div>
      `;
      setTimeout(() => {
        if (!document.contains(area)) return;
        area.innerHTML = `
          <div class="test-result">
            <div class="test-result-head">${icon('check')}Test complete · ${esc(values.model || 'Model')}<span class="badge badge-success badge-tight">1.8s elapsed</span></div>
            <div class="test-result-body md">
              ${md(
                `## Simulated output\n\nTemplate rendered with ${target.variables.length} variables matched.\n\n| Dimension | Score | Key findings |\n| --- | --- | --- |\n| Correctness | 8/10 | Logic is complete; edge cases need more coverage |\n| Readability | 9/10 | Clear naming, reasonable function length |\n| Performance | 7/10 | Avoid recomputing inside loops |\n| Security | 8/10 | External input still needs validation |\n\n**Overall: safe to merge; add edge-case tests.**`,
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
        contract.updatedLabel = 'Just now';
        contract.sync = 'pending';
        contract.syncLabel = 'Pending push';
        closeOverlay();
        render();
        toast(`Saved "${contract.title}", generated v${contract.version}`);
      }
      return;
    }

    if (form.dataset.form === 'new-contract') {
      const title = String(values.title || '').trim();
      if (!title) {
        toast('Title is required', { tone: 'warning' });
        return;
      }
      const contract = {
        id: `c-${Date.now()}`,
        title,
        description: String(values.description || '').trim(),
        folder: String(values.folder || '').trim() || 'Uncategorized',
        scope: String(values.scope || 'Project'),
        scopeDesc: 'Applies at the project root',
        activation: String(values.activation || 'Always on'),
        activationDesc: 'Always enters context every session',
        priority: 50,
        targets: ['agents-md', 'claude'],
        tags: [],
        version: 1,
        updatedLabel: 'Just now',
        updatedAt: Date.now(),
        sync: 'local',
        syncLabel: 'Local only',
        repoPath: '— Local only by default after creation',
        imports: [],
        globalStatus: 'Not projected yet',
        body: String(values.body || '').trim() || '# New contract\n\n- Write your constraints here.',
        globalProjections: 'Not projected yet',
      };
      state.contracts.unshift(contract);
      state.selectedContract = contract.id;
      state.instructionTab = 'library';
      closeOverlay();
      render();
      toast(`Created contract "${title}"; local only by default`);
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
        toast('Global paths must be absolute, starting with ~ or /', { tone: 'warning' });
        el.value = state.globalPaths[el.dataset.id];
        return;
      }
      state.globalPaths[el.dataset.id] = value;
      toast(`Updated the ${target?.label || 'global directory'} path; related projections marked Stale`, { tone: 'info' });
    } else if (action === 'mcp-notes') {
      const server = state.mcps.find((item) => item.id === el.dataset.id);
      if (server) {
        server.notes = el.value;
        toast('Personal notes saved (no version created)', { tone: 'info' });
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
