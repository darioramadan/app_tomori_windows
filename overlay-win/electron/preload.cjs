const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tomari", {
  invoke: (cmd, args) => ipcRenderer.invoke(cmd, args ?? {}),
  on: (event, cb) => ipcRenderer.on(event, (_e, payload) => cb(payload)),
});
