# Tomari para Windows

Versión propia para Windows 11 de [Tomari](https://github.com/elrincondeldev/tomari). El original es para macOS, tiene licencia MIT y es de Jose Ramon Montes Hermida.

Es una tira flotante en el borde de la pantalla con un bichito pixel-art animado por sesión. Muestra dos fuentes:
- las sesiones de **Claude Code en la app de escritorio de Claude** (trabajo);
- las conversaciones de **Antigravity** (cosas personales).
- los agentes de **Grok Bot** (violetas).

Cada bichito muestra en qué está su sesión. Si le hacés click, abre esa sesión.

> No es un proyecto oficial de Anthropic ni de Google. Usa archivos y APIs locales no documentados, que pueden cambiar con cualquier actualización de esas apps.

## Uso diario

- **Abrir:** con el acceso directo **Tomari** del escritorio o del menú Inicio. También arranca solo con Windows.
- **La tira:** está en el borde derecho, centrada verticalmente. Nunca te saca el foco de la ventana en la que estás escribiendo.
- **Bichitos:** se agrupan por proyecto, con una etiqueta corta arriba de cada grupo.
  - Si no le elegiste un color a mano, cada bichito toma un color según su proyecto.
  - Los de Antigravity son **blancos** (salvo que les elijas otro color) y llevan un destello pixel-art azul y violeta abajo a la izquierda.
- **✕ al pasar el mouse:** saca al bichito de la tira (y lo desfija si estaba fijado). No cierra la sesión: vuelve a aparecer solo cuando esa sesión tiene actividad nueva.
- **Click en un bichito:**
  - Una sesión de Claude se abre en la app de Claude.
  - Una conversación de Antigravity abre Antigravity, pero no esa conversación puntual.
- **Click derecho en un bichito:** fijarlo, cambiarle el personaje o el color, o detener la sesión.
- **Botón +:** muestra la biblioteca de sesiones recientes, para fijar alguna.
- **Ícono en la bandeja** (al lado del reloj):
  - un click muestra u oculta la tira;
  - el click derecho tiene el menú: mostrar u ocultar, borde izquierdo o derecho, sonido al terminar, cuántas sesiones esperan tu aprobación, y Salir.

### Estados

| Estado | Qué significa |
|---|---|
| Trabajando | El agente está ejecutando |
| Necesita permiso | Espera que apruebes una herramienta. Las sesiones en modo bypass nunca piden |
| Te pregunta | Espera una respuesta tuya |
| Compactando | Claude está resumiendo el contexto |
| Listo (tilde verde) | Terminó desde tu último mensaje |
| Dormido / idle | Sin actividad |
| Error / cerrado | La sesión falló o terminó |

En Antigravity, por ahora, solo se ven confirmados *trabajando*, *listo* e *idle* (ver Limitaciones).

## Instalar en otra PC

1. Copiá `overlay-win\release\Tomari Setup 0.1.0.exe` y ejecutalo.
   - No pide permisos de administrador.
   - Se instala en `%LOCALAPPDATA%\Programs\tomari` y crea los accesos directos.
2. Al abrirse por primera vez, la app instala el agente sola (ver más abajo qué hace `tomari.exe setup`).

En la PC en la que se compiló, Windows no muestra el aviso de SmartScreen. En otra PC sí puede aparecer, porque el instalador no está firmado: en ese caso, "Más información" → "Ejecutar de todas formas".

## Desinstalar

1. Corré `%LOCALAPPDATA%\tomari\bin\tomari.exe uninstall`. Esto:
   - saca los hooks de `~/.claude/settings.json`;
   - saca el arranque automático del agente;
   - cierra el agente y borra `bin\`.

   Con `--purge` también borra los datos (bichitos fijados e íconos).
2. Desinstalá **Tomari** desde "Agregar o quitar programas".

Si hacés solamente el paso 2, el agente y los hooks quedan instalados.

## Cómo funciona

```
Claude Code ──hook──▶ tomari.exe hook ──POST :7777/hook──┐
app Claude: sesiones, grupos, log de foco ──lectura──────┤
claude agents --json ──poll─────────────────────────────┤
Antigravity: API local del language server ──poll 2s────┴─▶ tomari-agent.exe ◀── WebSocket :7778 ──▶ Tomari.exe (Electron: tira + bandeja)
                                                                │
                                                                └─ SQLite: estados, bichitos fijados, íconos
```

### Piezas

**`tomari-agent.exe`**: el agente, escrito en Bun/TypeScript (`agent/`) y compilado con `bun build --compile`.
- Corre sin ventana.
- Junta el estado de todas las fuentes y lo publica por WebSocket en `127.0.0.1:7778`.
- El WebSocket pide un token de emparejamiento, que está en `config.json`.

**`tomari.exe`**: el mismo código compilado como programa de consola. Es la línea de comandos:

| Comando | Qué hace |
|---|---|
| `setup` | Copia `tomari.exe` y `tomari-agent.exe` a `%LOCALAPPDATA%\tomari\bin`. Hace backup de `~/.claude/settings.json` y le agrega los 13 hooks. Registra el agente en el arranque de Windows y lo inicia |
| `status` | Muestra el estado del agente, los hooks y `/health` |
| `uninstall [--purge]` | Revierte todo lo que hace `setup` |
| `agent [--log]` | Corre el agente. Con `--log`, escribe su salida en `logs\agent.log` |
| `hook` | Lo ejecutan los hooks de Claude Code. Reenvía al agente el JSON que recibe por stdin. Siempre sale con código 0 y tiene un timeout de 1 segundo, así nunca traba a Claude |
| `version` | Muestra la versión |

**`Tomari.exe`**: la app de escritorio, hecha con Electron (`overlay-win/`).
- **Ventana:** transparente, sin bordes, siempre arriba, no toma el foco y no aparece en la barra de tareas.
- **Tamaño fijo:** la ventana mide lo que la tira más el espacio para la etiqueta o el menú, y no cambia al pasar el mouse. Las partes transparentes dejan pasar los clicks a la app de atrás (`setIgnoreMouseEvents` con `forward`): la página lo desactiva cuando el mouse está sobre la tira, y el proceso principal lo vuelve a activar si el cursor sale de la ventana (una salida rápida puede no avisarle a la página). Antes la ventana cambiaba de tamaño en cada hover y Windows dejaba copias fantasma de la tira en pantalla.
- **Bandeja:** el ícono con su menú.
- **Ventana en primer plano:** cada 0,5 segundos detecta si al frente está Claude, Antigravity u otra app. Lo hace llamando a `user32` y `kernel32` mediante `koffi`, una librería de FFI que trae binarios ya compilados.
- **Al arrancar:** se fija si el agente responde en `/health` y si es la misma versión que trae la app. Si no responde, o si la versión cambió, corre `tomari.exe setup`.
- **Mientras corre:** cada 60 segundos revisa que el agente responda y, si se cayó, lo vuelve a levantar. La tira pide el token de nuevo en cada reconexión, así que sigue andando aunque setup lo haya cambiado.
- **Siempre arriba:** cada vez que cambia la app al frente vuelve a ponerse arriba, para no quedar tapada después de una app en pantalla completa.

### Fuentes de datos

**Claude (app de escritorio, MSIX)**

| Dato | Dónde |
|---|---|
| Estado en vivo | Hooks de Claude Code (`~/.claude/settings.json`), más `claude agents --json` |
| Sesiones de la app | `%LOCALAPPDATA%\Claude-Data\claude_*\claude-code-sessions\<org>\<cuenta>\local_*.json` |
| Proyecto (grupo de la barra lateral) | `claude_desktop_config.json`, en `preferences.epitaxyPrefs["dframe-group-scopes"]`. Ahí `groups` da el nombre de cada grupo y `assignments` (`"code:local_<id>"` → grupo) dice a qué grupo va cada sesión. Se relee cada 15 segundos |
| Sesión enfocada en la app | `%LOCALAPPDATA%\Claude\logs\main.log`, en las líneas `LocalSessions.setFocusedSession` |
| Abrir una sesión | `cmd /c start "" "claude://code/continue?session=local_<id>"`. Si no hay sesión de la app, prueba con `claude --desktop --resume <id>` |
| Conversación nueva en un grupo | `cmd /c start "" "claude://code/new?folder=<carpeta>"` (sin documentar; `claude --desktop` no corre sin consola), con la carpeta (`cwd`) de una sesión de ese grupo. La carpeta la saca el agente de una sesión conocida, nunca del cliente |

**Antigravity**

- **Instancias:** cada Antigravity abierto deja un archivo `~/.gemini/antigravity/daemon/hub_*.json` con `{pid, httpPort, csrfToken}`. Solo se usan los archivos cuyo `pid` sigue vivo; quedan muchos viejos.
- **Conversaciones:** cada 2 segundos el agente hace `POST http://127.0.0.1:<httpPort>/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories`, con el header `X-Codeium-Csrf-Token` y el body `{}`.
- **Estado:**
  - `RUNNING`, `BUSY` o `CANCELING` → trabajando;
  - `IDLE` → listo si hubo actividad después de tu último mensaje, si no idle;
  - un campo `waitingFor…` en `true` → necesita permiso.
- **Proyecto:** si es una tarea programada, el `sidecarId` (por ejemplo `daily-gmail-cleanup`). Si no, el nombre de la carpeta del workspace (`file:///c:/Users/dev/Desktop/my-site` → `my-site`).
- **Si Antigravity se cierra:** sus bichitos pasan a cerrado. Si la API falla, no se cierra nada; lo decide la consulta siguiente.

**Grok Bot**

- **Agentes:** Grok Bot guarda una copia de su barra lateral en `%APPDATA%\Grok Bot\sand-client-persistence\`. Cada archivo `.blob` tiene como nombre su clave en base32; la que termina en `.roster.last-roster` tiene `{value: {rows: [...]}}`, una fila por agente. Se ignoran los grupos y los ocultos.
- **Estado:** `awaitingUserResponse` → te pregunta; `hasUnread` → listo; si no, idle. "Trabajando" no está en esa copia, y la app la escribe cada tanto, así que el estado puede llegar con demora.
- **Si está abierto:** `desktop-status.json` tiene el `pid` de la app. Si ese proceso no existe, los bichitos de Grok pasan a cerrado.
- **Abrir:** `cmd /c start "" "grokbot://"` abre o trae al frente la app, no el agente puntual.
- Todos van al grupo "Grok": los agentes corren en la nube de Grok, sin carpeta local.

### Archivos en la PC

| Ruta | Contenido |
|---|---|
| `%LOCALAPPDATA%\Programs\tomari\` | La app (Electron) |
| `%LOCALAPPDATA%\tomari\bin\` | `tomari.exe` y `tomari-agent.exe`, los que usan los hooks y el arranque automático |
| `%LOCALAPPDATA%\tomari\config.json` | El token que comparten el agente y la tira |
| `%LOCALAPPDATA%\tomari\tomari.db` | SQLite con los estados, los bichitos fijados y los íconos |
| `%LOCALAPPDATA%\tomari\overlay.json` | Preferencias de la tira: borde, sonido, oculta |
| `%LOCALAPPDATA%\tomari\logs\agent.log` | El log del agente |
| `~/.claude/settings.json.bak-tomari-<timestamp>` | El backup que hace `setup` antes de tocar los hooks |
| `HKCU\...\CurrentVersion\Run` | `TomariAgent` (el agente) y `electron.app.Tomari` (la app) |

Puertos (solo en `127.0.0.1`):
- `7777`: recibe los hooks;
- `7778`: WebSocket de la tira y `/health`.

## Compilar desde el código

Hace falta:
- **Bun 1.4+**. Está instalado pero no en el PATH. En bash:
  ```bash
  export PATH="$(ls -d "$LOCALAPPDATA"/Microsoft/WinGet/Packages/Oven-sh.Bun*/bun-windows-x64):$PATH"
  ```
- **Node 20+**, para `npx`.
- **No** hacen falta Rust ni Visual Studio.

```bash
# 1. Agente → dist/win/tomari.exe y tomari-agent.exe
cd agent
bun install
bun test               # 130 tests
bun run typecheck
bun run build:win

# 2. App → overlay-win/release/Tomari Setup <versión>.exe
cd ../overlay-win
bun install            # la primera vez, después: bun pm trust koffi
bun test               # 6 tests
bun run typecheck
bun run deploy        # actualiza la app instalada (ver abajo)
npx electron-builder --win nsis   # instalador nuevo: Smart App Control puede bloquearlo
```

- **Probar sin instalar:** `bun run dev` dentro de `overlay-win`. Usa los binarios de `dist/win`.
- **Probar la tira sin el agente real:** `bun scripts/fake-agent.ts` levanta un WebSocket falso en el puerto 7778.
- **Actualizar la app instalada:** `bun run deploy` en `overlay-win` (antes, `bun run build:win` en `agent/` si cambió el agente).
  - Arma la app sin instalador (`electron-builder --dir`) y copia a `%LOCALAPPDATA%\Programs\tomari\resources` solo `app.asar` y `bin\tomari*.exe`, si cambiaron. No genera un `Tomari.exe` nuevo.
  - Reinicia la app. Al arrancar, la app compara su `tomari-agent.exe` con el instalado (tamaño y últimos 8 MB) y, si cambió, corre `setup` sola.

### Smart App Control

Windows 11 tiene Smart App Control activado y bloquea ejecutables nuevos sin firma. Armar el instalador NSIS ejecuta uno así, y por eso puede fallar con `spawn UNKNOWN`. Lo confirma el log *Microsoft-Windows-CodeIntegrity/Operational*, evento 3077.

No conviene apagarlo: una vez apagado, Windows no deja volver a activarlo sin reinstalar. Por eso las actualizaciones van con `bun run deploy`. Hasta ahora Smart App Control dejó correr los `tomari*.exe` recién compilados, pero podría bloquearlos alguna vez. Si pasa, aparece en ese mismo log.

### Problema conocido al empaquetar

electron-builder baja `winCodeSign`, que trae symlinks de macOS. Windows no los puede crear sin modo desarrollador, y el paquete falla con `Cannot create symbolic link`. La solución, una sola vez:

```bash
cd "$LOCALAPPDATA/electron-builder/Cache/winCodeSign"
"<repo>/overlay-win/node_modules/7zip-bin/win/x64/7za.exe" x -y <archivo>.7z -o"winCodeSign-2.6.0" '-xr!darwin'
rm -rf <los .7z y carpetas numeradas>
```

## Diferencias con el original de macOS

- **Agregado:**
  - las conversaciones de Antigravity;
  - la agrupación por proyecto, con su etiqueta;
  - el color por proyecto;
  - la marca de Antigravity en los bichitos.
- **Reemplazado:**
  - la app Swift/AppKit por Electron;
  - launchd por la clave `Run` del registro de Windows;
  - el hook con `curl` por `tomari.exe hook`;
  - abrir sesiones con osascript por `claude://` o `antigravity://`.
- **Sacado:**
  - el soporte de Terminal.app, con su ítem "New Terminal tab";
  - la terminal, `--bg` y attach;
  - las migraciones de claude-panel y Perch.
- **Cambios en el código:**
  - `shared/protocol.ts` agrega `source` y `project`, y saca el mensaje `terminal`;
  - nuevos `agent/src/antigravity.ts`, `autostart.ts` y `hook.ts`;
  - borrados `launchd.ts` y `terminal-focus.ts`.

## Limitaciones y riesgos

- **APIs no documentadas:**
  - en la app de Claude: la carpeta de sesiones, `dframe-group-scopes` y las líneas del log;
  - en Antigravity: la API `GetAllCascadeTrajectories`.

  Una actualización de esas apps puede romper la detección. En ese caso no se cuelga nada: esos bichitos dejan de aparecer o pasan a cerrado.
- **"Necesita permiso" en Antigravity sin verificar:** lo detecta por un campo `waitingFor…` que encontré dentro del programa de Antigravity, pero que nunca vi en una respuesta real.
- **Click en Antigravity:** abre la app, no la conversación puntual.
- **Sin probar todavía:**
  - que un click abra la sesión desde la tira ya instalada;
  - la detección de la app al frente y el sonido;
  - el arranque después de reiniciar Windows.
- **Instalador sin firmar.**
- **Los ✕ se olvidan al reiniciar la app:** un bichito sacado con la ✕ puede volver si al reabrir sigue activo (terminó hace menos de 5 minutos).

## Código sin uso

Del original de Mac, Windows no usa `Sources/`, `Tests/`, `Package.swift`, `npm/` ni `scripts/`.

`site/src/domain/` **sí se usa**: de ahí salen los sprites, los personajes y la apariencia.

El intento anterior con Tauri, que necesitaba Visual Studio Build Tools, se borró. El ícono quedó en `overlay-win/electron/icon.ico`.
