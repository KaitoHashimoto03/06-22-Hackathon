const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("postureDesktop", {
  requestCameraAccess() {
    return ipcRenderer.invoke("posture:request-camera-access");
  },
  requestReview(payload) {
    return ipcRenderer.invoke("posture:review", payload);
  },
  exportHistory(history) {
    return ipcRenderer.invoke("posture:export-history", history);
  },
  openPath(filePath) {
    return ipcRenderer.invoke("posture:open-path", filePath);
  },
});
