/* Motor de las autoevaluaciones.
   Cada HTML de artefacto solo declara window.ARTEFACTO y carga este archivo:
   así un cambio aquí se aplica a todas las asignaturas, periodos y franjas. */
(function () {
  'use strict';

  var A = window.ARTEFACTO;               // { id, asignatura, titulo, grados, periodo }
  var C = window.CONFIG || {};
  var S = Api.leerSesion();
  var ES_DOC = !!(S && S.rol === 'Docente');
  var DUENO = S ? (S.nombre + '|' + S.grupo) : '';

  var intento = null;                     // intento en curso (se guarda en sessionStorage)
  var estado = null;                      // estado devuelto por el servidor
  var resultado = null;                   // respuesta de "enviar"
  var timer = null;

  var $ = function (id) { return document.getElementById(id); };
  var VISTAS = ['vCarga', 'vIntro', 'vQuiz', 'vEnvio', 'vResultado', 'vRevision', 'vError'];
  var N = Api.nota;

  /* ===================== utilidades ===================== */
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }
  function plural(n, uno, varios) { return n === 1 ? uno : varios; }
  // Muestra texto plano; lo que va entre `comillas invertidas` se pinta como código.
  function escribirTexto(contenedor, texto) {
    contenedor.textContent = '';
    String(texto == null ? '' : texto).split('`').forEach(function (seg, i) {
      if (!seg) return;
      if (i % 2) contenedor.appendChild(el('code', '', seg));
      else contenedor.appendChild(document.createTextNode(seg));
    });
  }
  function mostrar(vista, foco) {
    VISTAS.forEach(function (v) { $(v).hidden = (v !== vista); });
    $('barraFija').hidden = !(vista === 'vQuiz' || vista === 'vEnvio');
    window.onbeforeunload = (vista === 'vQuiz' || vista === 'vEnvio')
      ? function (e) { e.preventDefault(); e.returnValue = ''; return ''; } : null;
    var f = foco && $(foco);
    if (f) f.focus(); else window.scrollTo(0, 0);
  }
  function irInicio() { window.location.href = '../index.html'; }
  function sesionExpirada() {
    Api.dejarAviso('Tu sesión expiró. Ingresa de nuevo con tu documento; si tenías un intento en curso, podrás continuarlo.');
    Api.borrarSesion();
    window.onbeforeunload = null;
    window.location.replace('../index.html');
  }
  function error(msg, conReintento) {
    $('errTexto').textContent = msg;
    $('btnReintentar').hidden = !conReintento;
    mostrar('vError', 'tError');
  }
  function guardar() { Api.guardarIntento(intento); }

  /* ===================== estructura de la página ===================== */
  var SHELL =
    '<div class="barra-fija" id="barraFija" hidden>' +
      '<div class="interior"><span class="materia-b" id="bMateria"></span>' +
      '<span class="datos"><span id="bIntento"></span><span id="bProg"></span><span>Tiempo <strong id="bTiempo">00:00</strong></span></span></div>' +
      '<div class="medidor" aria-hidden="true"><div id="bMedidor"></div></div>' +
    '</div>' +
    '<header class="cabecera compacta"><div class="envoltura">' +
      '<div class="marcas">' +
        '<span class="logo-chip"><img src="../assets/logo-ceinar.png" alt="Logo de la Institución Educativa CEINAR" onerror="this.parentNode.remove()"></span>' +
        '<span class="logo-chip"><img src="../assets/logo-enpcs.png" alt="Logo del blog EnPCs" onerror="this.parentNode.remove()"></span>' +
      '</div>' +
      '<h1 id="hTitulo"></h1><p class="quien" id="hSub"></p>' +
    '</div></header>' +
    '<main><div class="envoltura">' +

    '<section class="panel" id="vCarga"><p class="cargando" role="status" style="margin:0">Preparando tu autoevaluación…</p></section>' +

    '<section class="panel" id="vIntro" hidden>' +
      '<div class="barra"><a class="enlace" href="../index.html">Volver al inicio</a></div>' +
      '<h2 id="tIntro" tabindex="-1"></h2>' +
      '<ul class="reglas" id="listaReglas"></ul>' +
      '<div class="intentos" id="introIntentos"></div>' +
      '<div class="aviso" id="introAviso"><h3 id="introAvisoT"></h3><p id="introAvisoP"></p></div>' +
      '<div class="acciones" id="introAcc"><button class="boton lleno" type="button" id="btnIniciar"></button></div>' +
      '<p class="error" id="errIntro" role="alert" hidden></p>' +
    '</section>' +

    '<section id="vQuiz" hidden>' +
      '<article class="panel tarjeta" id="tarjeta" aria-live="polite"></article>' +
      '<div class="nav-preg"><button class="boton suave" type="button" id="btnAnt">Anterior</button>' +
      '<button class="boton" type="button" id="btnSig">Siguiente</button></div>' +
      '<p class="ir-envio"><button class="enlace" type="button" id="btnRevisar">Terminar: revisar y enviar</button></p>' +
      '<details class="hoja" id="hoja"><summary>Hoja de respuestas</summary>' +
        '<div class="burbujas" id="burbujas"></div>' +
        '<p class="leyenda">Azul: respondida. Blanca: sin responder. El borde amarillo marca dónde estás.</p>' +
      '</details>' +
    '</section>' +

    '<section class="panel" id="vEnvio" hidden>' +
      '<h2 id="tEnvio" tabindex="-1">Revisa antes de enviar</h2>' +
      '<p class="lead" id="resumenTxt"></p>' +
      '<div id="bloqueFaltan" hidden><p style="margin-top:16px;font-weight:700">Sin responder, toca un número para ir a esa pregunta:</p><div class="faltan" id="faltan"></div></div>' +
      '<div class="aviso alerta"><h3>Después de enviar no puedes cambiar tus respuestas</h3><p id="avisoEnvio"></p></div>' +
      '<div class="acciones"><button class="boton suave" type="button" id="btnSeguir">Seguir respondiendo</button>' +
      '<button class="boton" type="button" id="btnEnviar">Enviar mi intento</button></div>' +
      '<p class="error" id="errEnvio" role="alert" hidden></p>' +
    '</section>' +

    '<section class="panel" id="vResultado" hidden>' +
      '<h2 id="tRes" tabindex="-1"></h2>' +
      '<div class="nota-grande"><span class="valor" id="resNota"></span><span class="de" id="resDe"></span></div>' +
      '<div id="resRegla"></div>' +
      '<div class="aviso" id="resAviso"><h3 id="resAvisoT"></h3><p id="resAvisoP"></p></div>' +
      '<h3 class="sub">Resultado por tema</h3><ul class="temas" id="resTemas"></ul>' +
      '<div class="acciones"><button class="boton lleno" type="button" id="btnVerClave" hidden>Ver mis respuestas y la clave</button>' +
      '<button class="boton suave" type="button" id="btnOtra" hidden>Probar otra vez</button>' +
      '<a class="boton suave" href="../index.html" style="text-decoration:none;text-align:center">Volver al inicio</a></div>' +
    '</section>' +

    '<section class="panel" id="vRevision" hidden>' +
      '<div class="barra"><button class="enlace" type="button" id="btnVolverRes">Volver al resultado</button></div>' +
      '<h2 id="tRev" tabindex="-1">Tus respuestas y la clave</h2>' +
      '<label class="filtro"><input type="checkbox" id="soloFalladas"> Mostrar solo las que no acerté</label>' +
      '<div id="revLista"></div>' +
    '</section>' +

    '<section class="panel" id="vError" hidden>' +
      '<h2 id="tError" tabindex="-1">No pudimos continuar</h2>' +
      '<p class="error" id="errTexto" role="alert"></p>' +
      '<div class="acciones"><button class="boton" type="button" id="btnReintentar" hidden>Intentar de nuevo</button>' +
      '<a class="boton suave" href="../index.html" style="text-decoration:none;text-align:center">Volver al inicio</a></div>' +
    '</section>' +

    '</div></main>';

  /* ===================== arranque ===================== */
  function arrancar() {
    document.title = 'Autoevaluación de ' + A.titulo + ', grados ' + A.grados + ', periodo ' + A.periodo;
    $('app').innerHTML = SHELL;
    $('hTitulo').textContent = 'Autoevaluación de ' + A.titulo;
    $('hSub').textContent = 'Grados ' + A.grados + ', periodo ' + A.periodo;
    $('bMateria').textContent = A.titulo + ', periodo ' + A.periodo;

    $('btnIniciar').addEventListener('click', onIniciar);
    $('btnAnt').addEventListener('click', function () { ir(intento.actual - 1); });
    $('btnSig').addEventListener('click', function () {
      if (intento.actual === intento.preguntas.length - 1) irEnvio(); else ir(intento.actual + 1);
    });
    $('btnRevisar').addEventListener('click', irEnvio);
    $('btnSeguir').addEventListener('click', function () { mostrar('vQuiz'); pintarPregunta(); });
    $('btnEnviar').addEventListener('click', enviar);
    $('btnVerClave').addEventListener('click', irRevision);
    $('btnVolverRes').addEventListener('click', function () { mostrar('vResultado', 'tRes'); });
    $('soloFalladas').addEventListener('change', pintarRevision);
    $('btnOtra').addEventListener('click', function () { resultado = null; intento = null; consultarEstado(); });
    $('btnReintentar').addEventListener('click', function () { consultarEstado(); });

    if (!S || !S.token || S.artefactoId !== A.id) { irInicio(); return; }   // se llega desde el inicio

    // ¿Hay un intento en curso de este artefacto y de esta misma persona? Se reanuda sin gastar otro.
    var g = Api.leerIntento();
    if (g && g.artefactoId === A.id && g.dueno === DUENO && g.preguntas && g.preguntas.length) {
      intento = g;
      pintarIntroReanudar();
    } else {
      if (g) Api.borrarIntento();
      consultarEstado();
    }
  }

  /* ===================== estado e introducción ===================== */
  function consultarEstado() {
    mostrar('vCarga');
    Api.llamar('estado', { token: S.token, asignatura: A.asignatura, franja: ES_DOC ? S.franjaElegida : undefined })
      .then(function (e) {
        if (!e.ok) {
          if (e.codigo === 'SESION_EXPIRADA') return sesionExpirada();
          return error(e.mensaje || 'No se pudo consultar tu estado.', e.codigo === 'RED');
        }
        if (e.artefactoId !== A.id) { irInicio(); return; }   // la página no corresponde a tu grupo o periodo
        estado = e;
        pintarIntro();
      });
  }

  function fichas(cont, e) {
    cont.innerHTML = '';
    if (e.ilimitado) {
      var t0 = el('span', 'texto'); t0.innerHTML = '<strong>Intentos ilimitados</strong> en modo docente'; cont.appendChild(t0);
      return;
    }
    for (var k = 1; k <= e.maxIntentos; k++) {
      var f = el('span', 'ficha' + (k <= e.usados ? ' usada' : ''), String(k)); f.setAttribute('aria-hidden', 'true'); cont.appendChild(f);
    }
    var t = el('span', 'texto'); var s = el('strong', '', 'Usaste ' + e.usados + ' de ' + e.maxIntentos);
    t.appendChild(s); t.appendChild(document.createTextNode(' ' + plural(e.maxIntentos, 'intento', 'intentos'))); cont.appendChild(t);
  }

  function reglas(e) {
    var l = $('listaReglas'); l.innerHTML = '';
    var items = [
      'Responde con honestidad. Puedes cambiar tus respuestas antes de enviar.',
      'Necesitas ' + N(e.notaMinima) + ' de ' + N(e.escala) + ' para aprobar.',
      'El intento se cuenta desde que pulsas Comenzar.',
      'Si recargas la página, continúas donde ibas. Si cierras la pestaña, pierdes el intento.',
      e.verClave
        ? 'Al terminar verás tu nota y tu resultado por tema. Las respuestas correctas se muestran cuando apruebas o usas todos tus intentos.'
        : 'Al terminar verás tu nota y tu resultado por tema. Las respuestas correctas no se muestran en tu grado.'
    ];
    if (e.ilimitado) items.push('Modo docente: puedes probar cuantas veces quieras y no se escribe nota en la lista de estudiantes.');
    items.forEach(function (t) { l.appendChild(el('li', '', t)); });
  }

  function pintarIntro() {
    var e = estado, av = $('introAviso'), btn = $('btnIniciar');
    $('tIntro').textContent = 'Antes de comenzar';
    reglas(e); fichas($('introIntentos'), e);
    btn.hidden = false; btn.disabled = false; mostrarErr($('errIntro'), '');
    if (!e.disponible) {
      av.className = 'aviso neutro'; $('introAvisoT').textContent = 'Todavía no está publicada';
      $('introAvisoP').textContent = 'Esta autoevaluación aún no está disponible para tus grados. Vuelve más tarde o pregunta a tu docente.';
      btn.hidden = true;
    } else if (e.motivo === 'aprobado') {
      av.className = 'aviso ok'; $('introAvisoT').textContent = 'Ya aprobaste esta autoevaluación';
      $('introAvisoP').textContent = 'Obtuviste ' + N(e.mejorNota) + ' de ' + N(e.escala) + ' en el intento ' + e.mejorIntento + '. Ya no necesitas más intentos.';
      btn.hidden = true;
    } else if (e.motivo === 'agotado') {
      av.className = 'aviso alerta'; $('introAvisoT').textContent = 'Usaste todos tus intentos';
      $('introAvisoP').textContent = (e.mejorNota !== null ? 'Tu mejor nota fue ' + N(e.mejorNota) + ' de ' + N(e.escala) + '. ' : '') + 'Si necesitas otra oportunidad, habla con tu docente.';
      btn.hidden = true;
    } else if (e.ilimitado) {
      av.className = 'aviso'; $('introAvisoT').textContent = 'Prueba la autoevaluación';
      $('introAvisoP').textContent = 'Cada intento queda registrado con el rol Docente.';
      btn.textContent = 'Comenzar prueba';
    } else {
      var ultimo = e.restantes === 1;
      av.className = 'aviso' + (ultimo ? ' alerta' : '');
      $('introAvisoT').textContent = ultimo ? 'Este es tu último intento' : 'Tienes ' + e.restantes + ' ' + plural(e.restantes, 'intento disponible', 'intentos disponibles');
      $('introAvisoP').textContent = 'Cuando estés listo, pulsa Comenzar. Busca un momento tranquilo y con buena conexión.';
      btn.textContent = 'Comenzar intento ' + (e.usados + 1) + ' de ' + e.maxIntentos;
    }
    $('introAcc').hidden = btn.hidden;
    mostrar('vIntro', 'tIntro');
  }

  function pintarIntroReanudar() {
    var respondidas = Object.keys(intento.respuestas).length, total = intento.preguntas.length, btn = $('btnIniciar');
    $('tIntro').textContent = 'Tienes un intento en curso';
    estado = { ilimitado: intento.ilimitado, usados: intento.numero, maxIntentos: intento.maxIntentos,
               notaMinima: intento.notaMinima, escala: intento.escala, verClave: intento.verClave };
    reglas(estado); fichas($('introIntentos'), estado);
    $('introAviso').className = 'aviso';
    $('introAvisoT').textContent = 'Intento ' + intento.numero + ': ' + respondidas + ' de ' + total + ' respondidas';
    $('introAvisoP').textContent = 'Continúa donde ibas. Tus respuestas están guardadas en esta pestaña.';
    btn.hidden = false; btn.disabled = false; btn.textContent = 'Continuar mi intento'; $('introAcc').hidden = false;
    mostrarErr($('errIntro'), '');
    mostrar('vIntro', 'tIntro');
  }

  function mostrarErr(nodo, msg) { nodo.textContent = msg; nodo.hidden = !msg; }

  /* ===================== iniciar o continuar ===================== */
  function onIniciar() {
    if (intento) { entrarQuiz(); return; }                  // reanudar
    var btn = $('btnIniciar'); btn.disabled = true; btn.textContent = 'Preparando tus preguntas…';
    mostrarErr($('errIntro'), '');
    Api.llamar('iniciar', { token: S.token, asignatura: A.asignatura, franja: ES_DOC ? S.franjaElegida : undefined })
      .then(function (r) {
        if (!r.ok) {
          if (r.codigo === 'SESION_EXPIRADA') return sesionExpirada();
          if (r.codigo === 'BLOQUEADO') return consultarEstado();
          btn.disabled = false; btn.textContent = 'Comenzar intento';
          return mostrarErr($('errIntro'), r.mensaje || 'No se pudo iniciar el intento.');
        }
        intento = {
          artefactoId: A.id, dueno: DUENO, intentoId: r.intentoId, numero: r.numeroIntento, maxIntentos: r.maxIntentos,
          ilimitado: !!r.ilimitado, preguntas: r.preguntas, respuestas: {}, actual: 0, inicioMs: Date.now(),
          notaMinima: estado.notaMinima, escala: estado.escala, verClave: r.verClave !== undefined ? !!r.verClave : !!estado.verClave
        };
        if (!Api.guardarIntento(intento)) {
          // Sin almacenamiento el intento no sobrevive a una recarga, pero se puede responder.
          mostrarErr($('errIntro'), '');
        }
        entrarQuiz();
      });
  }

  function entrarQuiz() {
    $('bIntento').textContent = intento.ilimitado ? 'Modo docente' : 'Intento ' + intento.numero + ' de ' + intento.maxIntentos;
    iniciarReloj();
    mostrar('vQuiz');
    pintarPregunta(true);
  }

  function iniciarReloj() {
    if (timer) clearInterval(timer);
    var tick = function () {
      var s = Math.max(0, Math.floor((Date.now() - intento.inicioMs) / 1000));
      $('bTiempo').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    };
    tick(); timer = setInterval(tick, 1000);
  }

  /* ===================== preguntas ===================== */
  function respondidas() { return Object.keys(intento.respuestas).length; }

  function actualizarProgreso() {
    var n = respondidas(), t = intento.preguntas.length;
    $('bProg').textContent = n + ' de ' + t + ' respondidas';
    $('bMedidor').style.width = (100 * n / t) + '%';
    var b = $('burbujas').children;
    for (var i = 0; i < b.length; i++) {
      var p = intento.preguntas[i];
      b[i].className = 'bub' + (intento.respuestas[p.id] ? ' resp' : '') + (i === intento.actual ? ' actual' : '');
      b[i].setAttribute('aria-label', 'Pregunta ' + (i + 1) + (intento.respuestas[p.id] ? ', respondida' : ', sin responder') + (i === intento.actual ? ', actual' : ''));
    }
  }

  function construirBurbujas() {
    var c = $('burbujas'); c.innerHTML = '';
    intento.preguntas.forEach(function (p, i) {
      var b = el('button', 'bub', String(i + 1)); b.type = 'button';
      b.addEventListener('click', function () { ir(i); });
      c.appendChild(b);
    });
  }

  function ir(i) {
    if (i < 0 || i >= intento.preguntas.length) return;
    intento.actual = i; guardar(); pintarPregunta();
    $('tarjeta').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function pintarPregunta(primera) {
    if (primera) construirBurbujas();
    var i = intento.actual, p = intento.preguntas[i], marcada = intento.respuestas[p.id];
    var ant = i > 0 ? intento.preguntas[i - 1] : null;
    var t = $('tarjeta'); t.innerHTML = '';

    var cab = el('div', 't-cab');
    cab.appendChild(el('span', 't-num', 'Pregunta ' + (i + 1) + ' de ' + intento.preguntas.length));
    if (p.tema && p.tema !== 'General') cab.appendChild(el('span', 'tag', p.tema));
    t.appendChild(cab);

    if (p.contexto) {
      var d = el('details', 'apoyo'); d.open = !ant || ant.contexto !== p.contexto;
      d.appendChild(el('summary', '', 'Texto de apoyo'));
      var pre = el('div', 'pre'); escribirTexto(pre, p.contexto); d.appendChild(pre); t.appendChild(d);
    }

    var h = el('h3', 'enun'); h.id = 'enun'; escribirTexto(h, p.enunciado); t.appendChild(h);

    var fs = el('fieldset', 'opciones'); fs.setAttribute('aria-labelledby', 'enun');
    p.opciones.forEach(function (o) {
      var lab = el('label', 'opcion' + (marcada === o.k ? ' sel' : ''));
      var inp = document.createElement('input'); inp.type = 'radio'; inp.name = 'resp'; inp.value = o.k; inp.checked = (marcada === o.k);
      inp.addEventListener('change', function () {
        intento.respuestas[p.id] = o.k; guardar();
        Array.prototype.forEach.call(fs.querySelectorAll('.opcion'), function (x) { x.classList.toggle('sel', x === lab); });
        mostrarBorrar(); actualizarProgreso();
      });
      lab.appendChild(inp); lab.appendChild(el('span', 'letra', o.k));
      var tx = el('span', 'txt'); escribirTexto(tx, o.t); lab.appendChild(tx);
      fs.appendChild(lab);
    });
    t.appendChild(fs);

    var bor = el('button', 'enlace borrar', 'Borrar mi respuesta'); bor.type = 'button';
    bor.addEventListener('click', function () {
      delete intento.respuestas[p.id]; guardar(); pintarPregunta(); actualizarProgreso();
    });
    t.appendChild(bor);
    function mostrarBorrar() { bor.hidden = !intento.respuestas[p.id]; }
    mostrarBorrar();

    $('btnAnt').disabled = (i === 0);
    $('btnSig').textContent = (i === intento.preguntas.length - 1) ? 'Revisar y enviar' : 'Siguiente';
    actualizarProgreso();
  }

  /* ===================== envío ===================== */
  function irEnvio() {
    var total = intento.preguntas.length, n = respondidas(), faltan = total - n;
    $('resumenTxt').textContent = 'Respondiste ' + n + ' de ' + total + ' preguntas.';
    var bf = $('bloqueFaltan'), fl = $('faltan'); fl.innerHTML = '';
    bf.hidden = faltan === 0;
    intento.preguntas.forEach(function (p, i) {
      if (intento.respuestas[p.id]) return;
      var b = el('button', 'bub', String(i + 1)); b.type = 'button';
      b.addEventListener('click', function () { mostrar('vQuiz'); ir(i); });
      fl.appendChild(b);
    });
    $('avisoEnvio').textContent = faltan > 0
      ? 'Las preguntas sin responder cuentan como incorrectas. Tu intento ' + (intento.ilimitado ? '' : 'número ' + intento.numero + ' ') + 'se registrará con la nota que obtengas.'
      : 'Tu intento ' + (intento.ilimitado ? '' : 'número ' + intento.numero + ' ') + 'se registrará con la nota que obtengas.';
    $('btnEnviar').textContent = faltan > 0 ? 'Enviar con ' + faltan + ' sin responder' : 'Enviar mi intento';
    $('btnEnviar').disabled = false; mostrarErr($('errEnvio'), '');
    mostrar('vEnvio', 'tEnvio');
  }

  function enviar() {
    var btn = $('btnEnviar'); btn.disabled = true; btn.textContent = 'Enviando…'; mostrarErr($('errEnvio'), '');
    Api.llamar('enviar', { token: S.token, intentoId: intento.intentoId, respuestas: intento.respuestas })
      .then(function (r) {
        if (r.ok) {
          resultado = r; Api.borrarIntento(); if (timer) clearInterval(timer);
          pintarResultado(); return;
        }
        if (r.codigo === 'SESION_EXPIRADA') return sesionExpirada();
        if (r.codigo === 'INTENTO_CERRADO') {
          Api.borrarIntento(); window.onbeforeunload = null;
          return error('Este intento ya fue enviado. Vuelve al inicio para ver tu estado.', false);
        }
        btn.disabled = false; btn.textContent = 'Intentar enviar de nuevo';
        mostrarErr($('errEnvio'), (r.mensaje || 'No se pudo enviar.') + ' Tus respuestas siguen guardadas en esta pestaña: revisa tu conexión y vuelve a pulsar el botón.');
      });
  }

  /* ===================== resultado ===================== */
  function pintarResultado() {
    var r = resultado, e = r.estado;
    $('tRes').textContent = 'Resultado del intento ' + r.numeroIntento;
    $('resNota').textContent = N(r.nota); $('resDe').textContent = 'de ' + N(r.escala);
    Api.pintarRegla($('resRegla'), { nota: r.nota, escala: r.escala, min: r.notaMinima, aprobado: r.aprobado });

    var av = $('resAviso'), t = $('resAvisoT'), p = $('resAvisoP');
    if (ES_DOC) {
      av.className = 'aviso'; t.textContent = r.aprobado ? 'Con esta nota un estudiante aprobaría' : 'Con esta nota un estudiante no aprobaría';
      p.textContent = 'Modo docente: este resultado no cambia las notas de la lista de estudiantes.';
    } else if (r.aprobado) {
      av.className = 'aviso ok'; t.textContent = 'Aprobaste esta autoevaluación';
      p.textContent = 'Obtuviste ' + N(r.nota) + ' de ' + N(r.escala) + ', por encima del mínimo de ' + N(r.notaMinima) + '. Ya no necesitas más intentos.';
    } else if (e.restantes > 0) {
      av.className = 'aviso alerta'; t.textContent = 'Todavía no llegas al mínimo';
      p.textContent = 'Necesitas ' + N(r.notaMinima) + ' de ' + N(r.escala) + ' y obtuviste ' + N(r.nota) + '. Te ' + plural(e.restantes, 'queda ', 'quedan ') + e.restantes + ' ' + plural(e.restantes, 'intento', 'intentos') + '. Repasa los temas con menor porcentaje antes de volver a intentar.';
    } else {
      av.className = 'aviso alerta'; t.textContent = 'Usaste todos tus intentos';
      p.textContent = 'Tu mejor nota fue ' + N(e.mejorNota) + ' de ' + N(r.escala) + '. Si necesitas otra oportunidad, habla con tu docente.';
    }

    var ul = $('resTemas'); ul.innerHTML = '';
    r.porTema.forEach(function (x) {
      var li = el('li'), fila = el('div', 'fila');
      fila.appendChild(el('span', 'nombre-t', x.tema));
      fila.appendChild(el('span', 'cuenta', x.aciertos + ' de ' + x.total + ' correctas, ' + N(x.porcentaje) + '%'));
      var barra = el('div', 'barra-t'), rel = el('div', x.porcentaje >= r.notaMinima * 100 / r.escala ? 'alto' : ''); rel.style.width = x.porcentaje + '%';
      barra.appendChild(rel); li.appendChild(fila); li.appendChild(barra); ul.appendChild(li);
    });

    $('btnVerClave').hidden = !r.clave;
    $('btnOtra').hidden = !ES_DOC;
    mostrar('vResultado', 'tRes');
  }

  /* ===================== revisión con clave ===================== */
  function irRevision() { pintarRevision(); mostrar('vRevision', 'tRev'); }

  function pintarRevision() {
    var cont = $('revLista'); cont.innerHTML = '';
    var solo = $('soloFalladas').checked, clave = resultado.clave || {}, n = 0;
    intento.preguntas.forEach(function (p, i) {
      var mia = intento.respuestas[p.id], ok = clave[p.id];
      var acerto = mia && mia === ok;
      if (solo && acerto) return;
      n++;
      var art = el('article', 'rev');
      var cab = el('div', 't-cab'); cab.appendChild(el('span', 't-num', 'Pregunta ' + (i + 1)));
      cab.appendChild(el('span', 'rev-estado ' + (acerto ? 'bien' : (mia ? 'mal' : 'sin')), acerto ? 'Acertaste' : (mia ? 'No acertaste' : 'Sin responder')));
      art.appendChild(cab);
      var en = el('p', 'rev-enun'); escribirTexto(en, p.enunciado); art.appendChild(en);
      var ul = el('ul', 'rev-lista');
      p.opciones.forEach(function (o) {
        var cls = 'rev-opc' + (o.k === ok ? ' correcta' : (o.k === mia ? ' mala' : ''));
        var li = el('li', cls); li.appendChild(el('span', 'letra', o.k));
        var d = el('div'); var tx = el('span', 'txt'); escribirTexto(tx, o.t); d.appendChild(tx);
        if (o.k === ok && o.k === mia) d.appendChild(el('span', 'marca', 'Tu respuesta, correcta'));
        else if (o.k === ok) d.appendChild(el('span', 'marca', 'Respuesta correcta'));
        else if (o.k === mia) d.appendChild(el('span', 'marca', 'Tu respuesta'));
        li.appendChild(d); ul.appendChild(li);
      });
      art.appendChild(ul); cont.appendChild(art);
    });
    if (!n) cont.appendChild(el('p', 'lead', 'Acertaste todas las preguntas.'));
  }

  /* ===================== inicio ===================== */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
})();
