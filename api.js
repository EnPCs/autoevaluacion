/* Comunicación con el Apps Script, sesión del estudiante y utilidades comunes.
   Lo usan index.html y todos los artefactos. */
(function () {
  var CLAVE = 'ceinar_sesion';
  var CLAVE_INT = 'ceinar_intento';

  function llamar(accion, datos) {
    var url = (window.CONFIG || {}).API_URL || '';
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
      return Promise.resolve({ ok: false, codigo: 'SIN_CONFIG',
        mensaje: 'Falta configurar la dirección del servidor (API_URL en config.js).' });
    }
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, 30000);
    return fetch(url, {
      method: 'POST',
      // text/plain evita la solicitud previa (preflight) que Apps Script no responde
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ accion: accion }, datos || {})),
      signal: ctl.signal
    }).then(function (r) { return r.json(); })
      .catch(function () {
        return { ok: false, codigo: 'RED', mensaje: 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.' };
      })
      .then(function (r) { clearTimeout(t); return r; });
  }

  function leer(clave) {
    try { return JSON.parse(sessionStorage.getItem(clave) || 'null'); } catch (e) { return null; }
  }
  function guardar(clave, valor) {
    try { sessionStorage.setItem(clave, JSON.stringify(valor)); return true; } catch (e) { return false; }
  }
  function borrar(clave) {
    try { sessionStorage.removeItem(clave); } catch (e) { /* nada */ }
  }

  // 8,75 · 10 · 7,5  (coma decimal, sin ceros sobrantes)
  function nota(n) {
    if (n === null || n === undefined || n === '') return '—';
    return Number(n).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  /* Regla de 0 a la escala con la nota mínima marcada. o = { nota, escala, min, aprobado } */
  function pintarRegla(cont, o) {
    var hay = o.nota !== null && o.nota !== undefined && o.nota !== '';
    cont.className = 'regla' + (o.aprobado ? ' ok' : '');
    cont.setAttribute('role', 'img');
    cont.setAttribute('aria-label', (hay ? 'Nota ' + nota(o.nota) + ' de ' + nota(o.escala) : 'Todavía sin nota') +
      '. La nota mínima para aprobar es ' + nota(o.min) + '.');
    cont.innerHTML = '<div class="pista"><div class="relleno"></div><div class="minimo"><span></span></div></div>' +
                     '<div class="marcas-regla" aria-hidden="true"></div>';
    cont.querySelector('.minimo').style.left = (100 * o.min / o.escala) + '%';
    cont.querySelector('.minimo span').textContent = 'Mínimo ' + nota(o.min);
    var marcas = cont.querySelector('.marcas-regla');
    for (var i = 0; i <= o.escala; i++) {
      var s = document.createElement('span'); s.textContent = i;
      s.style.left = (100 * i / o.escala) + '%'; marcas.appendChild(s);
    }
    var relleno = cont.querySelector('.relleno');
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      relleno.style.width = hay ? Math.min(100, 100 * o.nota / o.escala) + '%' : '0';
    }); });
  }

  /* Logos de la institución y del blog. Se pueden cambiar en config.js (LOGO_CEINAR, LOGO_ENPCS);
     si la imagen no carga se prueba la carpeta assets/ y, si tampoco está, el recuadro se oculta solo. */
  var LOGO_CEINAR = 'https://i.imgur.com/6sV8Qck.png';
  function pintarLogos(cont, prefijo) {
    var C = window.CONFIG || {};
    [['Logo de la Institución Educativa CEINAR', C.LOGO_CEINAR || LOGO_CEINAR, prefijo + 'assets/logo-ceinar.png'],
     ['Logo del blog EnPCs', C.LOGO_ENPCS || (prefijo + 'assets/logo-enpcs.png'), prefijo + 'assets/logo-enpcs.png']].forEach(function (l) {
      var chip = document.createElement('span'); chip.className = 'logo-chip';
      var img = document.createElement('img'); img.alt = l[0];
      img.addEventListener('error', function () {
        if (!img.dataset.f && img.getAttribute('src') !== l[2]) { img.dataset.f = '1'; img.src = l[2]; }
        else if (chip.parentNode) chip.parentNode.removeChild(chip);
      });
      img.src = l[1]; chip.appendChild(img); cont.appendChild(chip);
    });
  }

  window.Api = {
    llamar: llamar, nota: nota, pintarRegla: pintarRegla, pintarLogos: pintarLogos,
    leerSesion: function () { return leer(CLAVE); },
    guardarSesion: function (s) { return guardar(CLAVE, s); },
    borrarSesion: function () { borrar(CLAVE); },
    leerIntento: function () { return leer(CLAVE_INT); },
    guardarIntento: function (i) { return guardar(CLAVE_INT, i); },
    borrarIntento: function () { borrar(CLAVE_INT); },
    /* Aviso que index.html muestra una sola vez (p. ej. sesión expirada) */
    dejarAviso: function (t) { try { sessionStorage.setItem('ceinar_aviso', t); } catch (e) { /* nada */ } },
    tomarAviso: function () {
      try { var t = sessionStorage.getItem('ceinar_aviso'); sessionStorage.removeItem('ceinar_aviso'); return t; } catch (e) { return null; }
    }
  };
})();
