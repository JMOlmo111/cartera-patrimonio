/* =========================================================
   Cartera Patrimonio · app (PWA) — Fase 1
   Toda la información procede del backend (Apps Script).
   No se muestra ningún dato inventado: si falta, se indica.
   ========================================================= */
(function () {
  'use strict';

  const CLAVE_CONEXION = 'cp_conexion';
  const CLAVE_CACHE = 'cp_cache_resumen';
  const TITULOS = { patrimonio: 'Mi patrimonio', oro: 'Oro', fondos: 'Fondos indexados', cartera: 'Mi cartera', informes: 'Asesor e informes' };

  const estado = { conexion: null, datos: null, vista: 'patrimonio', graficos: {}, cargando: false, deCache: false };

  /* ---------------- Utilidades ---------------- */
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtEur = (n, dec) => (n === null || n === undefined || isNaN(n)) ? '—' :
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: dec === undefined ? 2 : dec, maximumFractionDigits: dec === undefined ? 2 : dec }).format(n);
  const fmtNum = (n, dec) => (n === null || n === undefined || isNaN(n)) ? '—' :
    new Intl.NumberFormat('es-ES', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }).format(n);
  const fmtPct = (n, dec, signo) => (n === null || n === undefined || isNaN(n)) ? '—' :
    (signo && n > 0 ? '+' : '') + fmtNum(n, dec === undefined ? 2 : dec) + ' %';
  const clase = n => n > 0 ? 'pos' : (n < 0 ? 'neg' : '');
  const fmtFecha = iso => {
    if (!iso) return '—';
    const d = new Date(String(iso).length <= 10 ? iso + 'T12:00:00' : iso);
    if (isNaN(d)) return esc(iso);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const fmtFechaHora = iso => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? esc(iso) : d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  const hoyISO = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const leerLS = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const guardarLS = (k, v) => {
    try {
      // Con PIN activado, la app no guarda en el móvil copias de tus datos financieros ni del chat
      if ((k === CLAVE_CACHE || k === 'cp_chat') && localStorage.getItem('cp_seguro')) return;
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { /* sin almacenamiento */ }
  };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('visible'), 3200);
  }

  /* ---------------- Comunicación con el backend ---------------- */
  async function api(accion, datos) {
    if (!estado.conexion) throw new Error('Sin conexión configurada.');
    const resp = await fetch(estado.conexion.url, {
      method: 'POST',
      // text/plain evita la comprobación previa CORS, que Apps Script no admite
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: estado.conexion.token, accion: accion, datos: datos || {} }),
      redirect: 'follow'
    });
    if (!resp.ok) throw new Error('El servidor respondió ' + resp.status);
    const j = await resp.json();
    if (!j.ok) {
      const err = new Error(j.error || 'Error desconocido');
      err.codigo = j.codigo;
      throw err;
    }
    return j.datos;
  }

  async function cargar(accion, datos, mensajeOk) {
    if (estado.cargando) return;
    estado.cargando = true;
    $('#btn-refrescar').classList.add('girando');
    $('#estado-sync').textContent = 'Sincronizando…';
    try {
      const r = await api(accion || 'resumen', datos);
      estado.datos = r;
      estado.deCache = false;
      estado.ultimaSync = new Date().toISOString();
      guardarLS(CLAVE_CACHE, { guardado: estado.ultimaSync, datos: r });
      $('#aviso-offline').hidden = true;
      pintar();
      if (mensajeOk) toast(mensajeOk);
      return r;
    } catch (e) {
      if (e.codigo === 'NO_AUTORIZADO') {
        toast('Código de acceso incorrecto. Revísalo en Ajustes.');
      } else if (!accion || accion === 'resumen') {
        const c = leerLS(CLAVE_CACHE);
        if (c && c.datos && !estado.datos) { estado.datos = c.datos; estado.deCache = true; pintar(); }
        const banda = $('#aviso-offline');
        banda.hidden = false;
        banda.textContent = 'No se ha podido conectar (' + e.message + '). ' +
          (estado.datos ? 'Se muestran los últimos datos guardados' + (c ? ' (' + fmtFechaHora(c.guardado) + ')' : '') + '.' : '');
      }
      throw e;
    } finally {
      estado.cargando = false;
      $('#btn-refrescar').classList.remove('girando');
      actualizarSync();
    }
  }

  function actualizarSync() {
    const c = leerLS(CLAVE_CACHE);
    const cuando = c ? c.guardado : estado.ultimaSync;
    $('#estado-sync').textContent = cuando ? (estado.deCache ? 'Sin conexión · ' : 'Actualizado ') + fmtFechaHora(cuando) : '—';
  }

  /* ---------------- Navegación ---------------- */
  function irA(vista) {
    estado.vista = vista;
    document.querySelectorAll('.navegacion button').forEach(b => {
      if (b.dataset.vista === vista) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('#titulo-pantalla').textContent = TITULOS[vista];
    document.querySelectorAll('.vista').forEach(v => { v.hidden = true; });
    $('#v-' + vista).hidden = false;
    pintar();
    window.scrollTo({ top: 0 });
    try { history.replaceState(null, '', '#' + vista); } catch (e) {}
  }

  function pintar() {
    if (!estado.datos) return;
    Object.values(estado.graficos).forEach(g => { try { g.destroy(); } catch (e) {} });
    estado.graficos = {};
    const f = { patrimonio: vistaPatrimonio, oro: vistaOro, fondos: vistaFondos, cartera: vistaCartera, informes: vistaInformes }[estado.vista];
    f($('#v-' + estado.vista), estado.datos);
  }

  /* ---------------- Bloques comunes ---------------- */
  function bloqueProximamente(titulo, fase, texto) {
    return `<article class="tarjeta proximamente"><h2>${esc(titulo)} <span class="fase">${esc(fase)}</span></h2><p class="suave">${esc(texto)}</p></article>`;
  }

  function tarjetaIndicadores(titulo, ids, d, nota) {
    const lista = d.mercado.filter(m => !ids || ids.indexOf(m.id) >= 0);
    const html = lista.map(m => {
      const ok = String(m.estado || '').indexOf('OK') === 0 && m.valor !== null && m.valor !== undefined;
      if (!ok) {
        return `<div class="ind no-disp"><div class="nombre">${esc(m.indicador)}</div>
          <div class="valor">Dato no disponible</div><div class="meta">${esc(String(m.estado || '').replace('NO DISPONIBLE: ', ''))}</div></div>`;
      }
      const var_ = m.variacion;
      const txtVar = var_ === null || var_ === undefined ? '' :
        (m.tipo_variacion === 'pct' ? fmtPct(var_, 2, true) : (var_ > 0 ? '+' : '') + fmtNum(var_, 2) + ' p.p.');
      const valor = m.unidad === '%' ? fmtNum(m.valor, m.decimales) + ' %' : fmtNum(m.valor, m.decimales) + (m.unidad === 'índice' ? '' : ' ' + esc(m.unidad));
      const antiguo = String(m.estado).indexOf('último dato válido') > 0 ? ' · ⚠ actualización fallida' : '';
      return `<div class="ind"><div class="nombre">${esc(m.indicador)}</div>
        <div class="valor num">${valor} <small class="${clase(var_)}" style="font-size:.75rem">${txtVar}</small></div>
        <div class="meta">Dato del ${fmtFecha(m.fecha_dato)} · <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.fuente)}</a><br>Consultado ${fmtFechaHora(m.actualizado)}${antiguo}</div></div>`;
    }).join('');
    return `<article class="tarjeta ancho"><h2>${esc(titulo)}</h2>${nota ? `<p class="suave">${esc(nota)}</p>` : ''}
      <div class="indicadores">${html}</div>
      <p class="suave" style="margin-top:10px">La variación compara con el dato anterior publicado por la fuente (día, mes o sesión, según el indicador).</p></article>`;
  }

  function tarjetaDonde(d, conTitulo) {
    const p = d.propuesta;
    const importe = p ? p.importe : (Number(d.config.aportacion_mensual) || 0);
    return `<article class="tarjeta donde ancho" id="tarjeta-donde">
      ${conTitulo ? '' : ''}
      <form class="pregunta" id="form-donde">
        <label for="importe-donde">¿Dónde invierto mis próximos</label>
        <input id="importe-donde" type="number" inputmode="decimal" min="1" step="1" value="${esc(Math.round(importe))}">
        <span>€?</span>
        <button class="btn primario pequeno" type="submit">Calcular</button>
      </form>
      <div id="resultado-donde">${htmlReparto(p)}</div>
    </article>`;
  }

  function htmlReparto(p) {
    if (!p || !p.reparto) return '';
    if (!p.reparto.length) return `<p class="suave">${esc(p.explicacion || '')}</p>`;
    return `<p class="suave">${esc(p.explicacion)}</p><ul class="reparto">${p.reparto.map(r => `
      <li><span class="punto" style="background:${esc(r.color)}"></span>
      <div>${esc(r.nombre)}<small>${r.productos && r.productos.length ? 'En tu cartera: ' + r.productos.map(esc).join(', ') : 'Aún no tienes ningún producto en esta categoría'}</small></div>
      <strong class="num">${fmtEur(r.importe, 0)}</strong></li>`).join('')}</ul>
      <p class="suave" style="margin-top:8px">Reparto para acercarte a tus pesos objetivo, sin vender nada. Por tu elección, la aportación mensual se reparte siempre así (inversión disciplinada); el semáforo es solo informativo.</p>`;
  }

  function enlazarDonde() {
    const f = $('#form-donde');
    if (!f) return;
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const imp = parseFloat($('#importe-donde').value);
      if (!(imp > 0)) { toast('Indica un importe mayor que cero.'); return; }
      const cont = $('#resultado-donde');
      cont.innerHTML = '<div class="esqueleto" style="height:80px"></div>';
      try {
        const p = await api('propuestaAportacion', { importe: imp });
        cont.innerHTML = htmlReparto(p);
      } catch (e) {
        cont.innerHTML = `<p class="error">${esc(e.message)}</p>`;
      }
    });
  }

  function barrasCategorias(cats, umbral) {
    return `<div class="barras">${cats.map(c => `
      <div class="barra-fila">
        <div class="cab"><span>${esc(c.nombre)}</span>
          <span class="num">${fmtPct(c.actual, 1)} <span class="suave">/ ${fmtPct(c.objetivo, 0)}</span>
          ${c.fuera_de_rango ? `<span class="chip alerta">${c.desviacion > 0 ? '+' : ''}${fmtNum(c.desviacion, 1)} p.p.</span>` : ''}</span></div>
        <div class="barra" role="img" aria-label="${esc(c.nombre)}: ${fmtNum(c.actual, 1)} % frente a objetivo ${fmtNum(c.objetivo, 0)} %">
          <div class="relleno" style="width:${Math.min(100, c.actual)}%;background:${esc(c.color)}"></div>
          <span class="marca-obj" style="left:calc(${Math.min(100, c.objetivo)}% - 1px)"></span>
        </div>
      </div>`).join('')}</div>
      <p class="suave" style="margin-top:10px">La línea vertical marca el peso objetivo. Se avisa cuando la desviación supera ±${esc(umbral)} puntos.</p>`;
  }

  /* ---------------- Gráficos ---------------- */
  function colorVar(nombre) { return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim(); }

  function graficoDona(id, cats) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!window.Chart) { el.parentNode.innerHTML = '<p class="vacio">El gráfico no ha podido cargarse (sin conexión). Vuelve a intentarlo con conexión.</p>'; return; }
    const datos = cats.filter(c => c.valor > 0);
    estado.graficos[id] = new Chart(el, {
      type: 'doughnut',
      data: { labels: datos.map(c => c.nombre), datasets: [{ data: datos.map(c => c.valor), backgroundColor: datos.map(c => c.color), borderColor: colorVar('--superficie'), borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '64%',
        plugins: {
          legend: { position: 'bottom', labels: { color: colorVar('--texto-2'), boxWidth: 10, padding: 10, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => ' ' + ctx.label + ': ' + fmtEur(ctx.raw, 0) } }
        }
      }
    });
  }

  function graficoEvolucion(id, historico) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!window.Chart) { el.parentNode.innerHTML = '<p class="vacio">El gráfico no ha podido cargarse (sin conexión). Vuelve a intentarlo con conexión.</p>'; return; }
    // Una sola foto por día (la última) y decimales si los importes son pequeños
    const porDia = {};
    historico.forEach(h => { porDia[String(h.fecha).slice(0, 10)] = h; });
    historico = Object.keys(porDia).sort().map(k => Object.assign({}, porDia[k], { fecha: k }));
    const maximo = historico.reduce((m, h) => Math.max(m, h.patrimonio || 0, h.invertido_neto || 0), 0);
    const dec = maximo < 100 ? 2 : 0;
    estado.graficos[id] = new Chart(el, {
      type: 'line',
      data: {
        labels: historico.map(h => fmtFecha(h.fecha)),
        datasets: [
          { label: 'Patrimonio', data: historico.map(h => h.patrimonio), borderColor: colorVar('--acento'), backgroundColor: 'transparent', tension: .25, pointRadius: historico.length > 40 ? 0 : 2, borderWidth: 2.5 },
          { label: 'Dinero aportado (neto)', data: historico.map(h => h.invertido_neto), borderColor: colorVar('--texto-3'), borderDash: [5, 4], backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.5 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { color: colorVar('--texto-3'), maxTicksLimit: 6, font: { size: 11 } }, grid: { display: false } },
          y: { ticks: { color: colorVar('--texto-3'), font: { size: 11 }, callback: v => fmtEur(v, dec) }, grid: { color: colorVar('--borde') } }
        },
        plugins: {
          legend: { labels: { color: colorVar('--texto-2'), boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => ' ' + ctx.dataset.label + ': ' + fmtEur(ctx.raw, dec) } }
        }
      }
    });
  }

  /* ================= Motor de análisis (Fase 4) ================= */
  const NOMBRE_BLOQUE = { tecnico: 'Técnico', macro: 'Macroeconómico', fundamental: 'Fundamental' };
  const ICONO_SEM = { verde: '🟢', amarillo: '🟡', rojo: '🔴' };

  function senal(d, id) {
    const a = d.analisis && d.analisis.activos ? d.analisis.activos.find(x => x.id === id) : null;
    return a && !a.pendiente ? a : null;
  }

  function barraPuntos(p, color) {
    return `<div class="medidor" role="img" aria-label="Puntuación ${p} de 100"><div class="medidor-relleno ${esc(color || '')}" style="width:${Math.max(2, Math.min(100, p))}%"></div>
      <span class="medidor-marca" style="left:40%"></span><span class="medidor-marca" style="left:65%"></span></div>`;
  }

  function filaSemaforo(a) {
    return `<button class="fila-sem" data-senal="${esc(a.id)}">
      <span class="luz ${esc(a.color)}" aria-hidden="true"></span>
      <span class="fs-nombre">${esc(a.nombre)}<small>${esc(a.estado)} · confianza ${esc(a.confianza.toLowerCase())}</small></span>
      <strong class="fs-punt num">${esc(a.puntuacion)}</strong>
    </button>`;
  }

  function tarjetaSemaforo(d) {
    const an = d.analisis;
    const lista = an ? an.activos.filter(a => !a.pendiente) : [];
    if (!lista.length) {
      return `<article class="tarjeta ancho"><h2>Semáforo de oportunidades</h2><p class="vacio">Todavía no hay ningún análisis. Se calcula cada día laborable a las 22:00, o pulsando «Actualizar análisis ahora» en Ajustes.</p></article>`;
    }
    return `<article class="tarjeta ancho">
      <h2>Semáforo de oportunidades <button class="btn pequeno" data-metodologia="1">¿Cómo se calcula?</button></h2>
      <div class="semaforo">${lista.map(filaSemaforo).join('')}</div>
      <p class="suave" style="margin-top:8px">Puntuación de 0 a 100 sobre lo favorable que es el entorno para invertir. <strong>No es la probabilidad de ganar dinero.</strong> Pulsa un activo para ver el porqué. Análisis del ${fmtFechaHora(an.ultima_ejecucion)}.</p>
    </article>`;
  }

  function tarjetaOportunidades(d) {
    const an = d.analisis;
    if (!an) return '';
    const ops = an.activos.filter(a => !a.pendiente && /COMPRA/.test(a.estado));
    return `<article class="tarjeta ancho"><h2>Oportunidades detectadas</h2>
      ${ops.length ? `<div class="semaforo">${ops.map(filaSemaforo).join('')}</div>` :
        '<p>Hoy <strong>no hay ninguna oportunidad suficientemente justificada</strong>. Lo adecuado es seguir con tu aportación mensual habitual repartida según tus pesos objetivo.</p>'}
</article>`;
  }

  const CLASE_NIVEL = { 'Informativa': 'info', 'Oportunidad potencial': 'oport', 'Oportunidad relevante': 'oport-rel', 'Riesgo elevado': 'riesgo' };
  function tarjetaAlertas(d) {
    const al = d.alertas;
    if (!al) return '';
    const lista = al.recientes || [];
    return `<article class="tarjeta ancho"><h2>Alertas recientes</h2>
      ${!al.telegram ? '<div class="aviso info"><span>Telegram aún no está conectado: por ahora las alertas llegan solo por correo. Sigue los pasos de la Fase 6 para activarlo.</span></div>' : ''}
      ${lista.length ? `<div class="alertas">${lista.map(a => `<details class="alerta ${CLASE_NIVEL[a.nivel] || 'info'}">
          <summary><span class="nivel">${esc(a.nivel)}</span><span class="tit">${esc(a.titulo)}</span><span class="suave">${fmtFechaHora(a.fecha)}</span></summary>
          <p>${esc(a.que)}</p>${a.implicaciones ? `<p><strong>Qué implica:</strong> ${esc(a.implicaciones)}</p>` : ''}
          <p class="suave">Enviada: ${esc(a.enviada || 'pendiente')}</p></details>`).join('')}</div>`
        : '<p class="vacio">No hay alertas. Es buena señal: solo se avisa cuando pasa algo relevante (revisión diaria a las 22:30).</p>'}
    </article>`;
  }

  function htmlSenal(a, completo) {
    if (!a) return '';
    const bloques = Object.keys(a.bloques).map(k => {
      const b = a.bloques[k];
      return `<div class="bloque-fila"><div class="cab"><span>${esc(NOMBRE_BLOQUE[k])} <span class="suave">(peso ${esc(b.peso_aplicado)} %)</span></span><strong class="num">${esc(b.puntos)}</strong></div>${barraPuntos(b.puntos)}</div>`;
    }).join('');
    const ind = Object.keys(a.bloques).map(k => a.bloques[k].indicadores.map(i =>
      `<tr><td>${esc(i.nombre)}<br><span class="suave">${esc(NOMBRE_BLOQUE[k])}</span></td><td class="der num">${esc(i.valor)}</td><td class="der num"><span class="chip ${i.puntos >= 60 ? 'bien' : (i.puntos <= 40 ? 'alerta' : 'ok')}">${esc(i.puntos)}</span></td></tr>`
      + `<tr class="lectura"><td colspan="3">${esc(i.lectura)}</td></tr>`).join('')).join('');
    const lista = (t, arr, cls) => arr && arr.length ? `<h3>${t}</h3><ul class="factores ${cls}">${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
    const precio = a.precio ? `<p class="suave" style="margin:0">Precio: <strong class="num">${a.precio.moneda === '€' ? fmtEur(a.precio.valor, 2) : fmtNum(a.precio.valor, 0) + ' ' + esc(a.precio.moneda)}</strong> (cierre del ${fmtFecha(a.precio.fecha)})</p>` : '';
    const tend = a.tendencias ? `<div class="indicadores compacto" style="margin:10px 0">
        <div class="ind"><div class="nombre">Corto plazo</div><div class="valor">${esc(a.tendencias.corto)}</div><div class="meta">vs. media 20</div></div>
        <div class="ind"><div class="nombre">Medio plazo</div><div class="valor">${esc(a.tendencias.medio)}</div><div class="meta">vs. media 50</div></div>
        <div class="ind"><div class="nombre">Largo plazo</div><div class="valor">${esc(a.tendencias.largo)}</div><div class="meta">vs. media 200</div></div>
        <div class="ind"><div class="nombre">Soporte / resistencia</div><div class="valor num" style="font-size:1rem">${fmtNum(a.soporte, 2)} / ${fmtNum(a.resistencia, 2)}</div><div class="meta">mín. y máx. de 3 meses</div></div>
      </div>` : '';
    const op = a.oportunidad ? `<div class="oportunidad">
        <h3>¿Por qué ahora?</h3><ul class="factores a-favor">${a.oportunidad.porque.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <h3>¿Cuánto?</h3><p>${esc(a.oportunidad.cantidad)}</p>
        <h3>¿De una vez o poco a poco?</h3><p>${esc(a.oportunidad.forma)}</p>
        <h3>¿Qué invalidaría esta señal?</h3><ul class="factores">${a.oportunidad.invalidacion.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <h3>¿Y si espero?</h3><p>${esc(a.oportunidad.riesgo_esperar)}</p></div>` : '';
    return `<div class="senal">
      <div class="senal-cab"><span class="luz grande ${esc(a.color)}" aria-hidden="true"></span>
        <div><div class="senal-estado">${esc(a.estado)}</div><div class="suave">Confianza ${esc(a.confianza.toLowerCase())}: ${esc(a.motivo_confianza)}</div></div>
        <div class="senal-punt num">${esc(a.puntuacion)}<small>/100</small></div></div>
      ${barraPuntos(a.puntuacion, a.color)}
      ${precio}
      ${a.regla ? `<div class="aviso info" style="margin-top:10px"><span>${esc(a.regla)}</span></div>` : ''}
      ${a.notas.map(n => `<div class="aviso" style="margin-top:8px"><span>${esc(n)}</span></div>`).join('')}
      ${op}
      ${lista('Factores a favor', a.positivos, 'a-favor')}
      ${lista('Factores en contra', a.negativos, 'en-contra')}
      ${completo ? tend : ''}
      <h3>Bloques de análisis</h3><div class="barras">${bloques}</div>
      ${completo ? `<h3>Indicadores</h3><div class="tabla-scroll"><table class="tabla-ind"><thead><tr><th>Indicador</th><th class="der">Valor</th><th class="der">Nota</th></tr></thead><tbody>${ind}</tbody></table></div>` : ''}
      ${lista('Riesgos a vigilar', a.riesgos, '')}
      <h3>Horizonte recomendado</h3><p>${esc(a.horizonte)}</p>
      <p class="suave">Evaluado el ${fmtFechaHora(a.fecha_eval)}. Fuentes: ${a.fuentes.map(esc).join(' · ')}. Información analítica, no asesoramiento financiero regulado.</p>
      ${completo ? '' : `<button class="btn pequeno" data-senal="${esc(a.id)}">Ver análisis completo</button>`}
    </div>`;
  }

  function modalSenal(id) {
    const a = senal(estado.datos, id);
    if (!a) return;
    abrirModal(a.nombre, htmlSenal(a, true) + historialSenal(id));
  }

  function historialSenal(id) {
    const h = estado.datos.analisis && estado.datos.analisis.historial ? estado.datos.analisis.historial[id] : null;
    if (!h || h.length < 2) return '';
    return `<h3>Últimas evaluaciones</h3><div class="tabla-scroll"><table><tbody>${h.slice().reverse().slice(0, 10).map(x =>
      `<tr><td>${fmtFecha(x.fecha)}</td><td>${esc(x.estado)}</td><td class="der num">${esc(x.puntuacion)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function modalMetodologia() {
    const m = estado.datos.metodologia;
    if (!m) return;
    abrirModal('¿Cómo se calcula el semáforo?', `
      <p>Cada indicador (tendencia, RSI, tipos de interés, compras de los bancos centrales…) se convierte en una nota de 0 a 100 con reglas fijas. Las notas se agrupan en bloques y la puntuación final es la media ponderada de los bloques:</p>
      <div class="tabla-scroll"><table><thead><tr><th>Activo</th><th class="der">Técnico</th><th class="der">Macro</th><th class="der">Fundamental</th></tr></thead><tbody>
      ${m.pesos.map(p => `<tr><td>${esc(p.nombre)}</td><td class="der">${p.pesos.tecnico ? p.pesos.tecnico + ' %' : '—'}</td><td class="der">${p.pesos.macro ? p.pesos.macro + ' %' : '—'}</td><td class="der">${p.pesos.fundamental ? p.pesos.fundamental + ' %' : '—'}</td></tr>`).join('')}
      </tbody></table></div>
      <h3>Estados</h3><ul class="factores">${m.estados.map(e => `<li><strong>${esc(e.estado)}</strong>: ${esc(e.regla)}</li>`).join('')}</ul>
      <h3>Reglas de seguridad</h3>
      <ul class="factores"><li>Nunca se indica comprar solo porque el precio haya bajado: los factores de fondo deben acompañar.</li>
      <li>Nunca se indica vender solo porque el precio haya subido.</li>
      <li>Si faltan datos, ese bloque no se usa y la confianza baja. Nunca se inventan datos.</li>
      <li>La puntuación mide lo favorable del entorno, no la probabilidad de ganar dinero.</li>
      <li>El semáforo es informativo: tu aportación mensual se reparte siempre según tus pesos objetivo.</li></ul>
      <p class="suave">Volumen de negociación: no se utiliza, porque no existe para el oro ni para las divisas y en los ETF europeos se reparte entre varias bolsas.</p>`);
  }

  /* ================= Informes (Fase 7) ================= */
  function htmlInforme(inf, paraArchivo) {
    if (!inf) return '';
    estado.informes = estado.informes || {};
    estado.informes[inf.id] = inf;
    return `<div class="informe">
      <div class="decision"><div class="etq">Mi decisión de inversión de hoy</div>
        <div class="tit">${esc(inf.decision.titulo)}</div>
        ${inf.decision.parrafos.map(p => `<p>${esc(p)}</p>`).join('')}</div>
      ${inf.secciones.map(sec => `<h3>${sec.ia ? '✨ ' : ''}${esc(sec.titulo)}</h3>${sec.parrafos.filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('')}`).join('')}
      <p class="suave">Generado el ${fmtFechaHora(inf.fecha)}. Fuentes: ${inf.fuentes.map(esc).join(' · ')}. ${esc(inf.aviso)}</p>
      ${paraArchivo ? '' : `<button class="btn pequeno" data-descargar-informe="${esc(inf.id)}">Descargar informe</button>`}
    </div>`;
  }

  function tarjetaDecision(d) {
    const inf = d.informes && d.informes.ultimo;
    if (!inf) return '';
    return `<article class="tarjeta ancho decision-tarjeta">
      <div class="etq">Mi decisión de inversión de hoy</div>
      <div class="tit">${esc(inf.decision.titulo)}</div>
      <p class="suave">${esc(inf.titulo)} · <button class="enlace" data-ir="informes">Leer el informe completo</button></p>
    </article>`;
  }

  function tarjetaInformes(d) {
    const inf = d.informes || { lista: [] };
    const otros = inf.lista.slice(1, 15);
    return `<article class="tarjeta ancho">
      <h2>Informes ${inf.ultimo ? '' : ''}<button class="btn pequeno" id="btn-generar-informe">Generar ahora</button></h2>
      ${inf.ultimo ? `<h3 style="margin-top:0">${esc(inf.ultimo.titulo)}</h3>${htmlInforme(inf.ultimo)}`
        : '<p class="vacio">Aún no hay informes. El primero llegará el próximo día laborable a las 8:30, o pulsa «Generar ahora».</p>'}
      ${otros.length ? `<h3>Informes anteriores</h3><div class="semaforo">${otros.map(x => `<button class="fila-sem" data-informe="${esc(x.id)}">
          <span class="luz ${x.tipo === 'diario' ? 'amarillo' : 'verde'}" aria-hidden="true"></span>
          <span class="fs-nombre">${esc(x.titulo)}<small>${esc(x.decision)}</small></span><span></span></button>`).join('')}</div>` : ''}
    </article>`;
  }

  /* ================= Asesor conversacional (Fase 8) ================= */
  const CLAVE_CHAT = 'cp_chat';
  const SUGERENCIAS = ['¿Es buen momento para comprar oro?', '¿Por qué está cayendo la bolsa?', '¿Qué está pasando con el dólar?',
    '¿Me conviene invertir mis 300 € mensuales ahora?', '¿Qué fondo indexado es más interesante?', '¿Qué ocurriría si la bolsa cae un 20 %?',
    '¿Debo aumentar mi posición en oro?', '¿Cómo afecta una subida de tipos a mis inversiones?'];

  function formatoIA(t) {
    const lineas = esc(t).split('\n');
    let html = '', enLista = false;
    lineas.forEach(l => {
      let x = l.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[(Hecho|Estimación|Escenario|Opinión analítica)\]/g, (m, e) => `<span class="etq-ia ${e === 'Hecho' ? 'hecho' : (e === 'Estimación' ? 'estim' : (e === 'Escenario' ? 'escen' : 'opin'))}">${e}</span>`);
      const li = /^\s*[-•*]\s+(.*)/.exec(x) || /^\s*\d+[.)]\s+(.*)/.exec(x);
      if (li) { if (!enLista) { html += '<ul>'; enLista = true; } html += `<li>${li[1]}</li>`; return; }
      if (enLista) { html += '</ul>'; enLista = false; }
      if (/^#{1,4}\s+/.test(x)) { html += `<h4>${x.replace(/^#{1,4}\s+/, '')}</h4>`; return; }
      if (x.trim()) html += `<p>${x}</p>`;
    });
    if (enLista) html += '</ul>';
    return html;
  }

  function leerChat() { const c = leerLS(CLAVE_CHAT); return Array.isArray(c) ? c : []; }

  function htmlMensajes(lista) {
    return lista.map(m => m.rol === 'usuario'
      ? `<div class="msg yo">${esc(m.texto)}</div>`
      : `<div class="msg ia">${formatoIA(m.texto)}<div class="pie">${esc(m.modelo || '')} · ${fmtFechaHora(m.fecha)}</div></div>`).join('');
  }

  function tarjetaChat(d) {
    const ia = d.ia || {};
    if (!ia.configurado) {
      return `<article class="tarjeta ancho"><h2>Asesor conversacional</h2><div class="aviso info"><span>Falta conectar la IA: añade la clave ANTHROPIC_API_KEY en Apps Script (Fase 8, paso 2).</span></div></article>`;
    }
    const lista = leerChat();
    return `<article class="tarjeta ancho chat-tarjeta">
      <h2>Pregunta a tu asesor ${lista.length ? '<button class="btn pequeno" id="btn-borrar-chat">Nueva conversación</button>' : ''}</h2>
      <div class="chat" id="chat-mensajes">${lista.length ? htmlMensajes(lista) : `<p class="suave">Pregunta lo que quieras sobre tus inversiones o los mercados. Responderá con los datos reales de la app, citando fuentes y separando <span class="etq-ia hecho">Hecho</span> <span class="etq-ia estim">Estimación</span> <span class="etq-ia escen">Escenario</span> <span class="etq-ia opin">Opinión analítica</span>.</p>`}</div>
      <div class="sugerencias">${SUGERENCIAS.map(q => `<button class="chip-btn" data-sugerencia="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form id="f-chat" class="chat-form">
        <textarea id="chat-texto" rows="2" maxlength="1200" placeholder="Escribe tu pregunta…" aria-label="Tu pregunta"></textarea>
        <button class="btn primario" type="submit" aria-label="Enviar">Enviar</button>
      </form>
      <p class="suave" id="chat-uso">${esc(ia.modelo)} · este mes: ${esc(ia.llamadas)} consultas, ≈ ${fmtEur(ia.coste_eur, 2)}. Orientación analítica, no asesoramiento financiero regulado.</p>
    </article>`;
  }

  function enlazarChat(d) {
    const f = document.getElementById('f-chat');
    if (!f) return;
    const cont = document.getElementById('chat-mensajes');
    const txt = document.getElementById('chat-texto');
    const enviar = async pregunta => {
      pregunta = String(pregunta || '').trim();
      if (!pregunta) return;
      const lista = leerChat();
      const historial = lista.slice(-6).map(m => ({ rol: m.rol, texto: m.texto }));
      lista.push({ rol: 'usuario', texto: pregunta, fecha: new Date().toISOString() });
      guardarLS(CLAVE_CHAT, lista.slice(-20));
      cont.innerHTML = htmlMensajes(lista) + '<div class="msg ia pensando">Analizando tus datos…</div>';
      cont.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      txt.value = ''; f.querySelector('button').disabled = true;
      try {
        const r = await api('preguntarIA', { pregunta: pregunta, historial: historial });
        lista.push({ rol: 'asistente', texto: r.respuesta, modelo: r.modelo, fecha: r.fecha });
        guardarLS(CLAVE_CHAT, lista.slice(-20));
        if (estado.datos) estado.datos.ia = r.uso;
        const uso = document.getElementById('chat-uso');
        if (uso && r.uso) uso.textContent = r.uso.modelo + ' · este mes: ' + r.uso.llamadas + ' consultas, ≈ ' + fmtEur(r.uso.coste_eur, 2) + '. Orientación analítica, no asesoramiento financiero regulado.';
        cont.innerHTML = htmlMensajes(lista);
      } catch (e) {
        lista.pop(); guardarLS(CLAVE_CHAT, lista);
        cont.innerHTML = htmlMensajes(lista) + `<div class="msg ia error-msg">${esc(e.message)}</div>`;
        txt.value = pregunta;
      } finally {
        f.querySelector('button').disabled = false;
        const ult = cont.querySelector('.msg.ia:last-child');
        if (ult) ult.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    };
    f.addEventListener('submit', ev => { ev.preventDefault(); enviar(txt.value); });
    txt.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey && window.matchMedia('(min-width: 720px)').matches) { ev.preventDefault(); enviar(txt.value); } });
    document.querySelectorAll('[data-sugerencia]').forEach(b => b.addEventListener('click', () => enviar(b.dataset.sugerencia)));
    const borrar = document.getElementById('btn-borrar-chat');
    if (borrar) borrar.addEventListener('click', () => { try { localStorage.removeItem(CLAVE_CHAT); } catch (e) {} pintar(); });
  }

  /* ================= PANTALLA 1 · MI PATRIMONIO ================= */
  function vistaPatrimonio(el, d) {
    const c = d.cartera;
    const vacia = c.numero_operaciones === 0;
    const avisosPerfil = (d.perfil || []).map(a => `<div class="aviso">${esc(a)}</div>`).join('');
    const avisosPrecio = [];
    if (c.avisos.sin_precio.length) avisosPrecio.push(`<div class="aviso">Sin precio actual: ${c.avisos.sin_precio.map(esc).join(', ')}. No se incluyen en el total hasta que indiques su precio.</div>`);
    if (c.avisos.precios_antiguos.length) avisosPrecio.push(`<div class="aviso info">Precios con más de 7 días: ${c.avisos.precios_antiguos.map(p => esc(p.nombre) + ' (' + p.dias + ' d)').join(', ')}. Actualízalos en «Mi cartera». La actualización automática llegará en la Fase 3.</div>`);

    el.innerHTML = `
      <article class="tarjeta heroe ancho">
        <p class="etiqueta">Patrimonio total</p>
        <p class="cifra num">${fmtEur(c.total)}</p>
        ${vacia ? '<p class="suave">Todavía no has registrado inversiones. Empieza en «Mi cartera».</p>' : `
        <div class="fila-datos">
          <div class="dato"><small>Ganancia total</small><strong class="num ${clase(c.ganancia_total)}">${fmtEur(c.ganancia_total)}</strong></div>
          <div class="dato"><small>Rentabilidad acumulada</small><strong class="num ${clase(c.rentabilidad_acumulada)}">${fmtPct(c.rentabilidad_acumulada, 2, true)}</strong></div>
          <div class="dato"><small>Rentabilidad anualizada</small><strong class="num ${clase(c.rentabilidad_anualizada)}">${c.rentabilidad_anualizada === null ? 'Aún no' : fmtPct(c.rentabilidad_anualizada, 2, true)}</strong></div>
          <div class="dato"><small>Dinero aportado (neto)</small><strong class="num">${fmtEur(c.invertido_neto)}</strong></div>
        </div>
        ${c.rentabilidad_anualizada === null && c.aviso_anualizada ? `<p class="suave" style="margin-top:8px;font-size:.78rem">Rentabilidad anualizada: ${esc(c.aviso_anualizada)}</p>` : ''}`}
      </article>

      ${tarjetaDecision(d)}

      ${avisosPerfil || avisosPrecio.length ? `<article class="tarjeta ancho"><h2>Para tener en cuenta</h2>${avisosPerfil}${avisosPrecio.join('')}</article>` : ''}

      ${tarjetaDonde(d)}

      ${tarjetaSemaforo(d)}

      <article class="tarjeta">
        <h2>Evolución del patrimonio</h2>
        ${d.historico.length >= 2 ? '<div class="grafico"><canvas id="g-evolucion" aria-label="Evolución del patrimonio"></canvas></div>' :
          '<p class="vacio">La app guarda una foto de tu patrimonio cada noche. El gráfico aparecerá cuando haya al menos dos días registrados.</p>'}
      </article>

      <article class="tarjeta">
        <h2>Distribución de la cartera</h2>
        ${c.total > 0 ? '<div class="grafico dona"><canvas id="g-dona" aria-label="Distribución por categoría"></canvas></div>' : '<p class="vacio">Sin posiciones valoradas.</p>'}
      </article>

      <article class="tarjeta ancho">
        <h2>Tu cartera frente al objetivo</h2>
        ${c.total > 0 ? barrasCategorias(c.categorias, d.catalogos.umbral) : '<p class="vacio">Cuando registres tus inversiones verás aquí cuánto te separa de tu cartera objetivo.</p>'}
      </article>

      ${tarjetaMercadosHoy(d)}

      ${tarjetaIndicadores('Situación general de los mercados', ['EURUSD', 'BCE_DEPO', 'FED_TIPO', 'IPCA_EZ', 'IPCA_ES', 'BONO10_EZ', 'BONO10_US'], d)}

      ${tarjetaOportunidades(d)}
      ${tarjetaAlertas(d)}
    `;
    if (d.historico.length >= 2) graficoEvolucion('g-evolucion', d.historico);
    if (c.total > 0) graficoDona('g-dona', c.categorias);
    enlazarDonde();
  }

  /* ================= Bloques de precios (Fase 3) ================= */
  const fmtVar = (n, dec) => {
    if (n === null || n === undefined || isNaN(n)) return '<span class="suave">—</span>';
    const dd = dec === undefined ? 2 : dec;
    if (Math.abs(n) < 0.5 * Math.pow(10, -dd)) n = 0;
    return `<span class="${clase(n)}">${fmtPct(n, dd, true)}</span>`;
  };

  function avisoPrecios(pr) {
    if (!pr) return '';
    if (!pr.configurado) return `<div class="aviso">Los precios automáticos no están activados: falta la clave de EODHD en el servidor (Fase 3, paso 2).</div>`;
    return '';
  }

  function piePrecios(pr) {
    return `<p class="suave" style="margin-top:8px">Fuente: <a href="${esc(pr.fuente_url)}" target="_blank" rel="noopener">${esc(pr.proveedor)}</a> · última actualización ${fmtFechaHora(pr.ultima_ejecucion)} · llamadas hoy ${esc(pr.llamadas_hoy)}/${esc(pr.limite_diario)}. Son precios de cierre del día, no en tiempo real.</p>`;
  }

  function tarjetaMercadosHoy(d) {
    const pr = d.precios;
    if (!pr) return '';
    const sel = ['GSPC.INDX', 'STOXX50E.INDX', 'EUNL.XETRA', 'IS3N.XETRA'];
    const filas = [];
    if (pr.oro && pr.oro.eur) {
      filas.push(`<div class="ind"><div class="nombre">Oro (onza, en euros)</div><div class="valor num">${fmtEur(pr.oro.eur.cierre, 0)} <small style="font-size:.75rem">${fmtVar(pr.oro.eur.var_1d)}</small></div><div class="meta">Cierre del ${fmtFecha(pr.oro.eur.fecha)} · 1 año: ${fmtVar(pr.oro.eur.var_1a, 1)}</div></div>`);
    }
    pr.referencias.filter(r => sel.indexOf(r.simbolo) >= 0).forEach(r => {
      const m = r.metricas;
      filas.push(m ? `<div class="ind"><div class="nombre">${esc(r.nombre)}</div><div class="valor num">${fmtNum(m.cierre, 2)} <small style="font-size:.75rem">${fmtVar(m.var_1d)}</small></div><div class="meta">Cierre del ${fmtFecha(m.fecha)} · 1 año: ${fmtVar(m.var_1a, 1)}</div></div>`
        : `<div class="ind no-disp"><div class="nombre">${esc(r.nombre)}</div><div class="valor">Dato no disponible</div><div class="meta">${esc(String(r.estado).replace('NO DISPONIBLE: ', ''))}</div></div>`);
    });
    if (pr.cripto && pr.cripto.metricas) {
      const m = pr.cripto.metricas;
      filas.push(`<div class="ind"><div class="nombre">Bitcoin (en euros)</div><div class="valor num">${fmtEur(m.cierre, 0)} <small style="font-size:.75rem">${fmtVar(m.var_1d)}</small></div><div class="meta">Cierre del ${fmtFecha(m.fecha)} · 1 año: ${fmtVar(m.var_1a, 1)}</div></div>`);
    }
    return `<article class="tarjeta ancho"><h2>Mercados hoy</h2>${avisoPrecios(pr)}<div class="indicadores">${filas.join('')}</div>${pr.configurado ? piePrecios(pr) : ''}</article>`;
  }

  function graficoLinea(id, serie, etiqueta, fmt) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!window.Chart) { el.parentNode.innerHTML = '<p class="vacio">El gráfico no ha podido cargarse (sin conexión).</p>'; return; }
    estado.graficos[id] = new Chart(el, {
      type: 'line',
      data: { labels: serie.map(p => fmtFecha(p[0])), datasets: [{ label: etiqueta, data: serie.map(p => p[1]), borderColor: colorVar('--acento'), backgroundColor: 'transparent', pointRadius: 0, borderWidth: 2, tension: .15 }] },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { color: colorVar('--texto-3'), maxTicksLimit: 5, font: { size: 11 } }, grid: { display: false } },
          y: { ticks: { color: colorVar('--texto-3'), font: { size: 11 }, callback: v => fmt(v) }, grid: { color: colorVar('--borde') } }
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } }
      }
    });
  }

  function tablaVariaciones(filas) {
    return `<div class="tabla-scroll"><table><thead><tr><th></th><th class="der">Cierre</th><th class="der">1 día</th><th class="der">1 sem.</th><th class="der">1 mes</th><th class="der">Este año</th><th class="der">1 año</th><th class="der">Desde máx.*</th></tr></thead><tbody>
      ${filas.map(f => f.m ? `<tr><td>${esc(f.nombre)}</td><td class="der num">${f.fmt(f.m.cierre)}</td><td class="der num">${fmtVar(f.m.var_1d)}</td><td class="der num">${fmtVar(f.m.var_1s)}</td><td class="der num">${fmtVar(f.m.var_1m)}</td><td class="der num">${fmtVar(f.m.var_anio)}</td><td class="der num">${fmtVar(f.m.var_1a)}</td><td class="der num">${fmtVar(f.m.desde_maximo, 1)}</td></tr>`
        : `<tr><td>${esc(f.nombre)}</td><td colspan="7" class="suave">${esc(String(f.estado || 'Dato no disponible').replace('NO DISPONIBLE: ', 'No disponible: '))}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  /* ================= PANTALLA 2 · ORO ================= */
  function vistaOro(el, d) {
    const pos = d.cartera.categorias.find(c => c.id === 'ORO');
    const pr = d.precios || {};
    const oro = pr.oro;
    const w = d.wgc;
    const monedaOro = estado.monedaOro || 'eur';
    let precioHtml;
    if (oro && oro.usd && oro.eur) {
      const m = monedaOro === 'eur' ? oro.eur : oro.usd;
      const fmt = monedaOro === 'eur' ? (v => fmtEur(v, 0)) : (v => fmtNum(v, 0) + ' $');
      precioHtml = `<article class="tarjeta ancho">
        <h2>Precio del oro <span class="botonera"><button class="btn pequeno ${monedaOro === 'eur' ? 'primario' : ''}" data-moneda="eur">€</button><button class="btn pequeno ${monedaOro === 'usd' ? 'primario' : ''}" data-moneda="usd">$</button></span></h2>
        <p class="num" style="font-size:2rem;font-weight:750;margin:0">${fmt(m.cierre)} <small style="font-size:1rem">por onza</small></p>
        <p class="suave">Cierre del ${fmtFecha(m.fecha)} · ${monedaOro === 'eur' ? 'en euros (calculado con el cambio euro/dólar del mismo día)' : 'en dólares'} · ${fmtEur(oro.eur.cierre / 31.1035, 2)} por gramo</p>
        <div class="indicadores compacto" style="margin:10px 0">
          <div class="ind"><div class="nombre">1 día</div><div class="valor num">${fmtVar(m.var_1d)}</div></div>
          <div class="ind"><div class="nombre">1 semana</div><div class="valor num">${fmtVar(m.var_1s)}</div></div>
          <div class="ind"><div class="nombre">1 mes</div><div class="valor num">${fmtVar(m.var_1m)}</div></div>
          <div class="ind"><div class="nombre">1 año</div><div class="valor num">${fmtVar(m.var_1a, 1)}</div></div>
          <div class="ind"><div class="nombre">Desde el máximo*</div><div class="valor num">${fmtVar(m.desde_maximo, 1)}</div><div class="meta">Máx. ${fmt(m.maximo)} el ${fmtFecha(m.fecha_maximo)}</div></div>
        </div>
        <div class="grafico"><canvas id="g-oro" aria-label="Evolución del precio del oro"></canvas></div>
        <p class="suave">* Máximo dentro del historial disponible (desde ${fmtFecha(m.historial_desde)}). Con el plan gratuito de datos es 1 año; con el plan Historian, más de 30.</p>
        ${piePrecios(pr)}
      </article>`;
    } else {
      precioHtml = `<article class="tarjeta ancho"><h2>Precio del oro</h2>${avisoPrecios(pr)}<p class="vacio">Precio no disponible todavía. Se descargará en la próxima actualización de precios (08:00 y 21:00) o pulsando «Actualizar precios ahora» en Ajustes.</p></article>`;
    }

    const u = w && w.filas.length ? w.filas[w.filas.length - 1] : null;
    const wgcHtml = `<article class="tarjeta ancho">
      <h2>Demanda mundial, bancos centrales y ETF <span class="fase" style="background:var(--superficie-2);color:var(--texto-3)">trimestral</span></h2>
      ${w && w.pendiente ? `<div class="aviso"><span>Ya está publicado el informe del World Gold Council de <strong>${esc(w.esperado)}</strong> y aún no lo has cargado. ${u ? 'Último cargado: ' + esc(u.trimestre) + '.' : ''}</span></div>` : ''}
      ${u ? `<div class="indicadores" style="margin-top:10px">
        <div class="ind"><div class="nombre">Demanda total</div><div class="valor num">${fmtNum(u.demanda_total_t, 0)} t</div></div>
        <div class="ind"><div class="nombre">Compras netas de bancos centrales</div><div class="valor num">${fmtNum(u.bancos_centrales_t, 0)} t</div></div>
        <div class="ind"><div class="nombre">Flujos de ETF de oro</div><div class="valor num ${clase(u.etf_flujos_t)}">${u.etf_flujos_t > 0 ? '+' : ''}${fmtNum(u.etf_flujos_t, 0)} t</div></div>
        <div class="ind"><div class="nombre">Oferta total</div><div class="valor num">${fmtNum(u.oferta_total_t, 0)} t</div></div>
      </div>
      <p class="suave">Trimestre ${esc(u.trimestre)} · Fuente: <a href="${esc(w.url)}" target="_blank" rel="noopener">World Gold Council · Gold Demand Trends</a> · cargado ${fmtFechaHora(u.cargado)}</p>
      ${w.filas.length > 1 ? `<div class="tabla-scroll"><table><thead><tr><th>Trimestre</th><th class="der">Demanda</th><th class="der">Bancos centrales</th><th class="der">ETF</th><th class="der">Oferta</th></tr></thead><tbody>${w.filas.slice().reverse().map(f => `<tr><td>${esc(f.trimestre)}</td><td class="der num">${fmtNum(f.demanda_total_t, 0)}</td><td class="der num">${fmtNum(f.bancos_centrales_t, 0)}</td><td class="der num">${fmtNum(f.etf_flujos_t, 0)}</td><td class="der num">${fmtNum(f.oferta_total_t, 0)}</td></tr>`).join('')}</tbody></table></div>` : ''}`
      : '<p class="vacio">Aún no hay datos del World Gold Council. Cárgalos con el botón de abajo.</p>'}
      <div class="botonera" style="margin-top:10px"><button class="btn primario" data-accion="wgc">Cargar datos del trimestre</button>
      <a class="btn" href="${esc(w ? w.url : '#')}" target="_blank" rel="noopener">Abrir informe del WGC</a></div>
      <p class="suave">Te enviaremos un correo cada trimestre cuando toque actualizarlos.</p>
    </article>`;

    el.innerHTML = `
      ${precioHtml}
      <article class="tarjeta">
        <h2>Tu posición en oro</h2>
        <p class="num" style="font-size:1.6rem;font-weight:700;margin:0">${fmtEur(pos ? pos.valor : 0)}</p>
        <p class="suave">${pos ? fmtPct(pos.actual, 1) + ' de tu cartera · objetivo ' + fmtPct(pos.objetivo, 0) : ''}</p>
      </article>
      <article class="tarjeta ancho"><h2>Puntuación de oportunidad y recomendación <button class="btn pequeno" data-metodologia="1">¿Cómo se calcula?</button></h2>
        ${senal(d, 'ORO') ? htmlSenal(senal(d, 'ORO'), true) + historialSenal('ORO') : '<p class="vacio">Aún no hay análisis del oro. Se calcula cada día laborable a las 22:00.</p>'}</article>
      ${wgcHtml}
      ${tarjetaIndicadores('Factores que mueven el oro (datos oficiales)', ['TIPO_REAL_US', 'DOLAR_INDICE', 'EURUSD', 'INFL_ESPERADA_US', 'IPC_US', 'FED_TIPO'], d,
        'Normalmente, unos tipos de interés reales más bajos y un dólar más débil favorecen al oro. Son relaciones históricas, no reglas fijas.')}
    `;
    if (oro && oro.usd && oro.eur) {
      const eur = monedaOro === 'eur';
      graficoLinea('g-oro', eur ? oro.grafico_eur : oro.grafico_usd, 'Oro', eur ? (v => fmtEur(v, 0)) : (v => fmtNum(v, 0) + ' $'));
    }
    el.onclick = ev => {
      const m = ev.target.closest('[data-moneda]');
      if (m) { estado.monedaOro = m.dataset.moneda; pintar(); return; }
      if (ev.target.closest('[data-accion="wgc"]')) modalWGC(w);
    };
  }

  function modalWGC(w) {
    abrirModal('Datos del World Gold Council', `
      <form class="formulario" id="f-wgc">
        <p class="suave">Copia las cifras del resumen del informe trimestral <em>Gold Demand Trends</em>. Todas en <strong>toneladas</strong>.</p>
        <div class="doble">
          <label>Trimestre<input name="trimestre" required pattern="\\d{4}-[Tt][1-4]" value="${esc(w ? w.esperado : '')}" placeholder="2026-T3"></label>
          <label>Fecha de publicación<input name="fecha_publicacion" type="date" max="${hoyISO()}"></label>
        </div>
        <div class="doble">
          <label>Demanda total (t)<input name="demanda_total_t" type="number" step="any" inputmode="decimal" required></label>
          <label>Oferta total (t)<input name="oferta_total_t" type="number" step="any" inputmode="decimal" required></label>
        </div>
        <div class="doble">
          <label>Bancos centrales, compras netas (t)<input name="bancos_centrales_t" type="number" step="any" inputmode="decimal" required>
            <span class="ayuda">Si vendieron más de lo que compraron, en negativo.</span></label>
          <label>Flujos de ETF de oro (t)<input name="etf_flujos_t" type="number" step="any" inputmode="decimal" required>
            <span class="ayuda">Entradas en positivo, salidas en negativo.</span></label>
        </div>
        <label>Precio medio del trimestre (USD/onza) <span class="ayuda">(opcional)</span><input name="precio_medio_usd" type="number" step="any" inputmode="decimal"></label>
        <label>Notas <span class="ayuda">(opcional)</span><input name="notas" maxlength="300"></label>
        <p class="error" role="alert"></p>
        <div class="botonera"><button class="btn primario" type="submit">Guardar</button>
          <a class="btn" href="${esc(w ? w.url : '#')}" target="_blank" rel="noopener">Abrir informe</a></div>
      </form>`, cuerpo => {
      const f = $('#f-wgc', cuerpo);
      f.addEventListener('submit', ev => {
        ev.preventDefault();
        const d = Object.fromEntries(new FormData(f).entries());
        d.trimestre = String(d.trimestre).toUpperCase();
        enviarFormulario(f, 'guardarWGC', d, 'Datos del oro guardados');
      });
    });
  }

  /* ================= PANTALLA 3 · FONDOS ================= */
  const NOMBRE_CAT = { RV_DES: 'Renta variable desarrollados / global', RV_EME: 'Renta variable emergentes', ORO: 'Oro', BONOS: 'Bonos gubernamentales', REITS: 'REITs (inmobiliario)', CRIPTO: 'Criptomonedas', LIQUIDEZ: 'Liquidez' };

  const ELECCION = ['IE00B4L5Y983', 'IE00BKM4GZ66'];

  /** Tarjeta de bitcoin en la pantalla Fondos (v1.8.0). */
  function tarjetaCripto(d) {
    const pr = d.precios || {};
    const cr = pr.cripto;
    const a = senal(d, 'CRIPTO');
    const cat = d.cartera.categorias.find(c => c.id === 'CRIPTO');
    if (!cr && !a && !(cat && cat.objetivo)) return '';
    const m = cr ? cr.metricas : null;
    return `<article class="tarjeta ancho">
      <h2>Criptomonedas: bitcoin</h2>
      ${m ? `<div class="indicadores compacto">
        <div class="ind"><div class="nombre">Precio (en euros)</div><div class="valor num">${fmtEur(m.cierre, 0)}</div><div class="meta">Cierre del ${fmtFecha(m.fecha)}</div></div>
        <div class="ind"><div class="nombre">1 semana</div><div class="valor num">${fmtVar(m.var_1s, 1)}</div></div>
        <div class="ind"><div class="nombre">1 mes</div><div class="valor num">${fmtVar(m.var_1m, 1)}</div></div>
        <div class="ind"><div class="nombre">Desde su máximo</div><div class="valor num">${fmtVar(m.desde_maximo, 1)}</div><div class="meta">Máximo ${fmtEur(m.maximo, 0)} (${fmtFecha(m.fecha_maximo)})</div></div>
      </div>
      <div class="grafico"><canvas id="g-btc" aria-label="Evolución de bitcoin en euros"></canvas></div>`
      : `<p class="vacio">Precio de bitcoin aún no disponible: se descarga en la próxima actualización de precios.</p>`}
      ${cat ? `<p>En tu cartera: <strong class="num">${fmtEur(cat.valor, 0)}</strong> <span class="suave">(${fmtPct(cat.actual, 1)} · objetivo ${fmtPct(cat.objetivo, 0)})</span></p>` : ''}
      ${a ? `<div class="tarjeta-interior">${htmlSenal(a, false)}</div>` : '<p class="vacio">Aún no hay análisis de bitcoin. Se calcula cada día laborable a las 22:00.</p>'}
      <div class="aviso info">Bitcoin es el activo más volátil de tu cartera: ha llegado a caer más de un 75 % desde máximos. Por eso su peso es pequeño y la app nunca da para él una señal más favorable que «compra progresiva».</div>
      ${cr ? '<p class="suave">Fuente: EODHD (BTC-EUR, cierre diario a las 00:00 UTC). Bitcoin cotiza todos los días, también en fin de semana.</p>' : ''}
    </article>`;
  }

  function vistaFondos(el, d) {
    const rv = d.cartera.categorias.filter(c => c.id === 'RV_DES' || c.id === 'RV_EME');
    const pr = d.precios || { referencias: [], graficos: {} };
    const indices = pr.referencias.filter(r => r.grupo === 'indice');
    const selIdx = estado.indiceSel && pr.graficos[estado.indiceSel] ? estado.indiceSel : (Object.keys(pr.graficos)[0] || '');
    const cat = d.catalogo || { productos: [], notas: [] };
    const tengo = p => d.cartera.posiciones.some(x => p.isin ? x.isin === p.isin : (x.categoria === p.categoria && x.nombre === p.nombre));

    const grupos = Object.keys(NOMBRE_CAT).map(k => {
      const prods = cat.productos.filter(p => p.categoria === k);
      if (!prods.length) return '';
      return `<h3 style="margin:16px 0 8px">${esc(NOMBRE_CAT[k])}</h3><div class="posiciones">${prods.map(p => `
        <div class="posicion">
          <div class="arriba"><div><div class="nombre">${esc(p.nombre)}</div>
            <span class="etiqueta-cat">${p.isin ? esc(p.isin) + ' · ' : ''}${esc(p.tipo)} · ${esc(p.domicilio)}</span></div>
            <div class="valor num">${p.isin ? 'TER ' + fmtNum(p.ter, 2) + ' %' : ''}</div></div>
          <div class="detalles">
            <span>Política<b>${esc(p.politica)}</b></span><span>Réplica<b>${esc(p.replicacion)}</b></span><span>Tamaño<b>${esc(p.tamano)}</b></span>${p.ticker ? `<span>Ticker<b>${esc(p.ticker)}</b></span>` : ''}
          </div>
          <div style="font-size:.86rem"><span class="pos">✓</span> ${p.pros.map(esc).join('<br><span class="pos">✓</span> ')}</div>
          <div style="font-size:.86rem"><span class="neg">!</span> ${p.contras.map(esc).join('<br><span class="neg">!</span> ')}</div>
          <div class="botonera">
            ${ELECCION.indexOf(p.isin) >= 0 ? '<span class="chip bien">Tu elección (opción A)</span>' : ''}
            ${p.isin || p.alta ? (tengo(p) ? '<span class="chip ok">Ya está en tu cartera</span>' : `<button class="btn pequeno" data-alta="${esc(cat.productos.indexOf(p))}">Añadir a mi cartera</button>`) : ''}
            ${p.fuente ? `<a class="btn pequeno" href="${esc(p.fuente)}" target="_blank" rel="noopener">Ficha</a>` : ''}
          </div>
        </div>`).join('')}</div>`;
    }).join('');

    el.innerHTML = `
      <article class="tarjeta ancho">
        <h2>Evolución de los índices</h2>
        ${avisoPrecios(pr)}
        ${tablaVariaciones(indices.map(r => ({ nombre: r.nombre, m: r.metricas, estado: r.estado, fmt: v => r.unidad === '€' ? fmtEur(v, 2) : fmtNum(v, 0) })))}
        <p class="suave">* Caída desde el máximo dentro del historial disponible. MSCI World y Emergentes se siguen a través del precio de su ETF (los índices de MSCI requieren licencia).</p>
        ${selIdx ? `<div class="botonera" style="margin:10px 0">${Object.keys(pr.graficos).map(s => `<button class="btn pequeno ${s === selIdx ? 'primario' : ''}" data-indice="${esc(s)}">${esc((indices.find(r => r.simbolo === s) || {}).nombre || s).replace(/ \(.*\)/, '')}</button>`).join('')}</div>
        <div class="grafico"><canvas id="g-indice" aria-label="Evolución del índice"></canvas></div>` : ''}
        ${pr.configurado ? piePrecios(pr) : ''}
      </article>
      <article class="tarjeta">
        <h2>Tu renta variable</h2>
        ${rv.map(c => `<p style="margin:.2rem 0">${esc(c.nombre)}: <strong class="num">${fmtEur(c.valor, 0)}</strong> <span class="suave">(${fmtPct(c.actual, 1)} · objetivo ${fmtPct(c.objetivo, 0)})</span></p>`).join('')}
      </article>
      <article class="tarjeta ancho"><h2>Recomendación por categoría <button class="btn pequeno" data-metodologia="1">¿Cómo se calcula?</button></h2>
        <div class="vista-senales">${['RV_DES', 'RV_EME', 'BONOS', 'REITS'].map(id => senal(d, id) ? `<div class="tarjeta-interior"><h3 style="margin-top:0">${esc(senal(d, id).nombre)}</h3>${htmlSenal(senal(d, id), false)}</div>` : '').join('') || '<p class="vacio">Aún no hay análisis. Se calcula cada día laborable a las 22:00.</p>'}</div></article>
      ${tarjetaCripto(d)}
      <article class="tarjeta ancho">
        <h2>Comparador de productos</h2>
        <p class="suave">Candidatos para cada categoría de tu cartera, con datos verificados el ${fmtFecha(cat.verificado)}. Antes de comprar, busca el ISIN en Trade Republic para confirmar que está disponible y si admite plan de inversión. Es información para comparar, no una recomendación personalizada.</p>
        ${grupos}
        <h3 style="margin:16px 0 8px">Fiscalidad en España (resumen)</h3>
        ${cat.notas.map(n => `<div class="aviso info">${esc(n)}</div>`).join('')}
      </article>
      ${tarjetaIndicadores('Entorno de tipos de interés y bonos', ['BCE_DEPO', 'FED_TIPO', 'BONO10_EZ', 'BONO10_US', 'IPCA_EZ'], d,
        'Los tipos de interés influyen en la valoración de las bolsas y en el precio de los bonos que ya tienes.')}
    `;
    if (pr.cripto && pr.cripto.grafico && pr.cripto.grafico.length) graficoLinea('g-btc', pr.cripto.grafico, 'Bitcoin (€)', v => fmtEur(v, 0));
    if (selIdx) {
      const r = indices.find(x => x.simbolo === selIdx) || {};
      graficoLinea('g-indice', pr.graficos[selIdx], r.nombre || selIdx, v => r.unidad === '€' ? fmtEur(v, 2) : fmtNum(v, 0));
    }
    el.onclick = ev => {
      const b = ev.target.closest('[data-indice]');
      if (b) { estado.indiceSel = b.dataset.indice; pintar(); return; }
      const a = ev.target.closest('[data-alta]');
      if (a) {
        const p = cat.productos[Number(a.dataset.alta)];
        if (p) modalActivo(null, { nombre: p.nombre, isin: p.isin, ticker: p.ticker, categoria: p.categoria, tipo: p.tipo, region: p.region, divisa: p.divisa, simbolo_datos: p.simbolo_datos || '' });
      }
    };
  }

  /* ================= PANTALLA 4 · MI CARTERA ================= */
  function vistaCartera(el, d) {
    const c = d.cartera;
    const nombreCat = id => (d.catalogos.categorias.find(x => x.id === id) || {}).nombre || id;
    const colorCat = id => (d.catalogos.categorias.find(x => x.id === id) || {}).color || '#999';
    const activos = c.posiciones;
    const nombreActivo = id => (activos.find(a => a.id === id) || {}).nombre || '¿?';

    const posHtml = activos.length ? activos.map(p => {
      const liq = p.categoria === 'LIQUIDEZ';
      return `<div class="posicion">
        <div class="arriba">
          <div><div class="nombre">${esc(p.nombre)}</div>
            <span class="etiqueta-cat"><i style="background:${esc(colorCat(p.categoria))}"></i>${esc(nombreCat(p.categoria))} · ${esc(p.tipo)}${p.isin ? ' · ' + esc(p.isin) : ''}</span></div>
          <div class="valor num">${p.sin_precio ? '<span class="suave">Sin precio</span>' : fmtEur(p.valor)}
            ${!liq && p.latente !== null && p.participaciones > 0 ? `<div class="${clase(p.latente)}" style="font-size:.82rem">${fmtEur(p.latente)} (${fmtPct(p.latente_pct, 1, true)})</div>` : ''}</div>
        </div>
        <div class="detalles">
          ${liq ? `<span>Saldo<b class="num">${fmtEur(p.participaciones)}</b></span>` : `
          <span>${p.categoria === 'CRIPTO' ? 'Cantidad' : 'Participaciones'}<b class="num">${fmtNum(p.participaciones, p.categoria === 'CRIPTO' ? 8 : 4)}</b></span>
          <span>Precio medio<b class="num">${fmtEur(p.precio_medio, 4)}</b></span>
          <span>Precio actual<b class="num">${p.precio_actual ? fmtEur(p.precio_actual, 4) : '—'}</b></span>
          <span>Fecha precio<b>${fmtFecha(p.fecha_precio)}</b></span>`}
          <span>Peso<b class="num">${fmtPct(p.peso, 1)}</b></span>
          <span>Comisiones<b class="num">${fmtEur(p.comisiones)}</b></span>
          ${p.realizado ? `<span>Ganancia realizada<b class="num ${clase(p.realizado)}">${fmtEur(p.realizado)}</b></span>` : ''}
          ${p.rentas ? `<span>Dividendos/intereses<b class="num pos">${fmtEur(p.rentas)}</b></span>` : ''}
        </div>
        ${!liq && p.fuente_precio ? `<span class="suave">Precio: ${esc(p.fuente_precio)}</span>` : ''}
        <div class="botonera">
          ${liq ? '' : `<button class="btn pequeno" data-accion="precio" data-id="${esc(p.id)}">Actualizar precio</button>`}
          <button class="btn pequeno" data-accion="operar" data-id="${esc(p.id)}">Registrar operación</button>
          <button class="btn pequeno" data-accion="editar-activo" data-id="${esc(p.id)}">Editar</button>
        </div>
      </div>`;
    }).join('') : '<p class="vacio">Aún no tienes activos. Pulsa «Añadir activo» para dar de alta, por ejemplo, tu ETF de renta variable mundial o tu cuenta de Trade Republic.</p>';

    const reb = d.rebalanceo;
    const rebHtml = `<p>${esc(reb.mensaje)}</p>${reb.detalle && reb.detalle.length ? `<div class="tabla-scroll"><table>
      <thead><tr><th>Categoría</th><th class="der">Actual</th><th class="der">Objetivo</th><th class="der">Desfase</th><th class="der">Meses*</th></tr></thead>
      <tbody>${reb.detalle.map(x => `<tr><td>${esc(x.nombre)}</td><td class="der num">${fmtPct(x.actual, 1)}</td><td class="der num">${fmtPct(x.objetivo, 0)}</td>
        <td class="der num ${clase(-x.importe_desfase)}">${fmtEur(x.importe_desfase, 0)}</td><td class="der num">${x.meses_para_corregir || '—'}</td></tr>`).join('')}</tbody></table></div>
      <p class="suave">* Meses aproximados para corregir el déficit si toda la aportación mensual fuese a esa categoría. Un desfase positivo significa que sobra peso; negativo, que falta.</p>` : ''}`;

    const opsHtml = d.operaciones.length ? `<div class="tabla-scroll"><table>
      <thead><tr><th>Fecha</th><th>Activo</th><th>Tipo</th><th class="der">Partic.</th><th class="der">Precio</th><th class="der">Comisión</th><th class="der">Importe</th><th></th></tr></thead>
      <tbody>${d.operaciones.slice(0, 200).map(o => `<tr><td>${fmtFecha(o.fecha)}</td><td>${esc(nombreActivo(o.activo_id))}</td><td>${esc(o.tipo)}</td>
        <td class="der num">${o.tipo === 'RENTA' ? '—' : fmtNum(Number(o.participaciones), 4)}</td><td class="der num">${o.tipo === 'RENTA' ? '—' : fmtEur(Number(o.precio), 4)}</td>
        <td class="der num">${fmtEur(Number(o.comision))}</td><td class="der num">${fmtEur(Number(o.importe))}</td>
        <td><button class="btn pequeno peligro" data-accion="borrar-op" data-id="${esc(o.id)}" aria-label="Eliminar operación">✕</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="vacio">Sin operaciones registradas.</p>';

    el.innerHTML = `
      <article class="tarjeta ancho">
        <h2>Resumen</h2>
        <div class="indicadores">
          <div class="ind"><div class="nombre">Patrimonio</div><div class="valor num">${fmtEur(c.total)}</div></div>
          <div class="ind"><div class="nombre">Ganancia no realizada</div><div class="valor num ${clase(c.latente)}">${fmtEur(c.latente)}</div></div>
          <div class="ind"><div class="nombre">Ganancia realizada + rentas</div><div class="valor num ${clase(c.realizado + c.rentas)}">${fmtEur(c.realizado + c.rentas)}</div></div>
          <div class="ind"><div class="nombre">Comisiones soportadas</div><div class="valor num">${fmtEur(c.comisiones)}</div><div class="meta">${c.comisiones_pct === null ? '' : fmtPct(c.comisiones_pct, 2) + ' de lo invertido'}</div></div>
        </div>
        <div class="botonera" style="margin-top:12px">
          <button class="btn primario" data-accion="nuevo-activo">Añadir activo</button>
          <button class="btn" data-accion="operar" ${activos.length ? '' : 'disabled'}>Registrar operación</button>
          <button class="btn" data-accion="exportar">Exportar CSV</button>
          <button class="btn" data-exportar-todo="1">Copia completa (JSON)</button>
        </div>
      </article>

      <article class="tarjeta ancho"><h2>Posiciones</h2><div class="posiciones">${posHtml}</div></article>

      ${tarjetaDonde(d)}

      <article class="tarjeta"><h2>Distribución y desviaciones</h2>${c.total > 0 ? barrasCategorias(c.categorias, d.catalogos.umbral) : '<p class="vacio">Sin posiciones valoradas.</p>'}</article>
      <article class="tarjeta"><h2>Rebalanceo anual</h2>${rebHtml}</article>

      <article class="tarjeta"><h2>Exposición por región</h2>${listaSimple(c.regiones)}</article>
      <article class="tarjeta"><h2>Exposición por divisa</h2>${listaSimple(c.divisas)}
        <p class="suave">Según la divisa de exposición que indicaste para cada producto. Un ETF mundial en euros sigue expuesto mayoritariamente al dólar.</p></article>

      <article class="tarjeta ancho"><h2>Operaciones</h2>${opsHtml}</article>
    `;
    enlazarDonde();
    el.onclick = ev => {
      const b = ev.target.closest('[data-accion]');
      if (!b) return;
      const id = b.dataset.id;
      switch (b.dataset.accion) {
        case 'nuevo-activo': modalActivo(null); break;
        case 'editar-activo': modalActivo(activos.find(a => a.id === id)); break;
        case 'operar': modalOperacion(id); break;
        case 'precio': modalPrecio(activos.find(a => a.id === id)); break;
        case 'borrar-op': borrarOperacion(id); break;
        case 'exportar': exportarCSV(); break;
      }
    };
  }

  function listaSimple(lista) {
    if (!lista || !lista.length) return '<p class="vacio">Sin datos.</p>';
    return `<div class="tabla-scroll"><table><tbody>${lista.map(r => `<tr><td>${esc(r.nombre)}</td><td class="der num">${fmtEur(r.valor, 0)}</td><td class="der num">${fmtPct(r.pct, 1)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  /* ================= PANTALLA 5 · ASESOR (Fase 5: perfil y simulador) ================= */
  const ORDEN_SIM = ['RV_DES', 'RV_EME', 'ORO', 'BONOS', 'REITS', 'CRIPTO', 'LIQUIDEZ'];
  // Hipótesis de partida (rentabilidad media anual nominal en euros y volatilidad), editables.
  // Referencia: J.P. Morgan Long-Term Capital Market Assumptions 2026 (10-15 años), ajustadas a la baja para un inversor en euros.
  const HIPOTESIS = {
    RV_DES:   { r: 6.5, v: 15 },
    RV_EME:   { r: 6.5, v: 20 },
    ORO:      { r: 4.0, v: 15 },
    BONOS:    { r: 3.0, v: 4 },
    REITS:    { r: 6.0, v: 19 },
    // Bitcoin: sin previsión institucional. Hipótesis prudente: la misma rentabilidad que la bolsa
    // (sin suponer ninguna prima) y una volatilidad del 60 %, dentro del rango histórico (50-80 % anual).
    CRIPTO:   { r: 6.5, v: 60 },
    LIQUIDEZ: { r: 2.5, v: 0.5 }
  };
  const CORRELACION = [
    [1.00, 0.75, 0.10, 0.05, 0.70, 0.35, 0.00],
    [0.75, 1.00, 0.15, 0.00, 0.60, 0.35, 0.00],
    [0.10, 0.15, 1.00, 0.20, 0.15, 0.10, 0.00],
    [0.05, 0.00, 0.20, 1.00, 0.20, 0.00, 0.10],
    [0.70, 0.60, 0.15, 0.20, 1.00, 0.30, 0.00],
    [0.35, 0.35, 0.10, 0.00, 0.30, 1.00, 0.00],
    [0.00, 0.00, 0.00, 0.10, 0.00, 0.00, 1.00]
  ];
  const PRUDENTE = { RV_DES: 35, RV_EME: 10, ORO: 15, BONOS: 30, REITS: 5, CRIPTO: 0, LIQUIDEZ: 5 };
  // Escenarios de crisis hipotéticos (caídas aproximadas de pico a valle inspiradas en episodios reales)
  const CRISIS = {
    gfc: { nombre: 'Gran crisis financiera (tipo 2008)', choque: { RV_DES: -45, RV_EME: -50, ORO: 5, BONOS: 5, REITS: -55, CRIPTO: -75, LIQUIDEZ: 0 } },
    inflacion: { nombre: 'Inflación y subida de tipos (tipo 2022)', choque: { RV_DES: -15, RV_EME: -20, ORO: 0, BONOS: -12, REITS: -25, CRIPTO: -65, LIQUIDEZ: 0 } },
    decada: { nombre: 'Década perdida en bolsa (tipo 2000-2010)', choque: null, decada: true }
  };

  function pesosObjetivo(cfg) {
    const p = {};
    ORDEN_SIM.forEach(k => { p[k] = Number(cfg['obj_' + k]) || 0; });
    return p;
  }
  const pesoBolsa = p => (p.RV_DES || 0) + (p.RV_EME || 0) + (p.REITS || 0) + (p.CRIPTO || 0);
  const caidaCrisis = p => ORDEN_SIM.reduce((s, k) => s + (p[k] || 0) / 100 * CRISIS.gfc.choque[k], 0);

  function evaluarPerfil(d) {
    const cfg = d.config;
    const edad = Number(cfg.edad) || 0, jub = Number(cfg.edad_jubilacion) || 66;
    const gastos = Number(cfg.gastos_mensuales) || 0, meses = Number(cfg.meses_colchon) || 6;
    const tiene = String(cfg.fondo_emergencia).indexOf('S') === 0;
    const tol = String(cfg.tolerancia || 'Moderada');
    const ref = Math.max(20, Math.min(80, 110 - edad + (tol === 'Baja' ? -10 : (tol === 'Alta' ? 10 : 0))));
    const p = pesosObjetivo(cfg);
    const bolsa = pesoBolsa(p);
    const aport = Number(cfg.aportacion_mensual) || 0;
    const colchon = gastos * meses;
    return {
      edad: edad, jub: jub, anios: Math.max(0, jub - edad), tol: tol, gastos: gastos, meses: meses, tiene: tiene,
      colchon: colchon, mesesAhorro: aport > 0 ? Math.ceil(colchon / aport) : null,
      ref: ref, bolsa: bolsa, caida: caidaCrisis(p), caidaPrudente: caidaCrisis(PRUDENTE),
      veredicto: bolsa > ref + 5 ? 'alto' : (bolsa < ref - 10 ? 'bajo' : 'adecuado')
    };
  }

  function tarjetaPerfil(d) {
    const e = evaluarPerfil(d);
    const fondo = e.tiene ? '<p>Has indicado que ya tienes un fondo de emergencia aparte. ✔</p>' : `
      <p><strong>Recomendado: ${fmtEur(e.colchon, 0)}</strong> (${e.meses} meses × ${fmtEur(e.gastos, 0)} de gastos), en liquidez disponible y <strong>fuera de esta cartera</strong>.</p>
      <p class="suave">Ahora mismo no tienes ese colchón. Con ${fmtEur(Number(d.config.aportacion_mensual) || 0, 0)} al mes tardarías unos ${e.mesesAhorro || '—'} meses en reunirlo; una parte de las aportaciones extraordinarias que planeas para enero podría acelerarlo. Sin colchón, un imprevisto podría obligarte a vender inversiones en mal momento.</p>`;
    const textoVer = e.veredicto === 'alto'
      ? `Tu cartera objetivo tiene un <strong>${fmtNum(e.bolsa, 0)} %</strong> en activos de riesgo (bolsa, REITs y bitcoin). Con ${e.anios} años hasta la jubilación y tolerancia ${e.tol.toLowerCase()}, la referencia orientativa sería en torno a un <strong>${fmtNum(e.ref, 0)} %</strong>. Es <strong>algo elevado</strong>.`
      : e.veredicto === 'bajo'
        ? `Tu cartera objetivo tiene un ${fmtNum(e.bolsa, 0)} % en activos de riesgo, por debajo de la referencia orientativa (${fmtNum(e.ref, 0)} %). Es prudente, aunque puede crecer menos.`
        : `Tu cartera objetivo tiene un ${fmtNum(e.bolsa, 0)} % en activos de riesgo, en línea con la referencia orientativa (${fmtNum(e.ref, 0)} %).`;
    return `<article class="tarjeta ancho">
      <h2>Tu perfil inversor <button class="btn pequeno" id="btn-editar-perfil">Editar</button></h2>
      <div class="indicadores compacto">
        <div class="ind"><div class="nombre">Edad</div><div class="valor">${esc(e.edad)} años</div></div>
        <div class="ind"><div class="nombre">Jubilación prevista</div><div class="valor">${esc(e.jub)} años</div><div class="meta">dentro de ${e.anios} años</div></div>
        <div class="ind"><div class="nombre">Tolerancia a pérdidas</div><div class="valor">${esc(e.tol)}</div></div>
        <div class="ind"><div class="nombre">Gastos mensuales</div><div class="valor num">${fmtEur(e.gastos, 0)}</div></div>
      </div>
      <h3>Fondo de emergencia</h3>${fondo}
      <h3>¿Encaja tu cartera con tu edad?</h3>
      <p>${textoVer}</p>
      <p>En una crisis como la de 2008, tu cartera objetivo podría caer en torno a un <strong>${fmtNum(-e.caida, 0)} %</strong> (por ejemplo, de 20.000 € a ${fmtEur(20000 * (1 + e.caida / 100), 0)}). Dijiste que ante una caída del 30 % aguantarías: estarías justo en ese límite.</p>
      <p>Una alternativa más prudente (${fmtNum(pesoBolsa(PRUDENTE), 0)} % en activos de riesgo, sin bitcoin y con más bonos) caería en torno a un ${fmtNum(-e.caidaPrudente, 0)} %. Puedes comparar ambas en el simulador de abajo.</p>
      <p class="suave">Valoración analítica, no asesoramiento regulado. La referencia usa la regla práctica «110 menos la edad», ajustada a tu tolerancia; es una orientación, no una norma. La decisión es tuya: si quieres cambiar los pesos, hazlo en Ajustes.</p>
    </article>`;
  }

  /* ---------- Motor Monte Carlo (se calcula en el propio móvil) ---------- */
  function rngSemilla(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function normalDe(rnd) {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function cholesky(m) {
    const n = m.length, L = m.map(() => new Array(n).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let s = m[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-10)) : s / L[j][j];
    }
    return L;
  }
  function percentil(arr, p) {
    const a = arr.slice().sort((x, y) => x - y);
    const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return a[lo] + (a[hi] - a[lo]) * (i - lo);
  }

  /** Simulación Monte Carlo mensual con colas gruesas (t de Student, 6 g.l.) y rebalanceo mensual. */
  function simular(par, pesos, hip, nSim) {
    const meses = par.anios * 12;
    const L = cholesky(CORRELACION);
    const n = ORDEN_SIM.length;
    const w = ORDEN_SIM.map(k => (pesos[k] || 0) / 100);
    const mu = ORDEN_SIM.map(k => { const h = hip[k]; return (Math.log(1 + h.r / 100) - Math.pow(h.v / 100, 2) / 2) / 12; });
    const sd = ORDEN_SIM.map(k => hip[k].v / 100 / Math.sqrt(12));
    const terMes = par.ter / 100 / 12;
    const infMes = Math.pow(1 + par.inflacion / 100, 1 / 12) - 1;
    const mesJub = Math.max(0, (par.jub - par.edad) * 12);
    const hoy = new Date();
    // Flujos de cada mes (iguales en todas las simulaciones)
    const flujo = new Float64Array(meses);
    for (let m = 0; m < meses; m++) {
      const mesCal = (hoy.getMonth() + 1 + m) % 12;
      const anioCal = hoy.getFullYear() + Math.floor((hoy.getMonth() + 1 + m) / 12);
      if (m < mesJub) flujo[m] = par.aportacion + ((mesCal === 0 && anioCal >= 2027) ? par.extra : 0);
      else if (par.retiro > 0) flujo[m] = -par.retiro * Math.pow(1 + infMes, m);
    }
    const finales = new Float64Array(nSim), caidas = new Float64Array(nSim);
    const anuales = [];
    for (let y = 0; y < par.anios; y++) anuales.push(new Float64Array(nSim));
    let agotadas = 0;
    const rnd = rngSemilla(20261111);
    const z = new Float64Array(n);
    let guardado = null;
    const normal = () => {
      if (guardado !== null) { const g = guardado; guardado = null; return g; }
      let u = rnd(); while (u === 0) u = rnd();
      const v = rnd(), r = Math.sqrt(-2 * Math.log(u)), a = 2 * Math.PI * v;
      guardado = r * Math.sin(a);
      return r * Math.cos(a);
    };
    for (let s = 0; s < nSim; s++) {
      let V = par.capital, indice = 1, pico = 1, peorCaida = 0, agotada = false;
      for (let m = 0; m < meses; m++) {
        V += flujo[m];
        if (V <= 0) { V = 0; agotada = true; }
        for (let i = 0; i < n; i++) z[i] = normal();
        // chi-cuadrado con 6 grados de libertad = -2·ln(u1·u2·u3)
        const chi = -2 * Math.log((rnd() || 1e-12) * (rnd() || 1e-12) * (rnd() || 1e-12));
        const escala = Math.sqrt(4 / chi);
        let r = -terMes;
        for (let i = 0; i < n; i++) {
          if (!w[i]) continue;
          let e = 0; const Li = L[i];
          for (let j = 0; j <= i; j++) e += Li[j] * z[j];
          r += w[i] * (Math.exp(mu[i] + sd[i] * e * escala) - 1);
        }
        V *= (1 + r);
        indice *= (1 + r);
        if (indice > pico) pico = indice;
        else { const c = indice / pico - 1; if (c < peorCaida) peorCaida = c; }
        if ((m + 1) % 12 === 0) anuales[(m + 1) / 12 - 1][s] = V;
      }
      finales[s] = V; caidas[s] = peorCaida * 100;
      if (agotada) agotadas++;
    }
    // aportado acumulado (determinista)
    const aportado = [];
    let ap = par.capital;
    for (let m = 0; m < meses; m++) {
      const mesCal = (hoy.getMonth() + 1 + m) % 12;
      const anioCal = hoy.getFullYear() + Math.floor((hoy.getMonth() + 1 + m) / 12);
      if (m < mesJub) { ap += par.aportacion; if (mesCal === 0 && anioCal >= 2027) ap += par.extra; }
      if ((m + 1) % 12 === 0) aportado.push(ap);
    }
    const porAnio = [];
    for (let y = 0; y < par.anios; y++) {
      const col = Array.from(anuales[y]);
      const def = Math.pow(1 + par.inflacion / 100, y + 1);
      porAnio.push({ anio: y + 1, edad: par.edad + y + 1, aportado: aportado[y], p10: percentil(col, .1), p50: percentil(col, .5), p90: percentil(col, .9), p50real: percentil(col, .5) / def });
    }
    const defFin = Math.pow(1 + par.inflacion / 100, par.anios);
    const apFin = aportado[aportado.length - 1];
    const fin = Array.from(finales), cai = Array.from(caidas);
    return {
      porAnio: porAnio, aportado: apFin,
      p10: percentil(fin, .1), p50: percentil(fin, .5), p90: percentil(fin, .9), deflactor: defFin,
      probPerdida: fin.filter(v => v < apFin).length / nSim * 100,
      probPerdidaReal: fin.filter(v => v / defFin < apFin).length / nSim * 100,
      caidaTipica: percentil(cai, .5), caidaMala: percentil(cai, .1),
      probAgotar: agotadas / nSim * 100,
      rentEsperada: ORDEN_SIM.reduce((s, k, i) => s + w[i] * hip[k].r, 0) - par.ter
    };
  }

  /** Trayectoria central determinista con una crisis hipotética en un año concreto. */
  function simularCrisis(par, pesos, hip, tipo, anioCrisis) {
    const c = CRISIS[tipo];
    const meses = par.anios * 12, mesJub = Math.max(0, (par.jub - par.edad) * 12);
    const hoy = new Date();
    const infMes = Math.pow(1 + par.inflacion / 100, 1 / 12) - 1;
    const correr = conCrisis => {
      let V = par.capital, caidaAnio = 0;
      for (let m = 0; m < meses; m++) {
        const mesCal = (hoy.getMonth() + 1 + m) % 12;
        const anioCal = hoy.getFullYear() + Math.floor((hoy.getMonth() + 1 + m) / 12);
        if (m < mesJub) { V += par.aportacion; if (mesCal === 0 && anioCal >= 2027) V += par.extra; }
        else if (par.retiro > 0) V = Math.max(0, V - par.retiro * Math.pow(1 + infMes, m));
        const y = Math.floor(m / 12);
        if (conCrisis && c.choque && m === anioCrisis * 12) {
          const g = ORDEN_SIM.reduce((s, k) => s + (pesos[k] || 0) / 100 * c.choque[k] / 100, 0);
          caidaAnio = g * 100;
          V *= (1 + g);
        }
        const r = ORDEN_SIM.reduce((s, k) => {
          let anual = hip[k].r;
          if (conCrisis && c.decada && (k === 'RV_DES' || k === 'RV_EME' || k === 'REITS' || k === 'CRIPTO') && y >= anioCrisis && y < anioCrisis + 10) anual = 0;
          return s + (pesos[k] || 0) / 100 * (Math.pow(1 + anual / 100, 1 / 12) - 1);
        }, 0) - par.ter / 100 / 12;
        V *= (1 + r);
      }
      return { V: V, caida: caidaAnio };
    };
    const sin = correr(false), con = correr(true);
    return { sin: sin.V, con: con.V, caida: con.caida, nombre: c.nombre, decada: !!c.decada };
  }

  function paramsSimulador(d) {
    const cfg = d.config;
    const g = (id, def) => { const el = document.getElementById(id); const v = el ? parseFloat(el.value) : NaN; return isNaN(v) ? def : v; };
    return {
      capital: g('s-capital', d.cartera.total),
      aportacion: g('s-aportacion', Number(cfg.aportacion_mensual) || 0),
      extra: g('s-extra', Number(cfg.aportacion_extra_anual) || 0),
      edad: Number(cfg.edad) || 58,
      jub: g('s-jub', Number(cfg.edad_jubilacion) || 66),
      anios: g('s-anios', 20),
      retiro: g('s-retiro', Number(cfg.retiro_mensual) || 0),
      inflacion: g('s-inflacion', 2.5),
      ter: g('s-ter', 0.2)
    };
  }

  function leerHipotesis() {
    const h = {};
    ORDEN_SIM.forEach(k => {
      const r = parseFloat((document.getElementById('h-r-' + k) || {}).value);
      const v = parseFloat((document.getElementById('h-v-' + k) || {}).value);
      h[k] = { r: isNaN(r) ? HIPOTESIS[k].r : r, v: isNaN(v) ? HIPOTESIS[k].v : v };
    });
    return h;
  }

  function tarjetaSimulador(d) {
    const cfg = d.config;
    const nombres = { RV_DES: 'RV desarrollados', RV_EME: 'RV emergentes', ORO: 'Oro', BONOS: 'Bonos', REITS: 'REITs', CRIPTO: 'Bitcoin', LIQUIDEZ: 'Liquidez' };
    const obj = pesosObjetivo(cfg);
    return `<article class="tarjeta ancho" id="tarjeta-sim">
      <h2>Simulador de patrimonio</h2>
      <p class="suave">Proyecta tu patrimonio con 2.000 simulaciones de cómo podrían comportarse los mercados (método Monte Carlo). Son <strong>hipótesis, no promesas</strong>.</p>
      <form class="formulario" id="f-sim">
        <div class="doble">
          <label>Capital inicial (€)<input id="s-capital" type="number" min="0" step="any" inputmode="decimal" value="${esc(Math.round(d.cartera.total * 100) / 100)}"></label>
          <label>Aportación mensual (€)<input id="s-aportacion" type="number" min="0" step="any" inputmode="decimal" value="${esc(cfg.aportacion_mensual)}"></label>
        </div>
        <div class="doble">
          <label>Aportación extra cada enero (€)<input id="s-extra" type="number" min="0" step="any" inputmode="decimal" value="${esc(cfg.aportacion_extra_anual || 0)}"><span class="ayuda">A partir de enero de 2027.</span></label>
          <label>Edad de jubilación<input id="s-jub" type="number" min="${esc(cfg.edad)}" max="80" value="${esc(cfg.edad_jubilacion || 66)}"><span class="ayuda">Las aportaciones se detienen entonces.</span></label>
        </div>
        <div class="doble">
          <label>Horizonte<select id="s-anios"><option value="15">15 años</option><option value="20" selected>20 años</option></select></label>
          <label>Retirada mensual tras jubilarte (€ de hoy)<input id="s-retiro" type="number" min="0" step="any" inputmode="decimal" value="${esc(cfg.retiro_mensual || 0)}"><span class="ayuda">Se actualiza con la inflación.</span></label>
        </div>
        <div class="doble">
          <label>Inflación anual (%)<input id="s-inflacion" type="number" min="0" max="15" step="0.1" value="2.5"><span class="ayuda">El objetivo del BCE es el 2 %.</span></label>
          <label>Comisiones anuales (%)<input id="s-ter" type="number" min="0" max="3" step="0.01" value="0.20"><span class="ayuda">TER medio de tus ETF.</span></label>
        </div>
        <details class="hipotesis"><summary>Hipótesis de rentabilidad y riesgo (editables)</summary>
          <div class="tabla-scroll"><table><thead><tr><th>Activo</th><th class="der">Peso objetivo</th><th class="der">Rentab. media %</th><th class="der">Volatilidad %</th></tr></thead><tbody>
          ${ORDEN_SIM.map(k => `<tr><td>${nombres[k]}</td><td class="der">${fmtNum(obj[k], 0)} %</td>
            <td class="der"><input id="h-r-${k}" class="mini" type="number" step="0.1" value="${HIPOTESIS[k].r}"></td>
            <td class="der"><input id="h-v-${k}" class="mini" type="number" step="0.5" min="0" value="${HIPOTESIS[k].v}"></td></tr>`).join('')}
          </tbody></table></div>
          <p class="suave">Rentabilidades medias anuales en euros, antes de comisiones. Punto de partida: previsiones a 10-15 años de J.P. Morgan (Long-Term Capital Market Assumptions 2026: bolsa global 7,5 %, bonos agregados globales 5,3 %, en su moneda), ajustadas a la baja para un inversor en euros, porque los tipos de interés en euros son más bajos. Bitcoin no tiene previsión institucional: se usa la misma rentabilidad que la bolsa, sin prima, y una volatilidad del 60 %. La simulación usa colas gruesas para reflejar que las crisis son más frecuentes de lo que supone una campana normal. No son predicciones.</p>
        </details>
        <button class="btn primario" type="submit">Simular</button>
      </form>
      <div id="sim-resultado" aria-live="polite"></div>
    </article>`;
  }

  function htmlResultado(par, rA, rB) {
    const real = (v, r) => v / r.deflactor;
    const fila = (titulo, txt, r) => `<div class="escenario">
        <div class="nombre">${titulo}</div>
        <div class="valor num">${fmtEur(r, 0)}</div>
        <div class="meta">${txt}</div></div>`;
    const comp = rB ? `<h3>Comparación: tu cartera objetivo frente a una alternativa prudente</h3>
      <div class="tabla-scroll"><table><thead><tr><th></th><th class="der">Tu cartera<br>(${fmtNum(pesoBolsa(pesosObjetivo(estado.datos.config)), 0)} % bolsa)</th><th class="der">Prudente<br>(${fmtNum(pesoBolsa(PRUDENTE), 0)} % bolsa)</th></tr></thead><tbody>
        <tr><td>Rentabilidad media esperada</td><td class="der">${fmtPct(rA.rentEsperada, 1)}</td><td class="der">${fmtPct(rB.rentEsperada, 1)}</td></tr>
        <tr><td>Escenario central (en € de hoy)</td><td class="der num">${fmtEur(real(rA.p50, rA), 0)}</td><td class="der num">${fmtEur(real(rB.p50, rB), 0)}</td></tr>
        <tr><td>Escenario conservador (en € de hoy)</td><td class="der num">${fmtEur(real(rA.p10, rA), 0)}</td><td class="der num">${fmtEur(real(rB.p10, rB), 0)}</td></tr>
        <tr><td>Caída máxima típica por el camino</td><td class="der">${fmtPct(rA.caidaTipica, 0)}</td><td class="der">${fmtPct(rB.caidaTipica, 0)}</td></tr>
        <tr><td>Caída en un caso malo (1 de cada 10)</td><td class="der">${fmtPct(rA.caidaMala, 0)}</td><td class="der">${fmtPct(rB.caidaMala, 0)}</td></tr>
        <tr><td>Probabilidad de acabar con menos de lo aportado</td><td class="der">${fmtPct(rA.probPerdida, 0)}</td><td class="der">${fmtPct(rB.probPerdida, 0)}</td></tr>
      </tbody></table></div>
      <p class="suave">Más bolsa suele dar más patrimonio a largo plazo, pero con caídas más profundas por el camino. La elección depende de cuánto puedas soportar sin vender.</p>` : '';
    return `
      <div class="escenarios">
        ${fila('Conservador', 'Solo 1 de cada 10 simulaciones acaba peor · ' + fmtEur(real(rA.p10, rA), 0) + ' en € de hoy', rA.p10)}
        ${fila('Central', 'La mitad acaba mejor y la mitad peor · ' + fmtEur(real(rA.p50, rA), 0) + ' en € de hoy', rA.p50)}
        ${fila('Optimista', 'Solo 1 de cada 10 acaba mejor · ' + fmtEur(real(rA.p90, rA), 0) + ' en € de hoy', rA.p90)}
      </div>
      <div class="indicadores compacto" style="margin-top:10px">
        <div class="ind"><div class="nombre">Dinero aportado</div><div class="valor num">${fmtEur(rA.aportado, 0)}</div></div>
        <div class="ind"><div class="nombre">Ganancia en el escenario central</div><div class="valor num ${clase(rA.p50 - rA.aportado)}">${fmtEur(rA.p50 - rA.aportado, 0)}</div></div>
        <div class="ind"><div class="nombre">Prob. de acabar con menos de lo aportado</div><div class="valor num">${fmtPct(rA.probPerdida, 0)}</div><div class="meta">${fmtPct(rA.probPerdidaReal, 0)} si se descuenta la inflación</div></div>
        <div class="ind"><div class="nombre">Caída máxima típica por el camino</div><div class="valor num neg">${fmtPct(rA.caidaTipica, 0)}</div><div class="meta">en 1 de cada 10 casos: ${fmtPct(rA.caidaMala, 0)}</div></div>
        ${par.retiro > 0 ? `<div class="ind"><div class="nombre">Prob. de agotar el dinero</div><div class="valor num">${fmtPct(rA.probAgotar, 0)}</div></div>` : ''}
      </div>
      <div class="grafico" style="height:280px;margin-top:12px"><canvas id="g-sim" aria-label="Proyección del patrimonio"></canvas></div>
      <p class="suave">La banda sombreada va del escenario conservador al optimista. Importes en euros de cada año; «€ de hoy» descuenta una inflación del ${fmtNum(par.inflacion, 1)} %.</p>
      ${comp}
      <details class="hipotesis"><summary>Evolución año a año</summary>
        <div class="tabla-scroll"><table><thead><tr><th>Año</th><th>Edad</th><th class="der">Aportado</th><th class="der">Conservador</th><th class="der">Central</th><th class="der">Optimista</th><th class="der">Central (€ de hoy)</th></tr></thead><tbody>
        ${rA.porAnio.map(a => `<tr><td>${a.anio}</td><td>${a.edad}</td><td class="der num">${fmtEur(a.aportado, 0)}</td><td class="der num">${fmtEur(a.p10, 0)}</td><td class="der num">${fmtEur(a.p50, 0)}</td><td class="der num">${fmtEur(a.p90, 0)}</td><td class="der num">${fmtEur(a.p50real, 0)}</td></tr>`).join('')}
        </tbody></table></div></details>
      <h3>Prueba de resistencia: ¿y si llega una crisis?</h3>
      <div class="doble formulario">
        <label>Tipo de crisis<select id="c-tipo"><option value="gfc">${CRISIS.gfc.nombre}</option><option value="inflacion">${CRISIS.inflacion.nombre}</option><option value="decada">${CRISIS.decada.nombre}</option></select></label>
        <label>¿Cuándo?<select id="c-cuando"><option value="jub">Justo antes de jubilarme (el peor momento)</option><option value="0">El primer año</option></select></label>
      </div>
      <div id="crisis-resultado" style="margin-top:10px"></div>
      <p class="suave">Escenarios hipotéticos con caídas aproximadas inspiradas en crisis reales, aplicados sobre la trayectoria central. Sirven para ver el riesgo, no para predecirlo.</p>`;
  }

  function pintarCrisis(par) {
    const cont = document.getElementById('crisis-resultado');
    if (!cont) return;
    const tipo = document.getElementById('c-tipo').value;
    const cuando = document.getElementById('c-cuando').value;
    const anio = cuando === 'jub' ? Math.max(0, Math.min(par.anios - 1, par.jub - par.edad - 1)) : 0;
    const hip = leerHipotesis();
    const a = simularCrisis(par, pesosObjetivo(estado.datos.config), hip, tipo, anio);
    const b = simularCrisis(par, PRUDENTE, hip, tipo, anio);
    const linea = (nombre, r) => `<tr><td>${nombre}</td><td class="der num">${r.decada ? '10 años sin ganancias en bolsa' : fmtPct(r.caida, 0)}</td><td class="der num">${fmtEur(r.sin, 0)}</td><td class="der num">${fmtEur(r.con, 0)}</td><td class="der num neg">${fmtEur(r.con - r.sin, 0)}</td></tr>`;
    cont.innerHTML = `<div class="tabla-scroll"><table><thead><tr><th>Cartera</th><th class="der">Golpe</th><th class="der">Final sin crisis</th><th class="der">Final con crisis</th><th class="der">Diferencia</th></tr></thead><tbody>
      ${linea('Tu cartera', a)}${linea('Prudente', b)}</tbody></table></div>
      <p class="suave">Crisis en el año ${anio + 1} (a los ${par.edad + anio + 1} años de edad). Valores finales a ${par.anios} años, en euros de cada año.</p>`;
  }

  function ejecutarSimulacion(d) {
    const cont = document.getElementById('sim-resultado');
    if (!cont) return;
    const par = paramsSimulador(d);
    if (par.anios < 1 || par.capital < 0) return;
    cont.innerHTML = '<div class="esqueleto" style="height:160px;margin-top:12px"></div>';
    setTimeout(() => {
      const hip = leerHipotesis();
      const rA = simular(par, pesosObjetivo(d.config), hip, 2000);
      const rB = simular(par, PRUDENTE, hip, 2000);
      cont.innerHTML = htmlResultado(par, rA, rB);
      graficoSimulacion(rA);
      pintarCrisis(par);
      document.getElementById('c-tipo').addEventListener('change', () => pintarCrisis(par));
      document.getElementById('c-cuando').addEventListener('change', () => pintarCrisis(par));
    }, 30);
  }

  function graficoSimulacion(r) {
    const el = document.getElementById('g-sim');
    if (!el) return;
    if (!window.Chart) { el.parentNode.innerHTML = '<p class="vacio">El gráfico no ha podido cargarse (sin conexión).</p>'; return; }
    if (estado.graficos['g-sim']) { try { estado.graficos['g-sim'].destroy(); } catch (e) {} }
    const etiquetas = r.porAnio.map(a => a.edad + ' años');
    const acento = colorVar('--acento');
    estado.graficos['g-sim'] = new Chart(el, {
      type: 'line',
      data: {
        labels: etiquetas,
        datasets: [
          { label: 'Conservador', data: r.porAnio.map(a => a.p10), borderColor: 'transparent', pointRadius: 0, fill: false },
          { label: 'Optimista', data: r.porAnio.map(a => a.p90), borderColor: 'transparent', backgroundColor: 'rgba(212,160,23,.18)', pointRadius: 0, fill: '-1' },
          { label: 'Central', data: r.porAnio.map(a => a.p50), borderColor: acento, borderWidth: 2.5, pointRadius: 0, fill: false },
          { label: 'Aportado', data: r.porAnio.map(a => a.aportado), borderColor: colorVar('--texto-3'), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { color: colorVar('--texto-3'), maxTicksLimit: 6, font: { size: 11 } }, grid: { display: false } },
          y: { ticks: { color: colorVar('--texto-3'), font: { size: 11 }, callback: v => fmtEur(v, 0) }, grid: { color: colorVar('--borde') } }
        },
        plugins: {
          legend: { labels: { color: colorVar('--texto-2'), boxWidth: 12, font: { size: 11 }, filter: i => i.text !== 'Conservador' && i.text !== 'Optimista' } },
          tooltip: { callbacks: { label: ctx => ' ' + ctx.dataset.label + ': ' + fmtEur(ctx.raw, 0) } }
        }
      }
    });
  }

  function vistaInformes(el, d) {
    el.innerHTML = `
      ${tarjetaChat(d)}
      ${tarjetaInformes(d)}
      ${tarjetaValidacion(d)}
      ${tarjetaPerfil(d)}
      ${tarjetaSimulador(d)}


      <article class="tarjeta ancho"><h2>Aviso importante</h2>
        <p class="suave">Esta aplicación es una herramienta informativa y analítica de uso personal. No es un asesor financiero regulado ni ejecuta operaciones. Las rentabilidades pasadas no garantizan rentabilidades futuras.</p></article>
    `;
    document.getElementById('f-sim').addEventListener('submit', ev => { ev.preventDefault(); ejecutarSimulacion(d); });
    document.getElementById('btn-editar-perfil').addEventListener('click', modalAjustes);
    enlazarChat(d);
    document.getElementById('btn-generar-informe').addEventListener('click', async ev => {
      ev.target.disabled = true; ev.target.textContent = 'Generando…';
      try { await cargar('generarInforme', { tipo: 'diario' }, 'Informe generado'); }
      catch (e) { toast(e.message); ev.target.disabled = false; ev.target.textContent = 'Generar ahora'; }
    });
    ejecutarSimulacion(d);
  }

  /* ---------------- Modales ---------------- */
  function abrirModal(titulo, html, alAbrir) {
    const m = $('#modal');
    $('#modal-titulo').textContent = titulo;
    $('#modal-cuerpo').innerHTML = html;
    if (!m.open) m.showModal();
    if (alAbrir) alAbrir($('#modal-cuerpo'));
  }
  function cerrarModal() { const m = $('#modal'); if (m.open) m.close(); }

  async function enviarFormulario(form, accion, datos, okMsg) {
    const btn = form.querySelector('[type=submit]');
    const err = form.querySelector('.error');
    btn.disabled = true; err.textContent = '';
    try {
      await cargar(accion, datos, okMsg);
      cerrarModal();
    } catch (e) {
      err.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  const opciones = (lista, sel, valorFn, textoFn) => lista.map(x => {
    const v = valorFn ? valorFn(x) : x; const t = textoFn ? textoFn(x) : x;
    return `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`;
  }).join('');

  function modalActivo(a, precarga) {
    const cat = estado.datos.catalogos;
    a = a || precarga || {};
    abrirModal(a.id ? 'Editar activo' : 'Añadir activo', `
      <form class="formulario" id="f-activo">
        <label>Nombre<input name="nombre" required maxlength="120" value="${esc(a.nombre)}" placeholder="p. ej. Vanguard FTSE All-World (Acc)"></label>
        <label>Categoría<select name="categoria" required>${opciones(cat.categorias, a.categoria, x => x.id, x => x.nombre)}</select></label>
        <div class="doble">
          <label>Tipo<select name="tipo">${opciones(cat.tipos, a.tipo || 'ETF')}</select></label>
          <label>Región<select name="region">${opciones(cat.regiones, a.region || 'Global')}</select></label>
        </div>
        <div class="doble">
          <label>ISIN <span class="ayuda">(opcional)</span><input name="isin" maxlength="12" value="${esc(a.isin)}" placeholder="IE00BK5BQT80" autocapitalize="characters"></label>
          <label>Ticker <span class="ayuda">(opcional)</span><input name="ticker" maxlength="20" value="${esc(a.ticker)}" placeholder="VWCE"></label>
        </div>
        <label>Símbolo de datos (EODHD) <span class="ayuda">(para el precio automático)</span>
          <div style="display:flex;gap:8px"><input name="simbolo_datos" maxlength="30" value="${esc(a.simbolo_datos || '')}" placeholder="p. ej. VWCE.XETRA" autocapitalize="characters" style="flex:1">
          <button class="btn pequeno" type="button" id="btn-buscar-simbolo">Buscar por ISIN</button></div>
          <span class="ayuda" id="ayuda-simbolo">Si lo dejas vacío y has puesto el ISIN, la app lo buscará al guardar. No hace falta en liquidez.</span></label>
        <label>Divisa de exposición<select name="divisa_exposicion">${opciones(cat.divisas, a.divisa || 'EUR')}</select>
          <span class="ayuda">La moneda de los activos que contiene, no la de cotización. Un ETF mundial es «Multidivisa»; el oro, «USD».</span></label>
        <label>Notas <span class="ayuda">(opcional)</span><textarea name="notas" rows="2" maxlength="500">${esc(a.notas || '')}</textarea></label>
        <p class="error" role="alert"></p>
        <div class="botonera">
          <button class="btn primario" type="submit">Guardar</button>
          ${a.id ? '<button class="btn peligro" type="button" id="btn-borrar-activo">Eliminar activo</button>' : ''}
        </div>
      </form>`, cuerpo => {
      const f = $('#f-activo', cuerpo);
      f.addEventListener('submit', ev => {
        ev.preventDefault();
        const d = Object.fromEntries(new FormData(f).entries());
        d.id = a.id || '';
        enviarFormulario(f, 'guardarActivo', d, 'Activo guardado');
      });
      $('#btn-buscar-simbolo', cuerpo).addEventListener('click', async ev => {
        const isin = f.isin.value.trim();
        const ayuda = $('#ayuda-simbolo', cuerpo);
        if (!isin) { ayuda.textContent = 'Escribe primero el ISIN.'; return; }
        ev.target.disabled = true; ayuda.textContent = 'Buscando…';
        try {
          const r = await api('buscarSimbolo', { isin: isin });
          f.simbolo_datos.value = r.simbolo;
          ayuda.textContent = 'Encontrado: ' + r.nombre + ' (' + r.bolsa + ', ' + r.divisa + ').' + (r.divisa !== 'EUR' ? ' Atención: no cotiza en euros en esta bolsa.' : '');
        } catch (e) { ayuda.textContent = 'No encontrado: ' + e.message; }
        finally { ev.target.disabled = false; }
      });
      const b = $('#btn-borrar-activo', cuerpo);
      if (b) b.addEventListener('click', () => {
        if (!confirm('¿Eliminar «' + a.nombre + '»? Solo es posible si no tiene operaciones.')) return;
        enviarFormulario(f, 'eliminarActivo', { id: a.id }, 'Activo eliminado');
      });
    });
  }

  function modalOperacion(activoId) {
    const activos = estado.datos.cartera.posiciones;
    if (!activos.length) { toast('Primero añade un activo.'); return; }
    const sel = activoId || activos[0].id;
    abrirModal('Registrar operación', `
      <form class="formulario" id="f-op">
        <label>Activo<select name="activo_id" id="op-activo">${opciones(activos, sel, x => x.id, x => x.nombre)}</select></label>
        <div class="doble">
          <label>Tipo<select name="tipo" id="op-tipo">
            <option value="COMPRA">Compra / ingreso</option><option value="VENTA">Venta / retirada</option><option value="RENTA">Dividendo o interés cobrado</option></select></label>
          <label>Fecha<input name="fecha" type="date" required max="${hoyISO()}" value="${hoyISO()}"></label>
        </div>
        <div id="op-campos"></div>
        <label>Comisión (€)<input name="comision" type="number" inputmode="decimal" min="0" step="0.01" value="0">
          <span class="ayuda">En Trade Republic, normalmente 1 € por orden puntual y 0 € en planes de inversión. Compruébalo en tu extracto.</span></label>
        <label>Notas <span class="ayuda">(opcional)</span><input name="notas" maxlength="300"></label>
        <p class="error" role="alert"></p>
        <button class="btn primario" type="submit">Guardar operación</button>
      </form>`, cuerpo => {
      const f = $('#f-op', cuerpo);
      const campos = () => {
        const a = activos.find(x => x.id === $('#op-activo', cuerpo).value);
        const tipo = $('#op-tipo', cuerpo).value;
        const liq = a && a.categoria === 'LIQUIDEZ';
        $('#op-campos', cuerpo).innerHTML = (tipo === 'RENTA' || liq)
          ? `<label>Importe (€)<input name="importe" type="number" inputmode="decimal" min="0.01" step="0.01" required></label>`
          : `<div class="doble"><label>Participaciones<input name="participaciones" type="number" inputmode="decimal" min="0.00000001" step="any" required></label>
             <label>${a && a.categoria === 'CRIPTO' ? 'Precio por unidad, p. ej. por 1 bitcoin (€)' : 'Precio por participación (€)'}<input name="precio" type="number" inputmode="decimal" min="0.0001" step="any" required></label></div>
             <p class="suave" id="op-total"></p>`;
        const calc = () => {
          const p = parseFloat(f.participaciones && f.participaciones.value), pr = parseFloat(f.precio && f.precio.value);
          const t = $('#op-total', cuerpo);
          if (t) t.textContent = p > 0 && pr > 0 ? 'Importe de la operación: ' + fmtEur(p * pr) + ' (sin comisión)' : '';
        };
        f.oninput = calc;
      };
      $('#op-activo', cuerpo).addEventListener('change', campos);
      $('#op-tipo', cuerpo).addEventListener('change', campos);
      campos();
      f.addEventListener('submit', ev => {
        ev.preventDefault();
        enviarFormulario(f, 'guardarOperacion', Object.fromEntries(new FormData(f).entries()), 'Operación registrada');
      });
    });
  }

  function modalPrecio(a) {
    abrirModal('Actualizar precio', `
      <form class="formulario" id="f-precio">
        <p><strong>${esc(a.nombre)}</strong><br><span class="suave">Precio guardado: ${a.precio_actual ? fmtEur(a.precio_actual, 4) + ' (' + fmtFecha(a.fecha_precio) + ')' : 'ninguno'}</span></p>
        <div class="doble">
          <label>Precio actual (€)<input name="precio" type="number" inputmode="decimal" min="0.0001" step="any" required></label>
          <label>Fecha del precio<input name="fecha" type="date" required max="${hoyISO()}" value="${hoyISO()}"></label>
        </div>
        <p class="suave">Copia el precio que muestra Trade Republic. En la Fase 3 se actualizará automáticamente.</p>
        <p class="error" role="alert"></p>
        <button class="btn primario" type="submit">Guardar precio</button>
      </form>`, cuerpo => {
      const f = $('#f-precio', cuerpo);
      f.addEventListener('submit', ev => {
        ev.preventDefault();
        const d = Object.fromEntries(new FormData(f).entries());
        d.id = a.id;
        enviarFormulario(f, 'actualizarPrecio', d, 'Precio actualizado');
      });
    });
  }

  async function borrarOperacion(id) {
    if (!confirm('¿Eliminar esta operación? Se recalculará toda la cartera.')) return;
    try { await cargar('eliminarOperacion', { id: id }, 'Operación eliminada'); } catch (e) { toast(e.message); }
  }

  function modalAjustes() {
    const cfg = estado.datos ? estado.datos.config : {};
    const con = estado.conexion || {};
    let tema = 'auto';
    try { tema = localStorage.getItem('cp_tema') || 'auto'; } catch (e) {}
    const cats = estado.datos ? estado.datos.catalogos.categorias : [];
    abrirModal('Ajustes', `
      <form class="formulario" id="f-ajustes">
        <h3>Apariencia</h3>
        <label>Tema<select name="tema"><option value="auto" ${tema === 'auto' ? 'selected' : ''}>Automático (según el dispositivo)</option>
          <option value="claro" ${tema === 'claro' ? 'selected' : ''}>Claro</option><option value="oscuro" ${tema === 'oscuro' ? 'selected' : ''}>Oscuro</option></select></label>
        ${estado.datos ? `
        <h3>Tu perfil y plan</h3>
        <div class="doble">
          <label>Aportación mensual (€)<input name="aportacion_mensual" type="number" min="0" step="1" value="${esc(cfg.aportacion_mensual)}"></label>
          <label>Capital inicial (€)<input name="capital_inicial" type="number" min="0" step="1" value="${esc(cfg.capital_inicial)}"></label>
        </div>
        <div class="doble">
          <label>Edad<input name="edad" type="number" min="18" max="100" value="${esc(cfg.edad)}"></label>
          <label>Horizonte (años)<input name="horizonte_anios" type="number" min="1" max="40" value="${esc(cfg.horizonte_anios)}"></label>
        </div>
        <div class="doble">
          <label>Gastos mensuales (€)<input name="gastos_mensuales" type="number" min="0" step="10" value="${esc(cfg.gastos_mensuales || '')}"></label>
          <label>Meses de colchón<input name="meses_colchon" type="number" min="1" max="24" value="${esc(cfg.meses_colchon || 6)}"></label>
        </div>
        <div class="doble">
          <label>Edad de jubilación<input name="edad_jubilacion" type="number" min="50" max="80" value="${esc(cfg.edad_jubilacion || 66)}"></label>
          <label>Tolerancia a pérdidas<select name="tolerancia">${['Baja', 'Moderada', 'Alta'].map(t => `<option ${String(cfg.tolerancia || 'Moderada') === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        </div>
        <div class="doble">
          <label>Aportación extra cada enero (€)<input name="aportacion_extra_anual" type="number" min="0" step="10" value="${esc(cfg.aportacion_extra_anual || 0)}"></label>
          <label>Retirada mensual al jubilarte (€)<input name="retiro_mensual" type="number" min="0" step="10" value="${esc(cfg.retiro_mensual || 0)}"></label>
        </div>
        <label>¿Tienes fondo de emergencia aparte?<select name="fondo_emergencia">
          <option ${String(cfg.fondo_emergencia).indexOf('S') === 0 ? 'selected' : ''}>Sí</option><option ${String(cfg.fondo_emergencia).indexOf('S') !== 0 ? 'selected' : ''}>No</option></select></label>
        <h3>Pesos objetivo (%) <span class="ayuda" id="suma-obj"></span></h3>
        <div class="doble">${cats.map(c => `<label>${esc(c.nombre)}<input class="obj" name="obj_${esc(c.id)}" type="number" min="0" max="100" step="0.5" value="${esc(cfg['obj_' + c.id])}"></label>`).join('')}</div>
        ` : ''}
        <h3>Alertas</h3>
        <div class="formulario">
          <label>Frecuencia<select name="frecuencia_alertas">${['Diaria', 'Solo importantes', 'Semanal'].map(t => `<option ${String(cfg.frecuencia_alertas || 'Diaria') === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
            <span class="ayuda">Diaria: un mensaje como máximo al día, solo si hay novedades. Solo importantes: oportunidades relevantes y riesgos elevados. Semanal: resumen los domingos.</span></label>
          <label>Canal<select name="canal_alertas">${['Correo y Telegram', 'Solo Telegram', 'Solo correo'].map(t => `<option ${String(cfg.canal_alertas || 'Correo y Telegram') === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
            <span class="ayuda">Telegram: ${estado.datos && estado.datos.alertas && estado.datos.alertas.telegram ? 'conectado ✔' : 'no conectado'}.</span></label>
        </div>
        <button class="btn" type="button" id="btn-prueba-alertas">Enviar mensaje de prueba</button>
        <label>Informe diario (8:30), semanal y mensual<select name="canal_informe">${['Correo + Telegram breve', 'Solo correo', 'Solo en la app'].map(t => `<option ${String(cfg.canal_informe || 'Correo + Telegram breve') === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <h3>Seguridad del dispositivo</h3>
        ${htmlSeguridadAjustes()}
        <h3>Conexión</h3>
        <label>Dirección de la aplicación web<input name="url" type="url" value="${esc(con.url || '')}" required></label>
        <label>Código de acceso<input name="token" type="password" value="${esc(con.token || '')}" required minlength="20" autocomplete="off"></label>
        <p class="error" role="alert"></p>
        <div class="botonera">
          <button class="btn primario" type="submit">Guardar</button>
          <button class="btn" type="button" id="btn-mercado">Actualizar datos de mercado</button>
          <button class="btn" type="button" id="btn-precios">Actualizar precios ahora</button>
          <button class="btn" type="button" id="btn-analisis">Actualizar análisis ahora</button>
          <button class="btn" type="button" id="btn-estado">Comprobar estado del sistema</button>
          <button class="btn peligro" type="button" id="btn-desconectar">Olvidar este dispositivo</button>
        </div>
        <p class="suave">Versión de la app: 1.8.0 · Servidor: ${esc(estado.datos ? estado.datos.app.version : '—')}</p>
      </form>`, cuerpo => {
      const f = $('#f-ajustes', cuerpo);
      const suma = () => {
        const s = Array.from(f.querySelectorAll('.obj')).reduce((t, i) => t + (parseFloat(i.value) || 0), 0);
        const el = $('#suma-obj', cuerpo);
        if (el) { el.textContent = 'Suma: ' + fmtNum(s, 1) + ' %'; el.style.color = Math.abs(s - 100) < 0.01 ? '' : 'var(--negativo)'; }
        return s;
      };
      f.addEventListener('input', suma); suma();
      f.addEventListener('submit', async ev => {
        ev.preventDefault();
        const d = Object.fromEntries(new FormData(f).entries());
        aplicarTema(d.tema);
        const nuevaCon = { url: d.url.trim(), token: d.token.trim() };
        const cambioCon = nuevaCon.url !== con.url || nuevaCon.token !== con.token;
        if (cambioCon) await guardarConexion(nuevaCon);
        if (estado.datos && f.querySelector('.obj')) {
          if (Math.abs(suma() - 100) > 0.01) { $('.error', f).textContent = 'Los pesos objetivo deben sumar 100 %.'; return; }
          const cfgNueva = {};
          ['aportacion_mensual', 'capital_inicial', 'edad', 'horizonte_anios', 'fondo_emergencia', 'gastos_mensuales', 'meses_colchon',
           'edad_jubilacion', 'tolerancia', 'aportacion_extra_anual', 'retiro_mensual', 'frecuencia_alertas', 'canal_alertas', 'canal_informe'].forEach(k => { cfgNueva[k] = d[k]; });
          cats.forEach(c => { cfgNueva['obj_' + c.id] = d['obj_' + c.id]; });
          enviarFormulario(f, 'guardarConfig', cfgNueva, 'Ajustes guardados');
        } else {
          enviarFormulario(f, 'resumen', null, 'Conectado');
        }
      });
      $('#btn-mercado', cuerpo).addEventListener('click', async ev => {
        ev.target.disabled = true;
        try { await cargar('actualizarMercado', null, 'Datos de mercado actualizados'); cerrarModal(); }
        catch (e) { $('.error', f).textContent = e.message; }
        finally { ev.target.disabled = false; }
      });
      $('#btn-precios', cuerpo).addEventListener('click', async ev => {
        ev.target.disabled = true;
        try { await cargar('actualizarPrecios', null, 'Precios actualizados'); cerrarModal(); }
        catch (e) { $('.error', f).textContent = e.message; }
        finally { ev.target.disabled = false; }
      });
      enlazarSeguridadAjustes(cuerpo, f);
      $('#btn-estado', cuerpo).addEventListener('click', mostrarEstadoSistema);
      $('#btn-prueba-alertas', cuerpo).addEventListener('click', async ev => {
        ev.target.disabled = true; ev.target.textContent = 'Enviando…';
        try { const r = await cargar('probarAlertas', null); toast('Prueba enviada por: ' + (r.prueba_alertas || []).join(' y ')); }
        catch (e) { $('.error', f).textContent = e.message; }
        finally { ev.target.disabled = false; ev.target.textContent = 'Enviar mensaje de prueba'; }
      });
      $('#btn-analisis', cuerpo).addEventListener('click', async ev => {
        ev.target.disabled = true; ev.target.textContent = 'Analizando… (hasta 1 minuto)';
        try { await cargar('actualizarAnalisis', null, 'Análisis actualizado'); cerrarModal(); }
        catch (e) { $('.error', f).textContent = e.message; }
        finally { ev.target.disabled = false; ev.target.textContent = 'Actualizar análisis ahora'; }
      });
      $('#btn-desconectar', cuerpo).addEventListener('click', () => {
        if (!confirm('Se borrarán la conexión y los datos guardados en este dispositivo (no los del servidor).')) return;
        [CLAVE_CONEXION, CLAVE_CACHE, CLAVE_SEGURO, 'cp_chat'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
        location.reload();
      });
    });
  }

  function aplicarTema(t) {
    try { localStorage.setItem('cp_tema', t); } catch (e) {}
    if (t === 'claro' || t === 'oscuro') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    pintar();
  }

  /* ---------------- Exportación ---------------- */
  function exportarCSV() {
    const d = estado.datos;
    const sep = ';';
    const n = x => (x === null || x === undefined || x === '') ? '' : String(x).replace('.', ',');
    const t = x => '"' + String(x === null || x === undefined ? '' : x).replace(/"/g, '""') + '"';
    const filas = [['POSICIONES'], ['Nombre', 'ISIN', 'Categoría', 'Tipo', 'Región', 'Divisa', 'Participaciones', 'Precio medio', 'Precio actual', 'Fecha precio', 'Valor', 'Ganancia no realizada', 'Peso %']];
    d.cartera.posiciones.forEach(p => filas.push([t(p.nombre), t(p.isin), t(p.categoria), t(p.tipo), t(p.region), t(p.divisa), n(p.participaciones), n(p.precio_medio), n(p.precio_actual), t(p.fecha_precio), n(p.valor), n(p.latente), n(p.peso)]));
    filas.push([], ['OPERACIONES'], ['Fecha', 'Activo', 'Tipo', 'Participaciones', 'Precio', 'Comisión', 'Importe', 'Notas']);
    const nom = id => (d.cartera.posiciones.find(p => p.id === id) || {}).nombre || id;
    d.operaciones.forEach(o => filas.push([t(o.fecha), t(nom(o.activo_id)), t(o.tipo), n(o.participaciones), n(o.precio), n(o.comision), n(o.importe), t(o.notas)]));
    const csv = '﻿' + filas.map(f => f.join(sep)).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'cartera-patrimonio-' + hoyISO() + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ---------------- Seguridad del dispositivo (Fase 9) ---------------- */
  const CLAVE_SEGURO = 'cp_seguro';
  const b64 = u => btoa(String.fromCharCode.apply(null, u));
  const deB64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
  const pinActivo = () => { try { return !!localStorage.getItem(CLAVE_SEGURO); } catch (e) { return false; } };

  async function derivarClave(pin, sal) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sal, iterations: 250000, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function cifrarObj(obj, clave) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, clave, new TextEncoder().encode(JSON.stringify(obj)));
    return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
  }
  async function descifrarObj(c, clave) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(c.iv) }, clave, deB64(c.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  async function guardarConexion(con) {
    estado.conexion = con;
    if (estado.clavePin && pinActivo()) {
      const sg = leerLS(CLAVE_SEGURO);
      sg.con = await cifrarObj(con, estado.clavePin);
      guardarLS(CLAVE_SEGURO, sg);
    } else guardarLS(CLAVE_CONEXION, con);
  }
  async function activarPin(pin) {
    if (!window.crypto || !crypto.subtle) throw new Error('Este navegador no permite el cifrado necesario.');
    const sal = crypto.getRandomValues(new Uint8Array(16));
    const clave = await derivarClave(pin, sal);
    guardarLS(CLAVE_SEGURO, { sal: b64(sal), con: await cifrarObj(estado.conexion, clave) });
    estado.clavePin = clave;
    [CLAVE_CONEXION, CLAVE_CACHE, 'cp_chat'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  }
  function desactivarPin() {
    try { localStorage.removeItem(CLAVE_SEGURO); } catch (e) {}
    estado.clavePin = null;
    guardarLS(CLAVE_CONEXION, estado.conexion);
  }

  function mostrarPin(alDesbloquear) {
    document.querySelectorAll('.vista').forEach(v => { v.hidden = true; });
    $('.navegacion').hidden = true;
    $('#titulo-pantalla').textContent = 'Cartera Patrimonio';
    let sec = $('#v-pin');
    if (!sec) { sec = document.createElement('section'); sec.id = 'v-pin'; sec.className = 'vista'; $('#contenido').appendChild(sec); }
    sec.hidden = false;
    sec.innerHTML = `<div class="tarjeta bienvenida pin-tarjeta">
      <h2>🔒 Introduce tu PIN</h2>
      <form id="f-pin" class="formulario">
        <input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" autocomplete="off" aria-label="PIN" required>
        <button class="btn primario" type="submit">Desbloquear</button>
        <p class="error" role="alert"></p>
        <button type="button" class="btn pequeno peligro" id="pin-olvido">He olvidado el PIN</button>
      </form></div>`;
    const f = $('#f-pin'), err = $('.error', f);
    let fallos = 0;
    setTimeout(() => { try { $('#pin').focus(); } catch (e) {} }, 100);
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const btn = f.querySelector('[type=submit]'); btn.disabled = true; err.textContent = '';
      try {
        const sg = leerLS(CLAVE_SEGURO);
        const clave = await derivarClave($('#pin').value, deB64(sg.sal));
        estado.conexion = await descifrarObj(sg.con, clave);
        estado.clavePin = clave;
        sec.hidden = true; sec.innerHTML = '';
        $('.navegacion').hidden = false;
        alDesbloquear();
      } catch (e) {
        fallos++;
        $('#pin').value = '';
        const espera = fallos >= 5 ? Math.min(300, 30 * Math.pow(2, fallos - 5)) : 0;
        err.textContent = 'PIN incorrecto.' + (espera ? ' Espera ' + espera + ' segundos.' : '');
        if (espera) { setTimeout(() => { btn.disabled = false; err.textContent = ''; }, espera * 1000); return; }
      }
      btn.disabled = false;
    });
    $('#pin-olvido').addEventListener('click', () => {
      if (!confirm('Se borrará el acceso guardado en este móvil. Tendrás que volver a pegar la dirección de la app web y tu código de acceso. Tus datos del servidor no se tocan.')) return;
      [CLAVE_SEGURO, CLAVE_CONEXION, CLAVE_CACHE, 'cp_chat'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
      location.reload();
    });
  }

  function htmlSeguridadAjustes() {
    return pinActivo()
      ? `<p>🔒 <strong>PIN activado.</strong> Tu acceso está cifrado en este dispositivo y la app se bloquea tras 5 minutos en segundo plano. No se guardan copias de tus datos en el móvil.</p>
         <button class="btn" type="button" id="btn-quitar-pin">Desactivar PIN</button>`
      : `<p class="suave">Protege la app con un PIN de 4 a 8 cifras. El acceso guardado en el móvil quedará cifrado (AES-256) y no se guardarán copias de tus datos.</p>
         <div class="doble"><label>Nuevo PIN<input id="pin-1" type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" autocomplete="new-password"></label>
         <label>Repite el PIN<input id="pin-2" type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" autocomplete="new-password"></label></div>
         <button class="btn" type="button" id="btn-poner-pin">Activar PIN</button>`;
  }

  function enlazarSeguridadAjustes(cuerpo, f) {
    const poner = $('#btn-poner-pin', cuerpo), quitar = $('#btn-quitar-pin', cuerpo);
    if (poner) poner.addEventListener('click', async () => {
      const a = $('#pin-1', cuerpo).value, b = $('#pin-2', cuerpo).value;
      if (!/^\d{4,8}$/.test(a)) { $('.error', f).textContent = 'El PIN debe tener entre 4 y 8 cifras.'; return; }
      if (a !== b) { $('.error', f).textContent = 'Los dos PIN no coinciden.'; return; }
      if (/^(\d)\1+$/.test(a) || '0123456789'.indexOf(a) >= 0 || '9876543210'.indexOf(a) >= 0) { $('.error', f).textContent = 'Elige un PIN menos evidente (no repetido ni consecutivo).'; return; }
      try { await activarPin(a); cerrarModal(); toast('PIN activado'); } catch (e) { $('.error', f).textContent = e.message; }
    });
    if (quitar) quitar.addEventListener('click', () => {
      if (!confirm('¿Desactivar el PIN? El acceso volverá a guardarse sin cifrar en este dispositivo.')) return;
      desactivarPin(); cerrarModal(); toast('PIN desactivado');
    });
  }

  async function mostrarEstadoSistema() {
    abrirModal('Estado del sistema', '<div class="esqueleto"></div><p class="suave">Comprobando… (unos segundos)</p>');
    try {
      const r = await api('diagnostico');
      const icono = e => e === 'ok' ? '✅' : (e === 'aviso' ? '⚠️' : '❌');
      abrirModal('Estado del sistema', `
        <p><strong>${r.resumen.ok} correctos · ${r.resumen.avisos} avisos · ${r.resumen.errores} errores</strong></p>
        <ul class="diagnostico">${r.checks.map(c => `<li class="d-${esc(c.estado)}"><span>${icono(c.estado)}</span><div><small>${esc(c.area)}</small>${esc(c.texto)}</div></li>`).join('')}</ul>
        <p class="suave">Comprobado el ${fmtFechaHora(r.fecha)} · servidor ${esc(r.version)}. Si algo falla, el sistema te avisa automáticamente cada día a las 12:00.</p>`);
    } catch (e) { abrirModal('Estado del sistema', `<p class="error">${esc(e.message)}</p>`); }
  }

  function descargar(nombre, contenido, tipo) {
    const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function exportarTodo() {
    toast('Preparando la copia…');
    try {
      const r = await api('exportar');
      descargar('cartera-patrimonio-copia-' + hoyISO() + '.json', JSON.stringify(r, null, 2), 'application/json');
    } catch (e) { toast(e.message); }
  }

  function descargarInforme(inf) {
    const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(inf.titulo) + '</title>' +
      '<style>body{font-family:Arial,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#0F1A2E;line-height:1.5}.decision{background:#F6EBCF;border:1px solid #B8860B;border-radius:12px;padding:12px 16px}.etq{font-size:12px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#8A6400}.tit{font-weight:bold;font-size:17px;margin:4px 0}h3{margin:18px 0 4px}.suave{color:#6B7588;font-size:13px}</style></head><body>' +
      '<h1>' + esc(inf.titulo) + '</h1>' + htmlInforme(inf, true) + '</body></html>';
    descargar(inf.id.replace(/[^\w-]/g, '-') + '.html', html, 'text/html');
  }

  function tarjetaValidacion(d) {
    const v = d.validacion;
    if (!v) return '';
    const nombres = { ORO: 'Oro', RV_DES: 'RV desarrollados', RV_EME: 'RV emergentes', BONOS: 'Bonos', REITS: 'REITs', CRIPTO: 'Bitcoin' };
    return `<article class="tarjeta ancho"><h2>¿Aciertan las señales?</h2>
      <p class="suave">Historial de decisiones y resultados: qué pasó con el precio 30 días después de cada evaluación del semáforo. Sirve para comprobar con honestidad si el motor aporta valor.</p>
      ${!v.disponible ? `<p class="vacio">Aún no hay señales con 30 días de antigüedad. Los primeros resultados estarán disponibles a partir del ${fmtFecha(v.disponible_desde)}.</p>` : `
        <div class="indicadores compacto">
          <div class="ind"><div class="nombre">Tras señales de compra</div><div class="valor num">${v.resumen.compra ? fmtVar(v.resumen.compra.media, 1) : '—'}</div><div class="meta">${v.resumen.compra ? v.resumen.compra.n + ' casos, media a 30 días' : 'sin casos todavía'}</div></div>
          <div class="ind"><div class="nombre">Tras el resto de señales</div><div class="valor num">${v.resumen.resto ? fmtVar(v.resumen.resto.media, 1) : '—'}</div><div class="meta">${v.resumen.resto ? v.resumen.resto.n + ' casos, media a 30 días' : ''}</div></div>
        </div>
        <div class="tabla-scroll"><table><thead><tr><th>Fecha</th><th>Activo</th><th>Señal</th><th class="der">Punt.</th><th class="der">30 días después</th></tr></thead><tbody>
        ${v.filas.slice(0, 20).map(x => `<tr><td>${fmtFecha(x.fecha)}</td><td>${esc(nombres[x.activo] || x.activo)}</td><td>${esc(x.estado.toLowerCase())}</td><td class="der">${esc(x.puntuacion)}</td><td class="der num">${fmtVar(x.var30, 1)}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="suave">Con pocos casos, los resultados pueden deberse al azar. Hacen falta muchos meses para sacar conclusiones.</p>`}
    </article>`;
  }

  /* ---------------- Arranque ---------------- */
  function mostrarConexion() {
    document.querySelectorAll('.vista').forEach(v => { v.hidden = true; });
    $('#v-conexion').hidden = false;
    $('.navegacion').hidden = true;
    $('#titulo-pantalla').textContent = 'Cartera Patrimonio';
    const f = $('#form-conexion');
    f.onsubmit = async ev => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries());
      estado.conexion = { url: d.url.trim(), token: d.token.trim() };
      const btn = f.querySelector('button'); btn.disabled = true; $('#conexion-error').textContent = '';
      try {
        await api('ping');
        await guardarConexion(estado.conexion);
        $('.navegacion').hidden = false;
        $('#v-conexion').hidden = true;
        irA('patrimonio');
        await cargar('resumen');
      } catch (e) {
        estado.conexion = null;
        $('#conexion-error').textContent = 'No se ha podido conectar: ' + e.message;
      } finally { btn.disabled = false; }
    };
  }

  function iniciar() {
    document.querySelectorAll('.navegacion button').forEach(b => b.addEventListener('click', () => irA(b.dataset.vista)));
    $('#btn-ajustes').addEventListener('click', modalAjustes);
    document.addEventListener('click', ev => {
      if (!estado.datos) return;
      const s = ev.target.closest('[data-senal]');
      if (s) { modalSenal(s.dataset.senal); return; }
      if (ev.target.closest('[data-metodologia]')) { modalMetodologia(); return; }
      const ir = ev.target.closest('[data-ir]');
      if (ir) { irA(ir.dataset.ir); return; }
      const di = ev.target.closest('[data-descargar-informe]');
      if (di) { const x = (estado.informes || {})[di.dataset.descargarInforme]; if (x) descargarInforme(x); return; }
      if (ev.target.closest('[data-exportar-todo]')) { exportarTodo(); return; }
      const inf = ev.target.closest('[data-informe]');
      if (inf) {
        abrirModal('Informe', '<div class="esqueleto"></div>');
        api('leerInforme', { id: inf.dataset.informe })
          .then(r => abrirModal(r.titulo, htmlInforme(r)))
          .catch(e => abrirModal('Informe', `<p class="error">${esc(e.message)}</p>`));
      }
    });
    $('#btn-refrescar').addEventListener('click', () => { if (estado.conexion) cargar('resumen', null, 'Datos actualizados').catch(() => {}); });

    // Bloqueo automático: si la app pasa más de 5 minutos en segundo plano con PIN, se vuelve a pedir
    let ocultaDesde = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') ocultaDesde = Date.now();
      else if (pinActivo() && estado.clavePin && ocultaDesde && Date.now() - ocultaDesde > 5 * 60 * 1000) location.reload();
    });

    if (pinActivo()) { mostrarPin(arrancar); return; }
    estado.conexion = leerLS(CLAVE_CONEXION);
    if (!estado.conexion || !estado.conexion.url) { mostrarConexion(); return; }
    arrancar();
  }

  function arrancar() {
    const inicial = (location.hash || '').replace('#', '');
    estado.vista = TITULOS[inicial] ? inicial : 'patrimonio';
    const c = leerLS(CLAVE_CACHE);
    if (c && c.datos) { estado.datos = c.datos; estado.deCache = true; }
    irA(estado.vista);
    if (!estado.datos) $('#v-' + estado.vista).innerHTML = '<div class="esqueleto"></div><div class="esqueleto"></div>';
    actualizarSync();
    cargar('resumen').catch(() => {});

    // Al volver a la app tras un rato, refrescar
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && estado.conexion) {
        const c2 = leerLS(CLAVE_CACHE);
        if (!c2 || Date.now() - new Date(c2.guardado).getTime() > 10 * 60 * 1000) cargar('resumen').catch(() => {});
      }
    });
    // Cambio de tema del sistema → repintar gráficos
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', pintar);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  document.addEventListener('DOMContentLoaded', iniciar);
})();
