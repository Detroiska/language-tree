import { esc } from "./escape.js";
import { toolsForTab } from "./languageTools.js";

export function toolTabId(tab, tool) {
  return `tool-tab-${tab}-${tool}`;
}

export function toolPanelId(tab, tool) {
  return `tool-panel-${tab}-${tool}`;
}

function toolHint(tab, activeTool) {
  return toolsForTab(tab).find((tool) => tool.id === activeTool)?.hint || "";
}

export function toolTabsMarkup(tab, activeTool, label) {
  const tools = toolsForTab(tab);
  if (!tools.length) return "";
  const group = tools.find((tool) => tool.id === activeTool) || tools[0];
  return `
    <div class="tool-tabs-wrap">
      <div class="tool-tabs" role="tablist" aria-label="${esc(label)}" data-tool-tabs>
        ${tools
          .map((tool) => {
            const selected = tool.id === group.id;
            return `<button class="tool-tab${selected ? " is-active" : ""}" id="${toolTabId(tab, tool.id)}" type="button" role="tab" aria-selected="${selected}" aria-controls="${toolPanelId(tab, tool.id)}" tabindex="${selected ? "0" : "-1"}" data-tool-tab="${esc(tool.id)}">${esc(tool.label)}</button>`;
          })
          .join("")}
      </div>
      <p class="tool-hint" data-tool-hint>${esc(toolHint(tab, group.id))}</p>
    </div>`;
}

export function toolPanelAttrs(tab, tool, activeTool) {
  return `id="${toolPanelId(tab, tool)}" role="tabpanel" aria-labelledby="${toolTabId(tab, tool)}" data-tool-panel="${esc(tool)}"${
    tool === activeTool ? "" : " hidden"
  }`;
}

// Toggle the mounted panels and keep the URL in sync without re-rendering the
// whole language view. Reloads, back/forward, and explicit hash changes still
// go through the normal route renderer.
export function setupToolTabs(container, { tab, activeTool, hrefForTool, onSelect }) {
  const tablist = container.querySelector("[data-tool-tabs]");
  if (!tablist) return null;
  const buttons = [...tablist.querySelectorAll("[data-tool-tab]")];
  const panels = [...container.querySelectorAll("[data-tool-panel]")];
  const hint = container.querySelector("[data-tool-hint]");
  let current = activeTool;

  if (!buttons.length) return null;

  const select = (tool, { focus = false, updateUrl = true } = {}) => {
    const button = buttons.find((item) => item.dataset.toolTab === tool);
    if (!button) return;
    current = tool;
    for (const item of buttons) {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      if (active && focus) item.focus();
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.toolPanel !== tool;
    }
    if (hint) {
      hint.textContent = toolsForTab(tab).find((item) => item.id === tool)?.hint || "";
    }
    if (updateUrl && hrefForTool) {
      const next = hrefForTool(tool);
      if (next && window.location.hash !== next) {
        window.history.pushState(null, "", next);
      }
    }
    onSelect?.(tool);
  };

  tablist.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tool-tab]");
    if (!button) return;
    select(button.dataset.toolTab);
  });

  tablist.addEventListener("keydown", (event) => {
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    let next = null;
    if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    if (next == null) return;
    event.preventDefault();
    select(buttons[next].dataset.toolTab, { focus: true });
  });

  return { select, current: () => current, buttons, panels };
}
