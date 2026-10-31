/* Comunicación con el Apps Script y manejo de la sesión del estudiante.
   Lo usan index.html y todos los artefactos. */
(function () {
  var CLAVE = 'ceinar_sesion';

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

  function leerSesion() {
    try { return JSON.parse(sessionStorage.getItem(CLAVE) || 'null'); } catch (e) { return null; }
  }
  function guardarSesion(s) {
    try { sessionStorage.setItem(CLAVE, JSON.stringify(s)); return true; } catch (e) { return false; }
  }
  function borrarSesion() {
    try { sessionStorage.removeItem(CLAVE); } catch (e) { /* nada */ }
  }
  // 8,75 · 10 · 7,5  (coma decimal, sin ceros sobrantes)
  function nota(n) {
    if (n === null || n === undefined || n === '') return '—';
    return Number(n).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  window.Api = { llamar: llamar, leerSesion: leerSesion, guardarSesion: guardarSesion, borrarSesion: borrarSesion, nota: nota };
})();
