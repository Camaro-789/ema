const fs = require('fs');
const extraCss = `
/* ======== NEW APPLE STYLE DIAGRAMA ======== */
.app-card {
  width: 95vw;
  height: 90vh;
  max-width: 1400px;
  max-height: 900px;
  background: #ffffff;
  border-radius: 16px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.05);
  display: flex;
  overflow: hidden;
  position: relative;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', sans-serif;
}

.diagram-workspace {
  flex: 1;
  height: 100%;
  background-color: #fafafa;
  background-image: radial-gradient(circle, #e0e0e0 1px, transparent 1px);
  background-size: 20px 20px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: box-shadow 0.25s ease;
  overflow: hidden;
}

.diagram-workspace.illuminating {
  box-shadow: inset 0 0 0 3px rgba(255, 59, 48, 0.35);
}

.diag-body-container {
  position: absolute;
  top: 60px;
  bottom: 60px;
  left: 0;
  right: 0;
  overflow: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
}

.top-toolbar {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 15;
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.06);
  box-shadow: 0 6px 18px rgba(0,0,0,0.08);
  display: flex;
  align-items: center;
  padding: 6px;
  gap: 4px;
}

.toolbar-divider {
  width: 1px;
  height: 22px;
  background: #e5e5ea;
  margin: 0 4px;
}

.toolbar-btn {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  border: none;
  background: transparent;
  color: #1d1d1f;
  font-size: 15px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  position: relative;
  flex-shrink: 0;
}

.toolbar-btn:hover { background: #f5f5f7; }
.toolbar-btn.active { background: #000000; color: #ffffff; }

.mode-btn {
  width: auto;
  padding: 0 12px 0 10px;
  gap: 7px;
  font-size: 13px;
  font-weight: 500;
}
.mode-btn i.chevron { font-size: 10px; transition: transform 0.2s ease; }
.mode-btn.open i.chevron { transform: rotate(180deg); }

.mode-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  width: 160px;
  background: #ffffff;
  border-radius: 10px;
  border: 1px solid rgba(0,0,0,0.06);
  box-shadow: 0 8px 20px rgba(0,0,0,0.1);
  padding: 6px;
  display: none;
  flex-direction: column;
  gap: 2px;
}
.mode-dropdown.open { display: flex; }

.mode-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 7px;
  font-size: 13px;
  color: #1d1d1f;
  cursor: pointer;
}
.mode-option:hover { background: #f5f5f7; }
.mode-option i { font-size: 11px; color: #000; opacity: 0; }
.mode-option.selected i { opacity: 1; }

.toolbar-btn::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 50%;
  background: #000000;
  color: #ffffff;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: all 0.2s ease;
  z-index: 100;
}
.top-toolbar .toolbar-btn::after {
  top: calc(100% + 8px);
  transform: translate(-50%, -6px);
}
.top-toolbar .toolbar-btn:hover::after {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, 0);
}
.bottom-toolbar .toolbar-btn::after {
  bottom: calc(100% + 8px);
  transform: translate(-50%, 6px);
}
.bottom-toolbar .toolbar-btn:hover::after {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, 0);
}

.bottom-toolbar {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 15;
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.06);
  box-shadow: 0 6px 18px rgba(0,0,0,0.08);
  display: flex;
  align-items: center;
  padding: 6px;
  gap: 4px;
}

.toolbar-btn.danger:hover { background: #fdeceb; color: #ff3b30; }

.sidebar-dock {
  width: 56px;
  height: 100%;
  background: #ffffff;
  border-left: 1px solid #f0f0f0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 16px;
  padding-bottom: 16px;
  gap: 12px;
  z-index: 20;
}

.sidebar-btn {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: #1d1d1f;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  position: relative;
}

.sidebar-btn:hover { background: #f5f5f7; }
.sidebar-btn.active { background: #000000; color: #ffffff; }

.sidebar-drawer {
  position: absolute;
  right: 56px;
  top: 0;
  width: 300px;
  height: 100%;
  background: #ffffff;
  border-left: 1px solid #f0f0f0;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.03);
  transform: translateX(100%);
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 10;
  padding: 24px;
  display: flex;
  flex-direction: column;
}

.sidebar-drawer.open {
  transform: translateX(0);
  opacity: 1;
  visibility: visible;
}

.drawer-content { display: none; height: 100%; flex-direction: column; }
.drawer-content.active { display: flex; }

.drawer-header {
  font-size: 16px;
  font-weight: 600;
  color: #1d1d1f;
  margin-bottom: 16px;
  letter-spacing: -0.02em;
}

.drawer-body { font-size: 13px; color: #515154; line-height: 1.5; }

.info-list, .timeline-list, .pending-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0;
  margin: 0;
}

.info-item {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #f5f5f7;
  padding-bottom: 8px;
}

.info-label { color: #86868b; }
.info-val { font-weight: 500; color: #1d1d1f; }

.timeline-item { position: relative; padding-left: 16px; border-left: 2px solid #e5e5ea; }
.timeline-time { font-size: 11px; color: #86868b; }
.timeline-text { color: #1d1d1f; font-weight: 500; }

.pending-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background: #f5f5f7;
  border-radius: 8px;
}

.sidebar-btn::after {
  content: attr(data-tooltip);
  position: absolute;
  right: calc(100% + 10px);
  top: 50%;
  transform: translateY(-50%) translateX(6px);
  background: #000000;
  color: #ffffff;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: all 0.2s ease;
  z-index: 100;
}
.sidebar-btn:hover::after {
  opacity: 1;
  visibility: visible;
  transform: translateY(-50%) translateX(0);
}

/* Fix the overlay to be visible when not hidden */
#ftth-diagrama-modal:not(.hidden) {
  display: flex !important;
}
`;

fs.appendFileSync('d:/Desktop/VS/ema/frontend/css/diagrama.css', extraCss, 'utf8');
console.log('Appended clean CSS done!');
