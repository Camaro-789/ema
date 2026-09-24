const fs = require('fs');

// ── 1. Update index.html – inject node-info bar into the diagram-workspace ──
let html = fs.readFileSync('d:/Desktop/VS/ema/frontend/index.html', 'utf8');

// Replace the top-toolbar wrapper inside diagram-workspace to add the info bar ABOVE
const OLD_WORKSPACE_OPEN = `    <div class="diagram-workspace" id="diagramWorkspace">
      <div class="top-toolbar">`;

const NEW_WORKSPACE_OPEN = `    <div class="diagram-workspace" id="diagramWorkspace">
      <!-- Node identity bar -->
      <div class="diag-identity-bar" id="diag-identity-bar">
        <div class="diag-identity-left">
          <span class="diag-identity-name" id="diag-identity-name">—</span>
          <span class="diag-identity-sep">·</span>
          <span class="diag-identity-code" id="diag-identity-code">—</span>
        </div>
        <div class="diag-identity-actions">
          <button class="diag-identity-btn" id="diag-btn-save" data-tooltip="Guardar diagrama">
            <i class="fa-solid fa-floppy-disk"></i>
          </button>
          <button class="diag-identity-btn" id="diag-btn-back" data-tooltip="Volver al mapa">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
        </div>
      </div>
      <div class="top-toolbar">`;

if (html.includes(OLD_WORKSPACE_OPEN)) {
  html = html.replace(OLD_WORKSPACE_OPEN, NEW_WORKSPACE_OPEN);
  console.log('✓ Injected identity bar into index.html');
} else {
  console.log('✗ Could not find workspace open anchor in index.html');
}

fs.writeFileSync('d:/Desktop/VS/ema/frontend/index.html', html, 'utf8');

// ── 2. Update diagrama.css – add identity bar styles ──
let css = fs.readFileSync('d:/Desktop/VS/ema/frontend/css/diagrama.css', 'utf8');

const barCss = `
/* ---- Node Identity Bar ---- */
.diag-identity-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 56px; /* don't overlap the sidebar-dock */
  height: 40px;
  background: #ffffff;
  border-bottom: 1px solid rgba(0,0,0,0.07);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  z-index: 20;
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
}

.diag-identity-left {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.diag-identity-name {
  font-size: 12px;
  font-weight: 600;
  color: #1d1d1f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

.diag-identity-sep {
  font-size: 12px;
  color: #c7c7cc;
}

.diag-identity-code {
  font-size: 11px;
  font-weight: 500;
  color: #86868b;
  white-space: nowrap;
}

.diag-identity-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.diag-identity-btn {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: #1d1d1f;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.18s ease;
  position: relative;
}

.diag-identity-btn:hover {
  background: #f5f5f7;
}

.diag-identity-btn::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translate(-50%, 4px);
  background: #000;
  color: #fff;
  padding: 4px 8px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: all 0.15s ease;
  z-index: 200;
}
.diag-identity-btn:hover::after {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, 0);
}

/* Push body container down to account for identity bar */
.diag-body-container {
  top: 100px !important; /* 40px bar + 60px top-toolbar */
}
`;

css += barCss;
fs.writeFileSync('d:/Desktop/VS/ema/frontend/css/diagrama.css', css, 'utf8');
console.log('✓ Added identity bar CSS to diagrama.css');
