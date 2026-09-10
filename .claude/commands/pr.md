---
description: Arma título y descripción de la PR de la rama actual (inventario completo de commits y merges antes de escribir)
argument-hint: "[rama-base] (default: master) [#patch|#minor|#major] (default: #patch)"
allowed-tools: Bash(git *), Read, Grep, Glob
---

# /pr — Título y descripción de la PR

Armá el título y la descripción de la PR de la rama actual hacia la rama base,
con la estructura que usamos siempre en los proyectos de CspmIT. **No crees la PR** (no hay
`gh` en esta máquina): el usuario la crea a mano en GitHub y pega lo que le des.

Argumentos: `$ARGUMENTS`
- Primer token sin `#`: rama base. Si no viene, es `master`.
- Token `#patch` / `#minor` / `#major`: sufijo de bump. Si no viene, `#patch`.

## 1. Inventario obligatorio (antes de escribir una sola línea)

La descripción tiene que ser **específica** de lo que realmente sube. Nunca la
escribas de memoria del chat ni solo de los mensajes de commit: mirá el diff.

Corré, en el repo actual:

```bash
git fetch origin --quiet
git branch --show-current
git status -sb
git log --oneline origin/<base>..HEAD                       # todo lo que sube (incluye merges)
git log --no-merges --format='%h %s%n%b' origin/<base>..HEAD  # commits propios con cuerpo
git log --merges --format='%h %s' origin/<base>..HEAD       # merges dentro de la rama
git diff origin/<base>...HEAD --stat
git diff origin/<base>...HEAD --name-status
```

Después:

1. **Merges.** Por cada merge de la rama que NO sea "Merge branch 'master'" /
   "Merge remote-tracking branch 'origin/master'", listá qué trajo:
   `git log --oneline <merge>^1..<merge>^2`. Esos commits también forman parte
   de la PR y tienen que aparecer en la descripción. Los merges *desde* master
   se ignoran (son sincronización, no contenido).
2. **Diff real.** Leé el diff de los archivos importantes
   (`git diff origin/<base>...HEAD -- <archivo>`). Si un commit fue superado por
   otro dentro de la misma rama (iteración), describí el resultado final y
   mencioná en las notas que el intermedio quedó pisado.
3. **Estado de la rama.** Si hay cambios sin commitear o commits sin pushear
   (`git log origin/<rama>..HEAD`), avisalo arriba de todo: la PR va a quedar
   incompleta hasta que se pusheen.
4. **Repo hermano.** Los proyectos vienen en pareja front ↔ back dentro de
   `C:\Users\aguaressi\Repositorios\` (`mas-agua-front` ↔ `back-mas-agua`,
   `centinela-front` ↔ `back-centinela`, y en general `<x>-front` ↔ `back-<x>`).
   Deducí el hermano por el nombre del repo actual y fijate si tiene una rama
   con el mismo nombre (local o en `origin`) con commits por delante de
   `origin/<base>`. Si los tiene, hacé el mismo inventario ahí y entregá
   **dos PRs** (ver formato), aclarando el orden de deploy entre ambas. Si no
   existe un hermano, seguí con un solo repo.
5. **Señales de deploy.** Buscá en el diff (de los dos repos si aplica):
   - `migrations/` o `seeders/` nuevos en el back → "correr `npm run migrate:all`"
     (y decir si son aditivas / nullable o si rompen algo).
   - Cambio de contrato de API (ruta nueva, campo nuevo que el front consume) →
     indicar qué repo se deploya primero.
   - `src-tauri/tauri.conf.json`, `Cargo.toml`: bump de versión de escritorio →
     mencionar la versión y que después va `master → releases`.
   - Variables de entorno nuevas (`.env.example`, `config/`), secrets, workflows,
     `Dockerfile`, nginx.
   - Dependencias nuevas en `package.json` (y si el build necesita algo, p. ej.
     `NODE_OPTIONS=--max-old-space-size`).
   - Menús nuevos que requieren seed por tenant, permisos por perfil.
   Si no hay nada de esto, la sección Deploy dice explícitamente que es solo
   front (o solo back), sin migraciones ni versión de escritorio.

## 2. Formato de salida (respetarlo tal cual)

Presentá primero el título y después la descripción, cada uno en su bloque de
código para copiar. Si son dos repos, encabezá cada par con `## PR Front
(<repo>)` y `## PR Back (<repo>)`.

**Título:**

```
tipo(scope): qué cambia, en minúsculas y sin punto final #patch
```

- Conventional Commits: `feat`, `fix`, `refactor`, `build`, `chore`, `docs`,
  `perf`. El `scope` es opcional y corto (`home`, `genui`, `charts`, `bombs`,
  `responsive`, `ui`…).
- Español, una sola línea, idealmente ≤ 90 caracteres. Si la PR tiene varios
  frentes, enumerarlos con comas o `+`
  (ej. `feat: figuras en diagramas, tablas sin recarga, mejoras de mapas y tableros en pestañas`).
- **Sufijo `#patch` obligatorio** cuando la base es `master`: el merge commit
  lo lee `anothrNick/github-tag-action` en `cd_master.yaml` / `cicd.yml` para
  el bump de versión; sin sufijo el bump por defecto es `minor`. Usar `#minor`
  o `#major` solo si el usuario lo pidió. Si la base es `releases` no va sufijo
  (`cd_desktop.yaml` dispara por push, no por tag).

**Descripción:**

````markdown
## Resumen

Uno o dos párrafos: qué problema había o qué se quería lograr, y qué hace la
PR a alto nivel. **Negrita** en el concepto central. Si hay un criterio de
diseño explícito, decirlo acá.

## Cambios

- **Nombre del cambio** (`hash`): qué hace y por qué, en una o tres oraciones.
  Nombrar archivos/hook/componentes clave en `código`.
- **Otro cambio** (`hash`): …

(Si la PR tiene varios frentes grandes, en vez de una lista plana usar
subsecciones `### Frente` —opcionalmente con un emoji— cada una con sus
bullets. Si un bullet requiere algo del otro repo o una migración, marcarlo
con ⚠️ ahí mismo.)

## Verificación

- Cómo se probó: tests (Playwright, scripts), pruebas en vivo sobre el dev
  server, pruebas manuales en celular/TV/escritorio. Solo lo que realmente se
  hizo y consta en commits/chat. Lo que falta probar va como checklist
  `- [ ]` para que el usuario lo complete antes de mergear.

## Deploy

- Orden entre repos (back antes que front, o al revés) y por qué.
- Migraciones: `npm run migrate:all` en producción; decir si son aditivas.
- Seeds / menús por tenant / permisos por perfil.
- Versión de escritorio: si hubo bump, la versión y que después va
  `master → releases`. Si no, decirlo.
- Variables de entorno o secrets nuevos.
- Si no hay nada: "Solo front: sin cambios de back, sin migraciones, sin
  versión de escritorio."

🤖 Generated with [Claude Code](https://claude.com/claude-code)
````

Después de los bloques, en texto normal y breve (sin repetir la descripción),
las **notas para el usuario**: commits sin pushear, commits intermedios
pisados, afirmaciones de la sección Verificación que dependen de que él las
haya probado, y el orden de merge si son dos PRs.

## 3. Reglas de estilo

- Español rioplatense, voseo, directo. Sin relleno ni marketing.
- Cada bullet nombra el cambio concreto y el motivo; nada de "mejoras varias".
- Los hashes son los de `git log` de la rama (cortos, 7 caracteres). Si un
  bullet junta varios commits, listar los hashes separados por coma.
- No inventar verificación ni resultados. Si no sabés si algo se probó,
  ponelo como pendiente.
- Las secciones `## Verificación` y `## Deploy` van siempre, aunque sea para
  decir que no aplica.
- Pie `🤖 Generated with [Claude Code](https://claude.com/claude-code)` siempre
  al final de la descripción.
