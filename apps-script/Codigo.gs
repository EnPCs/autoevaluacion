/**********************************************************************
 * AUTOEVALUACIÓN CEINAR · API
 * Apps Script VINCULADO al libro de cálculo (Extensiones → Apps Script).
 *
 * Reglas que viven aquí (no en el HTML público de GitHub):
 *  - Quién puede entrar (Activo ≠ "No") y a qué asignaturas (columnas G, H, I = "Si").
 *  - Máximo de intentos y bloqueo al alcanzar la nota mínima.
 *  - La clave de respuestas (hoja Banco) y la calificación.
 *  - Los registros en LogConsultas y LogIntentos_2026.
 *
 * Acciones (POST, cuerpo JSON enviado como text/plain para evitar preflight CORS):
 *   login · estado · iniciar · enviar
 **********************************************************************/

const TZ = 'America/Bogota';
const VERSION_API = 'api-1.0.0';

const H = {
  EST: 'Estudiantes',
  DOC: 'Docentes',
  LOGC: 'LogConsultas',
  LOGI: 'LogIntentos_2026',
  CFG: 'Config',
  BANCO: 'Banco',
  INI: 'IntentosIniciados'
};

const ASIGNATURAS = {
  informatica: { codigo: 'INF', nombre: 'Informática',     colHabilita: 'Autoevaluación de Informática',     colNota: 'Nota Informática' },
  estadistica: { codigo: 'EST', nombre: 'Estadística',     colHabilita: 'Autoevaluación de Estadística',     colNota: 'Nota Estadística' },
  artes:       { codigo: 'ART', nombre: 'Artes Aplicadas', colHabilita: 'Autoevaluación de Artes Aplicadas', colNota: 'Nota Artes Aplicadas' }
};
const PERIODOS = ['P1', 'P2', 'P3'];
const FRANJAS = ['6-7', '8-9', '10-11'];
const LETRAS = 'ABCDEFGHIJKLMNOP'.split('');

const COLS = {
  LOGC: ['Fecha', 'Hora', 'Documento', 'Nombre', 'Grupo', 'Director', 'Reporte', 'TipoConsulta', 'Resultado'],
  LOGI: ['Documento', 'Nombre', 'Grupo', 'Asignatura', 'Fecha', 'Hora', 'IntentoID', 'NumeroIntento',
         'DuracionSegundos', 'Rol', 'VersionArtefacto', 'TipoArtefacto', 'Periodo', 'TipoAgrupación',
         'Etiqueta', 'Aciertos', 'TotalPreguntas', 'Porcentaje', 'Respuestas', 'Puntos', 'PuntosMax', 'Nota'],
  INI: ['IntentoID', 'Documento', 'Asignatura', 'Periodo', 'ArtefactoID', 'NumeroIntento', 'InicioMs',
        'Fecha', 'Hora', 'Rol', 'Estado', 'Nota', 'FinMs'],
  BANCO: ['ArtefactoID', 'Orden', 'PreguntaID', 'Tema', 'Contexto', 'Enunciado', 'Opciones', 'Correcta',
          'Puntos', 'PuntosPorOpcion', 'Tipo', 'Version']
};

/* ===================================================================
 *  PUNTOS DE ENTRADA WEB
 * =================================================================== */

function doGet() {
  return json_({ ok: true, servicio: 'Autoevaluación CEINAR', version: VERSION_API });
}

function doPost(e) {
  let salida;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (req.accion) {
      case 'login':   salida = login_(req);   break;
      case 'estado':  salida = estado_(req);  break;
      case 'iniciar': salida = iniciar_(req); break;
      case 'enviar':  salida = enviar_(req);  break;
      default:        salida = { ok: false, codigo: 'ACCION_INVALIDA', mensaje: 'Acción no reconocida.' };
    }
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    salida = { ok: false, codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error. Intenta de nuevo en un momento.' };
  }
  return json_(salida);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ===================================================================
 *  ACCIONES
 * =================================================================== */

function login_(req) {
  const doc = docNorm_(req.documento);
  if (doc.length < 5 || doc.length > 13) {
    logConsulta_({ doc: doc }, 'Login', 'Documento no válido', '');
    return { ok: false, codigo: 'DOC_INVALIDO', mensaje: 'Escribe tu número de documento solo con números, sin puntos ni espacios.' };
  }
  const p = buscarPersona_(doc);
  if (!p) {
    logConsulta_({ doc: doc }, 'Login', 'Documento no encontrado', '');
    return { ok: false, codigo: 'NO_ENCONTRADO', mensaje: 'No encontramos ese documento en la lista. Revísalo o consulta con tu docente.' };
  }
  if (!p.activo) {
    logConsulta_(p, 'Login', 'Inactivo', '');
    return { ok: false, codigo: 'INACTIVO', mensaje: 'Tu registro aparece como inactivo. Consulta con tu docente.' };
  }
  if (!p.asignaturas.length) {
    logConsulta_(p, 'Login', 'Sin asignatura habilitada', '');
    return { ok: false, codigo: 'SIN_ASIGNATURA', mensaje: 'No tienes autoevaluaciones habilitadas. Consulta con tu docente.' };
  }

  const cfg = config_();
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const sesion = {
    doc: p.doc, nombre: p.nombre, grupo: p.grupo, rol: p.rol,
    director: directorDe_(p.grupo), asignaturas: p.asignaturas
  };
  CacheService.getScriptCache().put('tok_' + token, JSON.stringify(sesion), 21600); // 6 h
  logConsulta_(sesion, 'Login', 'Exitoso', '');

  return {
    ok: true,
    token: token,
    persona: { nombre: sesion.nombre, grupo: sesion.grupo, rol: sesion.rol, director: sesion.director, franja: franja_(sesion.grupo) },
    periodo: cfg.Periodo,
    notaMinima: cfg.NotaMinima,
    escala: cfg.Escala,
    maxIntentos: cfg.MaxIntentos,
    asignaturas: sesion.asignaturas.map(function (id) { return { id: id, nombre: ASIGNATURAS[id].nombre }; }),
    franjas: sesion.rol === 'Docente' ? FRANJAS : undefined
  };
}

function estado_(req) {
  const s = sesion_(req.token);
  if (!s) return sesionExpirada_();
  const ctx = contexto_(s, req);
  if (ctx.error) return ctx.error;

  const cfg = ctx.cfg;
  const est = calcularEstado_(s, ctx.asig, cfg);
  const banco = infoBanco_(ctx.artefactoId);

  let resultado = 'Disponible';
  if (!banco.puntosMax) resultado = 'Artefacto no disponible';
  else if (est.motivo === 'aprobado') resultado = 'Bloqueado por aprobación';
  else if (est.motivo === 'agotado') resultado = 'Intentos agotados';
  logConsulta_(s, 'SeleccionAsignatura', resultado, ASIGNATURAS[ctx.asig].nombre + ' · ' + ctx.artefactoId);

  return Object.assign({ ok: true, disponible: banco.puntosMax > 0, artefactoId: ctx.artefactoId,
    periodo: cfg.Periodo, notaMinima: cfg.NotaMinima, escala: cfg.Escala, maxIntentos: cfg.MaxIntentos }, est);
}

function iniciar_(req) {
  const s = sesion_(req.token);
  if (!s) return sesionExpirada_();
  const ctx = contexto_(s, req);
  if (ctx.error) return ctx.error;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cfg = ctx.cfg;
    const est = calcularEstado_(s, ctx.asig, cfg);
    const banco = infoBanco_(ctx.artefactoId);
    if (!banco.puntosMax) {
      logConsulta_(s, 'InicioIntento', 'Artefacto no disponible', ctx.artefactoId);
      return { ok: false, codigo: 'NO_DISPONIBLE', mensaje: 'Esta autoevaluación aún no está publicada para tu grupo.' };
    }
    if (est.bloqueado) {
      logConsulta_(s, 'InicioIntento', est.motivo === 'aprobado' ? 'Bloqueado por aprobación' : 'Intentos agotados', ctx.artefactoId);
      return Object.assign({ ok: false, codigo: 'BLOQUEADO', mensaje: 'No tienes intentos disponibles.' }, est);
    }

    const ahora = ahora_();
    const numero = (s.rol === 'Docente' ? intentosDe_(s, ctx.asig, cfg.Periodo, true).length : est.usados) + 1;
    const intentoId = 'I' + ahora.fecha.replace(/-/g, '') + '-' + Utilities.getUuid().slice(0, 6).toUpperCase();

    agregarFila_(hoja_(H.INI, COLS.INI), {
      IntentoID: intentoId, Documento: s.doc, Asignatura: ctx.asig, Periodo: cfg.Periodo,
      ArtefactoID: ctx.artefactoId, NumeroIntento: numero, InicioMs: ahora.ms, Fecha: ahora.fecha,
      Hora: ahora.hora, Rol: s.rol, Estado: 'EnCurso', Nota: '', FinMs: ''
    });
    logConsulta_(s, 'InicioIntento', 'Exitoso', ASIGNATURAS[ctx.asig].nombre + ' · ' + ctx.artefactoId + ' · intento ' + numero);

    const preguntas = bancoDe_(ctx.artefactoId).map(function (p) {
      return { id: p.id, orden: p.orden, tema: p.tema, contexto: p.contexto, enunciado: p.enunciado, opciones: p.opciones };
    });
    return {
      ok: true, intentoId: intentoId, numeroIntento: numero, maxIntentos: cfg.MaxIntentos,
      ilimitado: s.rol === 'Docente', artefactoId: ctx.artefactoId, version: banco.version,
      totalPreguntas: preguntas.length, preguntas: preguntas
    };
  } finally {
    lock.releaseLock();
  }
}

function enviar_(req) {
  const s = sesion_(req.token);
  if (!s) return sesionExpirada_();

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cfg = config_();
    const ini = leer_(hoja_(H.INI, COLS.INI));
    const iId = ini.ix('IntentoID'), iDoc = ini.ix('Documento'), iEst = ini.ix('Estado');
    let pos = -1;
    for (let i = 0; i < ini.filas.length; i++) {
      if (String(ini.filas[i][iId]) === String(req.intentoId)) { pos = i; break; }
    }
    if (pos < 0 || docNorm_(ini.filas[pos][iDoc]) !== s.doc) {
      return { ok: false, codigo: 'INTENTO_INVALIDO', mensaje: 'No se encontró ese intento.' };
    }
    const f = ini.filas[pos];
    if (String(f[iEst]) !== 'EnCurso') {
      return { ok: false, codigo: 'INTENTO_CERRADO', mensaje: 'Este intento ya fue enviado.' };
    }

    const asig = String(f[ini.ix('Asignatura')]);
    const periodo = String(f[ini.ix('Periodo')]);
    const artefactoId = String(f[ini.ix('ArtefactoID')]);
    const numero = Number(f[ini.ix('NumeroIntento')]);
    const inicioMs = Number(f[ini.ix('InicioMs')]);

    const banco = bancoDe_(artefactoId);
    const r = calificar_(banco, req.respuestas || {}, cfg.Escala);
    const aprobado = r.nota >= cfg.NotaMinima;
    const ahora = ahora_();
    const duracion = Math.max(0, Math.round((ahora.ms - inicioMs) / 1000));
    const version = (banco[0] && banco[0].version) || '';
    const nombreAsig = ASIGNATURAS[asig].nombre;

    // --- LogIntentos_2026: una fila General + una por tema
    const base = {
      Documento: s.doc, Nombre: s.nombre, Grupo: s.grupo, Asignatura: nombreAsig,
      Fecha: ahora.fecha, Hora: ahora.hora, IntentoID: req.intentoId, NumeroIntento: numero,
      DuracionSegundos: duracion, Rol: s.rol, VersionArtefacto: version,
      TipoArtefacto: 'autoevaluacion', Periodo: periodo
    };
    const hojaLog = hoja_(H.LOGI, COLS.LOGI);
    asegurarColumnas_(hojaLog, COLS.LOGI);
    agregarFila_(hojaLog, Object.assign({}, base, {
      'TipoAgrupación': 'General', Etiqueta: 'Total', Aciertos: r.aciertos, TotalPreguntas: r.total,
      Porcentaje: r.porcentaje, Respuestas: JSON.stringify(r.respuestasValidas),
      Puntos: r.puntos, PuntosMax: r.puntosMax, Nota: r.nota
    }));
    r.porTema.forEach(function (t) {
      agregarFila_(hojaLog, Object.assign({}, base, {
        'TipoAgrupación': 'Tema', Etiqueta: t.tema, Aciertos: t.aciertos, TotalPreguntas: t.total,
        Porcentaje: t.porcentaje, Puntos: t.puntos, PuntosMax: t.puntosMax
      }));
    });

    // --- cerrar el intento
    const sh = ini.sh;
    sh.getRange(pos + 2, ini.ix('Estado') + 1).setValue('Finalizado');
    sh.getRange(pos + 2, ini.ix('Nota') + 1).setValue(r.nota);
    sh.getRange(pos + 2, ini.ix('FinMs') + 1).setValue(ahora.ms);

    // --- estado actualizado y nota en Estudiantes
    const est = calcularEstado_(s, asig, Object.assign({}, cfg, { Periodo: periodo }));
    if (s.rol !== 'Docente' && est.mejorNota !== null) {
      escribirNotaEstudiante_(s.doc, ASIGNATURAS[asig].colNota + ' ' + periodo, est.mejorNota);
    }
    logConsulta_(s, 'EnvioIntento', aprobado ? 'Aprobado' : 'No aprobado', nombreAsig + ' · ' + artefactoId + ' · intento ' + numero + ' · ' + r.nota);

    const out = {
      ok: true, nota: r.nota, escala: cfg.Escala, notaMinima: cfg.NotaMinima, aprobado: aprobado,
      puntos: r.puntos, puntosMax: r.puntosMax, porcentaje: r.porcentaje,
      aciertos: r.aciertos, total: r.total, porTema: r.porTema, duracionSegundos: duracion,
      numeroIntento: numero, estado: est
    };
    if (est.bloqueado || s.rol === 'Docente') out.clave = r.clave; // la clave se revela solo al cerrar el ciclo
    return out;
  } finally {
    lock.releaseLock();
  }
}

/* ===================================================================
 *  LÓGICA
 * =================================================================== */

function contexto_(s, req) {
  const asig = String(req.asignatura || '');
  if (!ASIGNATURAS[asig] || s.asignaturas.indexOf(asig) < 0) {
    return { error: { ok: false, codigo: 'ASIGNATURA_NO_HABILITADA', mensaje: 'Esa asignatura no está habilitada para ti.' } };
  }
  const cfg = config_();
  let franja = franja_(s.grupo);
  if (s.rol === 'Docente' && FRANJAS.indexOf(String(req.franja)) >= 0) franja = String(req.franja);
  if (!franja) {
    return { error: { ok: false, codigo: 'SIN_FRANJA', mensaje: 'No pudimos identificar tu grado a partir del grupo. Consulta con tu docente.' } };
  }
  return { asig: asig, cfg: cfg, franja: franja, artefactoId: ASIGNATURAS[asig].codigo + '-' + cfg.Periodo + '-' + franja };
}

function calcularEstado_(s, asig, cfg) {
  const base = { notaMinima: cfg.NotaMinima, maxIntentos: cfg.MaxIntentos };
  if (s.rol === 'Docente') {
    return Object.assign(base, { ilimitado: true, usados: 0, restantes: null, mejorNota: null,
      mejorIntento: null, aprobado: false, bloqueado: false, motivo: '' });
  }
  const todos = intentosDe_(s, asig, cfg.Periodo, false);
  const contados = cfg.ContarAlIniciar === 'Si' ? todos : todos.filter(function (x) { return x.estado === 'Finalizado'; });
  const fin = todos.filter(function (x) { return x.estado === 'Finalizado' && x.nota !== ''; })
                   .sort(function (a, b) { return a.num - b.num; });
  let mejor = null, aprobadoIt = null;
  fin.forEach(function (x) {
    if (mejor === null || x.nota > mejor.nota) mejor = x;
    if (!aprobadoIt && x.nota >= cfg.NotaMinima) aprobadoIt = x;
  });
  const usados = contados.length;
  const aprobado = !!aprobadoIt;
  const agotado = usados >= cfg.MaxIntentos;
  return Object.assign(base, {
    ilimitado: false, usados: usados, restantes: Math.max(0, cfg.MaxIntentos - usados),
    mejorNota: mejor ? mejor.nota : null,
    mejorIntento: aprobadoIt ? aprobadoIt.num : (mejor ? mejor.num : null),
    aprobado: aprobado, bloqueado: aprobado || agotado,
    motivo: aprobado ? 'aprobado' : (agotado ? 'agotado' : '')
  });
}

function intentosDe_(s, asig, periodo, deDocente) {
  const t = leer_(hoja_(H.INI, COLS.INI));
  const c = { id: t.ix('IntentoID'), doc: t.ix('Documento'), asig: t.ix('Asignatura'), per: t.ix('Periodo'),
              num: t.ix('NumeroIntento'), est: t.ix('Estado'), nota: t.ix('Nota'), rol: t.ix('Rol') };
  const out = [];
  t.filas.forEach(function (f) {
    if (docNorm_(f[c.doc]) !== s.doc || String(f[c.asig]) !== asig || String(f[c.per]) !== periodo) return;
    const esDoc = String(f[c.rol]) === 'Docente';
    if (esDoc !== !!deDocente) return;
    out.push({ id: f[c.id], num: Number(f[c.num]), estado: String(f[c.est]),
               nota: f[c.nota] === '' || f[c.nota] === null ? '' : Number(f[c.nota]) });
  });
  return out;
}

function calificar_(banco, respuestas, escala) {
  let puntos = 0, puntosMax = 0, aciertos = 0, total = 0;
  const temas = {}, clave = {}, validas = {};
  banco.forEach(function (p) {
    const letras = p.opciones.map(function (o) { return o.k; });
    let r = respuestas[p.id];
    r = (typeof r === 'string' && letras.indexOf(r.toUpperCase()) >= 0) ? r.toUpperCase() : '';
    if (r) validas[p.id] = r;

    let pts = 0, max = 0, acierto = false;
    if (p.puntosPorOpcion) {                       // p. ej. escala Likert con puntos por opción
      const vals = Object.keys(p.puntosPorOpcion).map(function (k) { return Number(p.puntosPorOpcion[k]) || 0; });
      max = Math.max.apply(null, vals);
      pts = r ? (Number(p.puntosPorOpcion[r]) || 0) : 0;
      acierto = !!r && pts === max;
      Object.keys(p.puntosPorOpcion).forEach(function (k) { if ((Number(p.puntosPorOpcion[k]) || 0) === max && !clave[p.id]) clave[p.id] = k; });
    } else if (p.correcta) {                       // opción única correcta
      max = p.puntos;
      acierto = r === p.correcta;
      pts = acierto ? p.puntos : 0;
      clave[p.id] = p.correcta;
    } else {
      return;                                      // sin clave: no puntúa
    }
    const tema = p.tema || 'General';
    if (!temas[tema]) temas[tema] = { tema: tema, aciertos: 0, total: 0, puntos: 0, puntosMax: 0 };
    temas[tema].total++; temas[tema].puntos += pts; temas[tema].puntosMax += max;
    if (acierto) { temas[tema].aciertos++; aciertos++; }
    total++; puntos += pts; puntosMax += max;
  });
  const porTema = Object.keys(temas).map(function (k) {
    const t = temas[k];
    t.porcentaje = t.puntosMax ? redondear_(100 * t.puntos / t.puntosMax, 1) : 0;
    return t;
  });
  return {
    puntos: puntos, puntosMax: puntosMax, aciertos: aciertos, total: total,
    nota: puntosMax ? redondear_(escala * puntos / puntosMax, 2) : 0,
    porcentaje: puntosMax ? redondear_(100 * puntos / puntosMax, 1) : 0,
    porTema: porTema, clave: clave, respuestasValidas: validas
  };
}

/* ---------- personas ---------- */

function buscarPersona_(doc) {
  const d = leer_(hoja_(H.DOC));
  const dDoc = d.ix('Documento'), dNom = d.ix('Nombre'), dGr = d.ix('GrupoAsignado');
  for (let i = 0; i < d.filas.length; i++) {
    if (docNorm_(d.filas[i][dDoc]) === doc) {
      return { doc: doc, rol: 'Docente', nombre: String(d.filas[i][dNom]).trim(), grupo: docNorm_(d.filas[i][dGr]),
               activo: true, asignaturas: Object.keys(ASIGNATURAS) };
    }
  }
  const e = leer_(hoja_(H.EST));
  const iDoc = e.ix('Documento');
  let iNom = e.ix('Nombre del estudiante'); if (iNom < 0) iNom = e.ix('Nombre');
  const iGr = e.ix('Grupo'), iAct = e.ix('Activo');
  for (let i = 0; i < e.filas.length; i++) {
    const f = e.filas[i];
    if (docNorm_(f[iDoc]) !== doc) continue;
    const asigs = Object.keys(ASIGNATURAS).filter(function (id) {
      const ix = e.ix(ASIGNATURAS[id].colHabilita);
      return ix >= 0 && norm_(f[ix]) === 'si';
    });
    return { doc: doc, rol: 'Estudiante', nombre: String(f[iNom]).trim(), grupo: docNorm_(f[iGr]),
             activo: norm_(f[iAct]) !== 'no', asignaturas: asigs };
  }
  return null;
}

function directorDe_(grupo) {
  if (!grupo) return '';
  const d = leer_(hoja_(H.DOC));
  const iNom = d.ix('Nombre'), iGr = d.ix('GrupoAsignado');
  for (let i = 0; i < d.filas.length; i++) {
    if (docNorm_(d.filas[i][iGr]) === grupo) return String(d.filas[i][iNom]).trim();
  }
  return '';
}

function franja_(grupo) {
  const g = Math.floor(Number(docNorm_(grupo)) / 100);
  if (g >= 6 && g <= 7) return '6-7';
  if (g >= 8 && g <= 9) return '8-9';
  if (g >= 10 && g <= 11) return '10-11';
  return '';
}

function escribirNotaEstudiante_(doc, encabezado, nota) {
  const sh = hoja_(H.EST);
  asegurarColumnas_(sh, [encabezado]);
  const e = leer_(sh);
  const iDoc = e.ix('Documento'), iCol = e.ix(encabezado);
  for (let i = 0; i < e.filas.length; i++) {
    if (docNorm_(e.filas[i][iDoc]) === doc) {
      sh.getRange(i + 2, iCol + 1).setValue(nota);
      return;
    }
  }
}

/* ---------- banco de preguntas ---------- */

function bancoDe_(artefactoId) {
  const t = leer_(hoja_(H.BANCO, COLS.BANCO));
  const c = {}; COLS.BANCO.forEach(function (n) { c[n] = t.ix(n); });
  const out = [];
  t.filas.forEach(function (f) {
    if (String(f[c.ArtefactoID]) !== artefactoId) return;
    let ops = [], ppo = null;
    try { ops = JSON.parse(f[c.Opciones]); } catch (e) { ops = []; }
    try { ppo = f[c.PuntosPorOpcion] ? JSON.parse(f[c.PuntosPorOpcion]) : null; } catch (e) { ppo = null; }
    out.push({
      id: String(f[c.PreguntaID]), orden: Number(f[c.Orden]), tema: String(f[c.Tema] || ''),
      contexto: String(f[c.Contexto] || ''), enunciado: String(f[c.Enunciado] || ''), opciones: ops,
      correcta: String(f[c.Correcta] || '').toUpperCase(), puntos: Number(f[c.Puntos]) || 0,
      puntosPorOpcion: ppo, version: String(f[c.Version] || '')
    });
  });
  out.sort(function (a, b) { return a.orden - b.orden; });
  return out;
}

function infoBanco_(artefactoId) {
  const b = bancoDe_(artefactoId);
  let max = 0;
  b.forEach(function (p) {
    if (p.puntosPorOpcion) max += Math.max.apply(null, Object.keys(p.puntosPorOpcion).map(function (k) { return Number(p.puntosPorOpcion[k]) || 0; }));
    else if (p.correcta) max += p.puntos;
  });
  return { n: b.length, puntosMax: max, version: b[0] ? b[0].version : '' };
}

/* ---------- sesión, configuración y registros ---------- */

function sesion_(token) {
  if (!token || typeof token !== 'string' || token.length < 40) return null;
  const raw = CacheService.getScriptCache().get('tok_' + token);
  return raw ? JSON.parse(raw) : null;
}
function sesionExpirada_() {
  return { ok: false, codigo: 'SESION_EXPIRADA', mensaje: 'Tu sesión expiró. Vuelve a ingresar con tu documento.' };
}

function config_() {
  const cfg = { Periodo: 'P3', NotaMinima: 8, MaxIntentos: 3, Escala: 10, ContarAlIniciar: 'Si' };
  const sh = libro_().getSheetByName(H.CFG);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
      const k = String(r[0]).trim();
      if (k && r[1] !== '') cfg[k] = r[1];
    });
  }
  cfg.Periodo = String(cfg.Periodo).trim().toUpperCase();
  if (PERIODOS.indexOf(cfg.Periodo) < 0) cfg.Periodo = 'P3';
  cfg.NotaMinima = Number(cfg.NotaMinima) || 8;
  cfg.MaxIntentos = Math.max(1, Math.floor(Number(cfg.MaxIntentos)) || 3);
  cfg.Escala = Number(cfg.Escala) || 10;
  cfg.ContarAlIniciar = norm_(cfg.ContarAlIniciar) === 'no' ? 'No' : 'Si';
  return cfg;
}

function logConsulta_(s, tipo, resultado, reporte) {
  try {
    const a = ahora_();
    agregarFila_(hoja_(H.LOGC, COLS.LOGC), {
      Fecha: a.fecha, Hora: a.hora, Documento: s.doc || '', Nombre: s.nombre || '', Grupo: s.grupo || '',
      Director: s.director || (s.grupo ? directorDe_(s.grupo) : ''), Reporte: reporte || '',
      TipoConsulta: tipo, Resultado: resultado
    });
  } catch (err) {
    console.error('logConsulta_: ' + err);   // un fallo de registro nunca debe bloquear al estudiante
  }
}

/* ===================================================================
 *  UTILIDADES DE HOJA
 * =================================================================== */

function norm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}
function docNorm_(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
function redondear_(x, d) { const m = Math.pow(10, d); return Math.round(x * m) / m; }
function limpiar_(v) {                       // evita inyección de fórmulas en celdas con texto del cliente
  if (typeof v !== 'string') return v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}
function ahora_() {
  const d = new Date();
  return { fecha: Utilities.formatDate(d, TZ, 'yyyy-MM-dd'), hora: Utilities.formatDate(d, TZ, 'HH:mm:ss'), ms: d.getTime() };
}
function libro_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function hoja_(nombre, columnas) {
  let sh = libro_().getSheetByName(nombre);
  if (!sh) {
    if (!columnas) throw new Error('Falta la hoja ' + nombre);
    sh = libro_().insertSheet(nombre);
    sh.getRange(1, 1, 1, columnas.length).setValues([columnas]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function leer_(sh) {
  const lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lc === 0 || lr === 0) return { sh: sh, headers: [], filas: [], ix: function () { return -1; } };
  const vals = sh.getRange(1, 1, lr, lc).getValues();
  const headers = vals[0].map(function (h) { return String(h).trim(); });
  const mapa = {};
  headers.forEach(function (h, i) { const k = norm_(h); if (k && !(k in mapa)) mapa[k] = i; });
  return { sh: sh, headers: headers, filas: vals.slice(1),
           ix: function (n) { const k = norm_(n); return k in mapa ? mapa[k] : -1; } };
}

function asegurarColumnas_(sh, nombres) {
  const lc = sh.getLastColumn();
  const actual = lc ? sh.getRange(1, 1, 1, lc).getValues()[0].map(norm_) : [];
  const faltan = nombres.filter(function (n) { return actual.indexOf(norm_(n)) < 0; });
  if (faltan.length) sh.getRange(1, lc + 1, 1, faltan.length).setValues([faltan]).setFontWeight('bold');
  return faltan;
}

function agregarFila_(sh, obj) {
  const claves = Object.keys(obj);
  asegurarColumnas_(sh, claves);
  const hs = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const porNorm = {}; claves.forEach(function (k) { porNorm[norm_(k)] = k; });
  sh.appendRow(hs.map(function (h) {
    const k = porNorm[norm_(h)];
    return k === undefined ? '' : limpiar_(obj[k]);
  }));
}

/* ===================================================================
 *  MENÚ EN LA HOJA DE CÁLCULO (uso del docente)
 * =================================================================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Autoevaluación')
    .addItem('1. Preparar hojas y columnas', 'prepararHojas')
    .addItem('2. Importar formulario de Google como artefacto', 'importarFormulario')
    .addItem('3. Probar un inicio de sesión', 'probarLogin')
    .addToUi();
}

function prepararHojas() {
  const ui = SpreadsheetApp.getUi();
  let cfg = libro_().getSheetByName(H.CFG);
  if (!cfg) {
    cfg = libro_().insertSheet(H.CFG);
    cfg.getRange(1, 1, 6, 3).setValues([
      ['Clave', 'Valor', 'Descripción'],
      ['Periodo', 'P3', 'Periodo activo: P1, P2 o P3. Cámbialo al abrir un nuevo periodo.'],
      ['NotaMinima', 8, 'Nota mínima aprobatoria (escala 0 a Escala).'],
      ['MaxIntentos', 3, 'Intentos máximos por estudiante, asignatura y periodo.'],
      ['Escala', 10, 'Escala institucional.'],
      ['ContarAlIniciar', 'Si', 'Si: un intento se cuenta al comenzar (recargar la página no regala intentos). No: solo al enviar.']
    ]);
    cfg.getRange(1, 1, 1, 3).setFontWeight('bold'); cfg.setFrozenRows(1);
  }
  hoja_(H.BANCO, COLS.BANCO);
  hoja_(H.INI, COLS.INI);
  asegurarColumnas_(hoja_(H.LOGC, COLS.LOGC), COLS.LOGC);
  asegurarColumnas_(hoja_(H.LOGI, COLS.LOGI), COLS.LOGI);

  const nombres = [];
  Object.keys(ASIGNATURAS).forEach(function (id) { PERIODOS.forEach(function (p) { nombres.push(ASIGNATURAS[id].colNota + ' ' + p); }); });
  const nuevas = asegurarColumnas_(hoja_(H.EST), nombres);

  const e = leer_(hoja_(H.EST));
  const iAct = e.ix('Activo');
  const vacios = e.filas.filter(function (f) { return f[e.ix('Documento')] !== '' && norm_(f[iAct]) === ''; }).length;
  ui.alert('Hojas listas',
    'Columnas de notas nuevas en Estudiantes: ' + (nuevas.length ? nuevas.join(', ') : 'ninguna (ya existían)') + '.\n\n' +
    'Estudiantes con "Activo" vacío: ' + vacios + '. Se tratan como activos; solo "No" bloquea el ingreso.\n\n' +
    'Revisa la hoja Config (periodo activo, nota mínima, intentos).', ui.ButtonSet.OK);
}

function importarFormulario() {
  const ui = SpreadsheetApp.getUi();
  const r1 = ui.prompt('Importar formulario', 'Pega el enlace o el ID del formulario de Google (debes tener acceso de edición):', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  const m = r1.getResponseText().match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  const formId = m ? m[1] : r1.getResponseText().trim();

  const r2 = ui.prompt('Identificador del artefacto',
    'Formato ASIGNATURA-PERIODO-FRANJA.\nAsignatura: INF, EST o ART · Periodo: P1, P2 o P3 · Franja: 6-7, 8-9 o 10-11.\nEjemplo: INF-P3-6-7', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  const artId = r2.getResponseText().trim().toUpperCase();
  if (!/^(INF|EST|ART)-P[1-3]-(6-7|8-9|10-11)$/.test(artId)) {
    ui.alert('Identificador no válido', 'Usa el formato INF-P3-6-7 (asignatura-periodo-franja).', ui.ButtonSet.OK);
    return;
  }
  const res = importarFormularioComoBanco_(formId, artId);
  ui.alert('Importación de ' + artId,
    res.importadas + ' preguntas calificables importadas (' + res.puntosMax + ' puntos en total).\n' +
    (res.sinClave.length ? '\nSIN RESPUESTA CORRECTA en el formulario (no puntúan; revísalas): ' + res.sinClave.join(' | ') + '\n' : '') +
    (res.noSoportadas.length ? '\nNo soportadas (casillas u otro tipo): ' + res.noSoportadas.join(' | ') + '\n' : '') +
    (res.conMedios ? '\nHay ' + res.conMedios + ' imagen(es)/video(s) en el formulario: no se importan; agrégalos al HTML del artefacto.\n' : '') +
    '\nOmitidas por no tener puntos (datos de identificación): ' + res.omitidas + '.', ui.ButtonSet.OK);
}

function importarFormularioComoBanco_(formId, artId) {
  const form = FormApp.openById(formId);
  const T = FormApp.ItemType;
  const filas = [], sinClave = [], noSoportadas = [];
  let tema = '', contexto = '', omitidas = 0, conMedios = 0, orden = 0, puntosMax = 0;
  const version = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmm');

  form.getItems().forEach(function (it) {
    const t = it.getType();
    if (t === T.PAGE_BREAK) { const x = it.asPageBreakItem(); tema = x.getTitle(); contexto = x.getHelpText(); return; }
    if (t === T.SECTION_HEADER) { const x = it.asSectionHeaderItem(); if (x.getTitle()) tema = x.getTitle(); contexto = x.getHelpText(); return; }
    if (t === T.IMAGE || t === T.VIDEO) { conMedios++; return; }

    if (t === T.MULTIPLE_CHOICE || t === T.LIST) {
      const q = t === T.MULTIPLE_CHOICE ? it.asMultipleChoiceItem() : it.asListItem();
      const pts = q.getPoints();
      if (!pts) { omitidas++; return; }
      const ch = q.getChoices();
      // Si todas las opciones empiezan con "a) ", "b) "… se quita el prefijo: el artefacto ya rotula A, B, C…
      const conPrefijo = ch.length > 0 && ch.every(function (c) { return /^[a-hA-H]\)\s+/.test(c.getValue()); });
      const opciones = ch.map(function (c, i) {
        return { k: LETRAS[i], t: conPrefijo ? c.getValue().replace(/^[a-hA-H]\)\s+/, '') : c.getValue() };
      });
      let correcta = '';
      ch.forEach(function (c, i) { if (!correcta && c.isCorrectAnswer()) correcta = LETRAS[i]; });
      orden++;
      const id = 'Q' + ('0' + orden).slice(-2);
      if (!correcta) sinClave.push(orden + '. ' + String(it.getTitle()).slice(0, 50)); else puntosMax += pts;
      filas.push([artId, orden, id, tema || 'General', contexto || '', it.getTitle(), JSON.stringify(opciones),
                  correcta, pts, '', 'opcion_unica', version]);
      return;
    }
    if (it.getType() !== T.PAGE_BREAK && Number(safePts_(it)) > 0) noSoportadas.push(String(it.getTitle()).slice(0, 50));
  });

  const sh = hoja_(H.BANCO, COLS.BANCO);
  const t = leer_(sh);
  const conservar = t.filas.filter(function (f) { return String(f[t.ix('ArtefactoID')]) !== artId; });
  const todo = conservar.concat(filas);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), COLS.BANCO.length)).clearContent();
  if (todo.length) sh.getRange(2, 1, todo.length, COLS.BANCO.length).setValues(todo.map(function (f) { return f.slice(0, COLS.BANCO.length); }));
  return { importadas: filas.length, puntosMax: puntosMax, sinClave: sinClave, noSoportadas: noSoportadas, conMedios: conMedios, omitidas: omitidas };
}

function safePts_(item) {
  try { return item.getType() === FormApp.ItemType.CHECKBOX ? item.asCheckboxItem().getPoints() : 0; } catch (e) { return 0; }
}

function probarLogin() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Probar inicio de sesión', 'Documento a probar (se registrará en LogConsultas):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const out = login_({ documento: r.getResponseText() });
  delete out.token;
  ui.alert('Resultado', JSON.stringify(out, null, 2), ui.ButtonSet.OK);
}
