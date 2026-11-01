# Autoevaluación CEINAR

Sitio en GitHub Pages + Apps Script vinculado a la hoja de cálculo.

```
autoevaluacion-ceinar/
├─ index.html        ← login, elección de asignatura y estado de intentos
├─ config.js         ← URL del Apps Script (lo único que se edita al publicar)
├─ api.js            ← llamadas al servidor y sesión
├─ estilos.css       ← identidad visual (variables al inicio)
├─ motor.js          ← el motor de TODAS las autoevaluaciones (preguntas, envío, resultado)
├─ motor.css         ← estilos del motor
├─ assets/           ← logo-ceinar.png y logo-enpcs.png (cuando los tengas)
├─ artefactos/       ← 9 HTML del periodo 3: inf-p3-6-7.html, est-p3-8-9.html, art-p3-10-11.html…
└─ apps-script/
   ├─ Codigo.gs      ← pegar en el Apps Script de la hoja de cálculo
   └─ appsscript.json
```

Qué va en GitHub: solo estos archivos. **Nunca** subas el listado de estudiantes ni la hoja de cálculo: el repositorio es público.

---

## 1. Preparar la hoja de cálculo

1. Abre la hoja → **Extensiones → Apps Script**.
2. Borra el contenido de `Código.gs` y pega todo `apps-script/Codigo.gs`.
3. (Opcional) En **Configuración del proyecto** activa "Mostrar el archivo de manifiesto appsscript.json" y pega el contenido de `appsscript.json`.
4. Guarda, vuelve a la hoja y recárgala. Aparece el menú **Autoevaluación**.
5. **Autoevaluación → 1. Preparar hojas y columnas.** Google pedirá autorización la primera vez (es tu propio script). Crea `Config`, `Banco` e `IntentosIniciados`, agrega a `Estudiantes` las columnas `Nota Informática P1…P3`, `Nota Estadística P1…P3` y `Nota Artes Aplicadas P1…P3`, y añade a `LogIntentos_2026` las columnas `Respuestas`, `Puntos`, `PuntosMax` y `Nota`. No toca tus columnas actuales.
6. En la hoja **Config** revisa: `Periodo` (P1, P2 o P3), `NotaMinima` (8), `MaxIntentos` (3), `GradosConClave` (6,7,8: grados que ven la clave de respuestas; los demás solo ven nota y resultado por tema).
7. En **Docentes** agrega a cada director de grupo (Documento, Nombre, Rol = Docente, GrupoAsignado). Con eso `LogConsultas` llena la columna Director.
8. En **Estudiantes › Activo** escribe `No` solo a quien desertó. Vacío cuenta como activo.

## 2. Importar las preguntas de cada formulario

Hazlo con una cuenta que tenga **acceso de edición** al formulario.

1. **Autoevaluación → 2. Importar formulario de Google como artefacto.**
2. Pega el enlace del formulario y escribe el identificador del artefacto: `ASIGNATURA-PERIODO-FRANJA`.
   - Asignatura: `INF`, `EST` o `ART`
   - Periodo: `P1`, `P2` o `P3`
   - Franja: `6-7`, `8-9` o `10-11`
   - Ejemplo: `INF-P3-6-7`
3. El script trae las preguntas con puntos, las opciones y la respuesta correcta a la hoja `Banco`. Omite las preguntas sin puntos (correo, documento, nombre, grado). Si vuelves a importar el mismo identificador, reemplaza esas filas.
4. Si en el Banco quedaron temas con solo un número (las secciones del formulario se llaman "1", "2"…), el script les pone nombre por rango de preguntas. Los rangos están al inicio de `Codigo.gs` (`TEMAS_POR_RANGO`); al importar formularios nuevos agrega ahí sus rangos o escribe el tema en la hoja Banco, y ejecuta **Autoevaluación → 4. Corregir temas del Banco** (se puede repetir sin problema).
5. Lee el aviso final:
   - **Sin respuesta correcta:** no puntúan. Si es una escala (p. ej. "No lo completé" … "de manera excepcional"), en `Banco › PuntosPorOpcion` escribe `{"A":0,"B":2,"C":3.5,"D":4.5,"E":5}` (puntos por letra de opción).
   - **Imágenes o videos:** no se importan; se agregan al HTML del artefacto.

La nota es `puntos obtenidos ÷ puntos máximos × 10` y se guarda en la columna del periodo, con la mejor nota de los intentos.

## 3. Publicar la API (Apps Script)

1. **Implementar → Nueva implementación → Aplicación web.**
2. *Ejecutar como:* **Yo** · *Quién tiene acceso:* **Cualquier persona**.
3. Implementar y copiar la URL que termina en `/exec`.
4. Pegar esa URL en `config.js` (`API_URL`).
5. Cuando cambies el código: **Implementar → Administrar implementaciones → lápiz → Versión: Nueva versión.** La URL no cambia. Si creas una "nueva implementación" cambia la URL.

## 4. Publicar en GitHub Pages

1. En github.com crea un repositorio **público** (p. ej. `autoevaluacion-ceinar`).
2. **Add file → Upload files** y sube todo lo de esta carpeta salvo `apps-script/` y `README.md` (esos pueden quedarse también, no hacen daño). Mantén las carpetas `assets/` y `artefactos/`.
3. **Commit changes.**
4. **Settings → Pages → Build and deployment → Deploy from a branch → main / (root) → Save.**
5. A los 1 o 3 minutos queda en `https://TU-USUARIO.github.io/autoevaluacion-ceinar/`.
6. Para actualizar: reemplaza el archivo en el repositorio y haz commit. Si no ves el cambio, recarga con Ctrl+F5.

## 5. Incrustar en Blogger (EnPCs)

**Páginas → Nueva página → Vista HTML:**

```html
<iframe src="https://TU-USUARIO.github.io/autoevaluacion-ceinar/"
        width="100%" height="1000" style="border:0" title="Autoevaluación CEINAR"></iframe>
```

Si algún celular bloquea el almacenamiento dentro del marco, el sitio avisa y se puede abrir directamente en su propia pestaña.

---

## Reglas que aplica el servidor

- Entra quien esté en `Estudiantes` o `Docentes`. Solo `Activo = No` bloquea.
- Las asignaturas visibles son las que tienen `Si` en G, H e I.
- El artefacto sale de grupo → grado → franja (6-7, 8-9, 10-11) y del `Periodo` activo.
- Un intento se cuenta **al comenzar** (cambia con `ContarAlIniciar = No` en `Config`). Recargar no regala intentos.
- Con nota ≥ 8 o con 3 intentos usados, el servidor rechaza nuevos intentos aunque alguien manipule el navegador.
- La clave de respuestas solo se envía al estudiante cuando cierra su ciclo (aprobó o agotó intentos) **y** su grado está en `Config › GradosConClave` (por defecto 6.º, 7.º y 8.º; el grado sale del grupo: 801 → 8). Grados 9.º, 10.º y 11.º reciben solo nota y resultado por tema. Docentes siempre la ven.
- Docentes: intentos ilimitados, quedan registrados con Rol = Docente y no escriben nota en `Estudiantes`.

## Qué registra cada hoja

- **LogConsultas:** Login, SeleccionAsignatura, InicioIntento y EnvioIntento, con su resultado (Exitoso, Documento no encontrado, Inactivo, Sin asignatura habilitada, Bloqueado por aprobación, Intentos agotados…). `Reporte` guarda la asignatura y el artefacto.
- **LogIntentos_2026:** al enviar, una fila `General` (con `Respuestas` en JSON, `Puntos`, `Nota`) y una fila por tema. `Porcentaje` se calcula por puntos. Para contar intentos usa `IntentoID` distinto.
- **IntentosIniciados:** control interno de intentos (no editar a mano).

## Los artefactos

Cada archivo de `artefactos/` solo declara qué artefacto es (`INF-P3-6-7` = Informática, periodo 3, grados 6° y 7°) y carga `motor.js`. Un cambio en el motor se aplica a todos. Una autoevaluación aparece como disponible cuando existe su identificador en la hoja `Banco`; mientras no exista, el estudiante ve "Todavía no está publicada".

Qué hace el motor:
- Pide las preguntas al servidor al pulsar **Comenzar** (así el intento se cuenta ahí y no al abrir la página).
- Muestra una pregunta por pantalla, con el texto de apoyo, hoja de respuestas, avance y tiempo.
- **Recargar la página no gasta otro intento:** las respuestas y el intento quedan guardados en esa pestaña. Si se cierra la pestaña, el intento se pierde (el servidor ya lo contó).
- Si falla la conexión al enviar, conserva las respuestas y permite reintentar.
- Al enviar muestra la nota con la regla 0–10, el resultado por tema y los intentos que quedan. Las respuestas correctas solo aparecen si aprobó o agotó los intentos.

Para un artefacto nuevo (por ejemplo otro periodo) hay que crear su página: copia un archivo de `artefactos/` (por ejemplo `inf-p3-6-7.html`), renómbralo (`inf-p1-6-7.html`) y cambia los valores de `window.ARTEFACTO` (id, periodo y título). Luego importa su formulario con el mismo identificador. Cuando tengas las preguntas de otro periodo, pídemelo y genero las páginas.

## Pendiente

- Logos de CEINAR y EnPCs en `assets/` y ajustar colores en `estilos.css`.
- Decidir si se agrega una hoja con una columna por pregunta (ver conversación) además del JSON de `Respuestas`.
