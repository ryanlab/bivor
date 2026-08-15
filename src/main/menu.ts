import { app, BrowserWindow, Menu, shell } from "electron";
import { mt } from "./i18n";

export type MenuAction = "new-task" | "open-settings" | "open-project";

function send(action: MenuAction): void {
  BrowserWindow.getFocusedWindow()?.webContents.send("menu:action", action);
}

export function installMenu(): void {
  const isMac = process.platform === "darwin";
  const settingsItem: Electron.MenuItemConstructorOptions = {
    label: mt("menu.settings"),
    accelerator: "CmdOrCtrl+,",
    click: () => send("open-settings"),
  };
  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS 专属的应用名菜单；其他平台的设置/退出并入 File 菜单
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about", label: mt("menu.about") },
              { type: "separator" },
              settingsItem,
              { type: "separator" },
              { role: "hide", label: mt("menu.hide") },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit", label: mt("menu.quit") },
            ],
          },
        ] satisfies Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: mt("menu.file"),
      submenu: [
        {
          label: mt("menu.newTask"),
          accelerator: "CmdOrCtrl+N",
          click: () => send("new-task"),
        },
        {
          label: mt("menu.openProject"),
          accelerator: "CmdOrCtrl+O",
          click: () => send("open-project"),
        },
        { type: "separator" },
        ...(isMac
          ? ([{ role: "close" }] satisfies Electron.MenuItemConstructorOptions[])
          : ([
              settingsItem,
              { type: "separator" },
              { role: "quit", label: mt("menu.quit") },
            ] satisfies Electron.MenuItemConstructorOptions[])),
      ],
    },
    {
      label: mt("menu.edit"),
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: mt("menu.view"),
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: mt("menu.window"),
      submenu: isMac
        ? [{ role: "minimize" }, { role: "zoom" }, { role: "front" }]
        : [{ role: "minimize" }, { role: "close" }],
    },
    {
      label: mt("menu.help"),
      role: "help",
      submenu: [
        {
          label: mt("menu.docs"),
          click: () => void shell.openExternal("https://pi.dev/docs"),
        },
        ...(isMac
          ? []
          : ([
              { type: "separator" },
              { role: "about", label: mt("menu.about") },
            ] satisfies Electron.MenuItemConstructorOptions[])),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
