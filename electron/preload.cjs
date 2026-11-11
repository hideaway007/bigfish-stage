const { contextBridge, ipcRenderer } = require('electron');

function injectDesktopWindowChrome() {
  const root = document.documentElement;
  if (!root) return;
  root.dataset.bigfishElectron = process.platform;

  const id = 'bigfish-electron-chrome-style';
  if (document.getElementById(id) || !document.head) return;

  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    /* macOS native traffic-light clearance & window drag region */
    html[data-bigfish-electron="darwin"] [class*="sidebarCol"] > div {
      padding-top: 42px !important;
    }
    html[data-bigfish-electron="darwin"] [data-sidebar-collapsed] [data-shell-leading] {
      left: 84px !important;
    }
    html[data-bigfish-electron="darwin"] [data-sidebar-collapsed] [data-conversation-header-leading] {
      padding-left: 84px !important;
    }
    [data-window-drag],
    html[data-bigfish-electron="darwin"] [class*="sidebarCol"]::before {
      -webkit-app-region: drag;
    }
    html[data-bigfish-electron="darwin"] [class*="sidebarCol"] {
      position: relative;
    }
    html[data-bigfish-electron="darwin"] [class*="sidebarCol"]::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 38px;
      z-index: 20;
    }
    [data-window-drag] button,
    [data-window-drag] a,
    [data-window-drag] input,
    [data-window-drag] [role="tab"],
    [data-window-drag] [role="button"] {
      -webkit-app-region: no-drag;
    }
  `;
  document.head.appendChild(style);
}

window.addEventListener('DOMContentLoaded', injectDesktopWindowChrome, { once: true });

contextBridge.exposeInMainWorld('bigfishDesktop', {
  isElectron: true,
  platform: process.platform,
  pickDirectory: () => ipcRenderer.invoke('native-pick-directory'),
});
